-- Planning, categorization, alerts and explainable insights.

create table if not exists public.finance_category_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.finance_users(id) on delete cascade,
  pattern text not null check (length(btrim(pattern)) between 1 and 180),
  category text not null check (category in ('Alimentação','Transporte','Moradia','Saúde','Educação','Lazer','Assinaturas','Outros')),
  subcategory text,
  priority integer not null default 100,
  confidence numeric not null default 0.8 check (confidence between 0 and 1),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists finance_category_rules_owner_idx on public.finance_category_rules(user_id,enabled,priority);

create table if not exists public.finance_budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.finance_users(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 120),
  scope_type text not null check (scope_type in ('general','category','subcategory')),
  category text,
  subcategory text,
  planned_amount numeric not null check (planned_amount > 0 and planned_amount = round(planned_amount,2)),
  period_type text not null check (period_type in ('monthly','quarterly','yearly','custom')),
  start_date date not null,
  end_date date not null,
  status text not null default 'active' check (status in ('active','paused','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date),
  check (scope_type='general' or category is not null)
);
create index if not exists finance_budgets_owner_idx on public.finance_budgets(user_id,status,start_date,end_date);

create table if not exists public.finance_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.finance_users(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 120),
  target_amount numeric not null check (target_amount > 0 and target_amount = round(target_amount,2)),
  deadline date,
  priority integer not null default 100,
  status text not null default 'active' check (status in ('active','paused','completed','cancelled')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.finance_goal_contributions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.finance_users(id) on delete cascade,
  goal_id uuid not null references public.finance_goals(id) on delete cascade,
  amount numeric not null check (amount > 0 and amount = round(amount,2)),
  contribution_date date not null,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists finance_goals_owner_idx on public.finance_goals(user_id,status,deadline);
create index if not exists finance_goal_contributions_goal_idx on public.finance_goal_contributions(goal_id,contribution_date desc);

create table if not exists public.finance_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.finance_users(id) on delete cascade,
  type text not null,
  severity text not null check (severity in ('info','warning','critical')),
  status text not null default 'open' check (status in ('open','read','dismissed','resolved')),
  source text not null check (source in ('SYSTEM','AI','USER','TELEGRAM','WEB')),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  dismissed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);
create index if not exists finance_alerts_owner_idx on public.finance_alerts(user_id,status,created_at desc);

create table if not exists public.finance_ai_insights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.finance_users(id) on delete cascade,
  kind text not null,
  title text not null,
  body text not null,
  evidence jsonb not null default '[]'::jsonb,
  confidence numeric check (confidence is null or confidence between 0 and 1),
  status text not null default 'active' check (status in ('active','dismissed','expired')),
  generated_at timestamptz not null default now(),
  valid_until timestamptz
);
create index if not exists finance_ai_insights_owner_idx on public.finance_ai_insights(user_id,status,generated_at desc);

alter table public.finance_category_rules enable row level security;
alter table public.finance_budgets enable row level security;
alter table public.finance_goals enable row level security;
alter table public.finance_goal_contributions enable row level security;
alter table public.finance_alerts enable row level security;
alter table public.finance_ai_insights enable row level security;
revoke all on public.finance_category_rules,public.finance_budgets,public.finance_goals,public.finance_goal_contributions,public.finance_alerts,public.finance_ai_insights from public,anon,authenticated;
grant select,insert,update,delete on public.finance_category_rules,public.finance_budgets,public.finance_goals,public.finance_goal_contributions,public.finance_alerts,public.finance_ai_insights to service_role;

create or replace function public.finance_budget_summary(p_user_id uuid,p_budget_id uuid default null,p_date_from date default null,p_date_to date default null)
returns jsonb language sql security invoker set search_path=public as $$
  select coalesce(jsonb_agg(jsonb_build_object('budget',to_jsonb(b),'realized',coalesce(x.realized,0),'remaining',b.planned_amount-coalesce(x.realized,0),'percent_consumed',case when b.planned_amount=0 then 0 else round(coalesce(x.realized,0)/b.planned_amount*100,2) end) order by b.start_date),'[]'::jsonb)
  from finance_budgets b left join lateral (
    select sum(t.amount) realized from finance_transactions t
    where t.user_id=b.user_id and t.deleted_at is null and t.transaction_type='despesa'
      and t.transaction_date between coalesce(p_date_from,b.start_date) and coalesce(p_date_to,b.end_date)
      and (b.scope_type='general' or (b.scope_type='category' and t.category=b.category))
  ) x on true
  where b.user_id=p_user_id and (p_budget_id is null or b.id=p_budget_id) and b.status='active';
$$;

create or replace function public.finance_budget_create(p_user_id uuid,p_values jsonb)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare b finance_budgets;
begin
  insert into finance_budgets(user_id,name,scope_type,category,subcategory,planned_amount,period_type,start_date,end_date)
  values(p_user_id,btrim(p_values->>'name'),p_values->>'scope_type',p_values->>'category',p_values->>'subcategory',(p_values->>'planned_amount')::numeric,p_values->>'period_type',(p_values->>'start_date')::date,(p_values->>'end_date')::date)
  returning * into b;
  perform finance_audit_write(p_user_id,'WEB','CREATE','budget',b.id,null,null,null,to_jsonb(b),'{}'::jsonb);
  return to_jsonb(b);
end $$;

create or replace function public.finance_goal_list(p_user_id uuid)
returns jsonb language sql security invoker set search_path=public as $$
  select coalesce(jsonb_agg(jsonb_build_object('goal',to_jsonb(g),'current_amount',coalesce(c.current_amount,0),'remaining',greatest(g.target_amount-coalesce(c.current_amount,0),0),'progress',least(round(coalesce(c.current_amount,0)/g.target_amount*100,2),100)) order by g.priority,g.deadline),'[]'::jsonb)
  from finance_goals g left join lateral (select sum(amount) current_amount from finance_goal_contributions where goal_id=g.id) c on true
  where g.user_id=p_user_id;
$$;

create or replace function public.finance_goal_create(p_user_id uuid,p_values jsonb)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare g finance_goals;
begin
  insert into finance_goals(user_id,name,target_amount,deadline,priority,notes)
  values(p_user_id,btrim(p_values->>'name'),(p_values->>'target_amount')::numeric,(p_values->>'deadline')::date,coalesce((p_values->>'priority')::integer,100),p_values->>'notes') returning * into g;
  perform finance_audit_write(p_user_id,'WEB','CREATE','goal',g.id,null,null,null,to_jsonb(g),'{}'::jsonb);
  return to_jsonb(g);
end $$;

create or replace function public.finance_goal_contribute(p_user_id uuid,p_goal_id uuid,p_values jsonb,p_account_id uuid default null)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare c finance_goal_contributions; g finance_goals;
begin
  select * into g from finance_goals where id=p_goal_id and user_id=p_user_id and status='active' for update;
  if not found then return null; end if;
  insert into finance_goal_contributions(user_id,goal_id,amount,contribution_date,note)
  values(p_user_id,p_goal_id,(p_values->>'amount')::numeric,coalesce((p_values->>'contribution_date')::date,(now() at time zone 'America/Sao_Paulo')::date),p_values->>'note') returning * into c;
  perform finance_audit_write(p_user_id,'WEB','CREATE','goal_contribution',c.id,p_account_id,null,null,to_jsonb(c),'{}'::jsonb);
  return to_jsonb(c);
end $$;

create or replace function public.finance_alert_list(p_user_id uuid,p_status text default 'open',p_limit integer default 50)
returns jsonb language sql security invoker set search_path=public as $$
  select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc),'[]'::jsonb) from finance_alerts a
  where a.user_id=p_user_id and (p_status is null or a.status=p_status) limit greatest(1,least(coalesce(p_limit,50),100));
$$;

create or replace function public.finance_alert_dismiss(p_user_id uuid,p_alert_id uuid,p_account_id uuid default null)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare a finance_alerts;
begin
  update finance_alerts set status='dismissed',dismissed_at=now() where id=p_alert_id and user_id=p_user_id and status<>'dismissed' returning * into a;
  if not found then return null; end if;
  perform finance_audit_write(p_user_id,'WEB','USER_CONFIRMATION','alert',a.id,p_account_id,null,null,to_jsonb(a),'{}'::jsonb);
  return to_jsonb(a);
end $$;

create or replace function public.finance_insight_list(p_user_id uuid,p_limit integer default 20)
returns jsonb language sql security invoker set search_path=public as $$
  select coalesce(jsonb_agg(to_jsonb(i) order by i.generated_at desc),'[]'::jsonb) from finance_ai_insights i
  where i.user_id=p_user_id and i.status='active' and (i.valid_until is null or i.valid_until>now()) limit greatest(1,least(coalesce(p_limit,20),50));
$$;

create or replace function public.finance_cashflow_projection(p_user_id uuid,p_horizon_days integer default 30)
returns jsonb language sql security invoker set search_path=public as $$
  with horizon as (select (now() at time zone 'America/Sao_Paulo')::date today, (now() at time zone 'America/Sao_Paulo')::date+greatest(1,least(coalesce(p_horizon_days,30),365)) finish),
  items as (
    select i.due_date event_date,'installment' source,'despesa' transaction_type,i.amount amount from finance_installments i,horizon h where i.user_id=p_user_id and i.status='planned' and i.due_date between h.today and h.finish
    union all
    select r.due_date,'reminder', 'despesa',coalesce(r.amount,0) from finance_reminders r,horizon h where r.finance_user_id=p_user_id and r.status='pending' and r.kind='bill' and r.due_date between h.today and h.finish
    union all
    select s.next_due_date,'subscription','despesa',s.amount from finance_subscriptions s,horizon h where s.user_id=p_user_id and s.status='active' and s.next_due_date between h.today and h.finish
  )
  select jsonb_build_object('horizon_days',greatest(1,least(coalesce(p_horizon_days,30),365)),'assumptions',jsonb_build_array('Inclui parcelas planejadas, contas pendentes e assinaturas ativas cadastradas.','Valores são projeções e não alteram lançamentos realizados.'),'items',coalesce((select jsonb_agg(to_jsonb(i) order by i.event_date) from items i),'[]'::jsonb),'total_expenses',coalesce((select sum(amount) from items),0));
$$;

do $$ declare f record; begin
  for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('finance_budget_summary','finance_budget_create','finance_goal_list','finance_goal_create',
      'finance_goal_contribute','finance_alert_list','finance_alert_dismiss','finance_insight_list','finance_cashflow_projection') loop
    execute format('revoke all on function %s from public,anon,authenticated',f.sig);
    execute format('grant execute on function %s to service_role',f.sig);
  end loop;
end $$;
