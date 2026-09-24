-- Normalized financial domain. Existing transaction APIs remain unchanged.

create table if not exists public.finance_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.finance_users(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 100),
  type text not null check (type in ('current_account','digital_account','cash','physical_wallet','virtual_wallet','joint','custom')),
  opening_balance numeric not null default 0 check (opening_balance >= -100000000 and opening_balance = round(opening_balance,2)),
  currency text not null default 'BRL' check (currency ~ '^[A-Z]{3}$'),
  status text not null default 'active' check (status in ('active','archived')),
  icon text,
  color text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists finance_accounts_owner_idx on public.finance_accounts(user_id,status,name);

create table if not exists public.finance_credit_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.finance_users(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 100),
  nickname text,
  brand text,
  last_four text check (last_four is null or last_four ~ '^[0-9]{4}$'),
  limit_amount numeric check (limit_amount is null or (limit_amount >= 0 and limit_amount = round(limit_amount,2))),
  closing_day integer check (closing_day is null or closing_day between 1 and 31),
  due_day integer check (due_day is null or due_day between 1 and 31),
  currency text not null default 'BRL' check (currency ~ '^[A-Z]{3}$'),
  status text not null default 'active' check (status in ('active','archived')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists finance_credit_cards_owner_idx on public.finance_credit_cards(user_id,status,name);

create table if not exists public.finance_card_statements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.finance_users(id) on delete cascade,
  credit_card_id uuid not null references public.finance_credit_cards(id) on delete cascade,
  reference_year integer not null check (reference_year between 2000 and 2200),
  reference_month integer not null check (reference_month between 1 and 12),
  closing_date date,
  due_date date,
  total_amount numeric not null default 0 check (total_amount >= 0 and total_amount = round(total_amount,2)),
  status text not null default 'open' check (status in ('open','closed','paid','overdue')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (credit_card_id, reference_year, reference_month)
);
create index if not exists finance_card_statements_owner_idx on public.finance_card_statements(user_id,due_date);

create table if not exists public.finance_installment_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.finance_users(id) on delete cascade,
  transaction_id uuid references public.finance_transactions(id) on delete set null,
  credit_card_id uuid references public.finance_credit_cards(id) on delete set null,
  total_amount numeric not null check (total_amount > 0 and total_amount = round(total_amount,2)),
  installment_count integer not null check (installment_count between 2 and 120),
  first_due_date date not null,
  status text not null default 'active' check (status in ('active','completed','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists finance_installment_plans_owner_idx on public.finance_installment_plans(user_id,status,first_due_date);

create table if not exists public.finance_installments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.finance_users(id) on delete cascade,
  plan_id uuid not null references public.finance_installment_plans(id) on delete cascade,
  number integer not null check (number >= 1),
  due_date date not null,
  amount numeric not null check (amount > 0 and amount = round(amount,2)),
  status text not null default 'planned' check (status in ('planned','paid','cancelled')),
  paid_transaction_id uuid references public.finance_transactions(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (plan_id, number)
);
create index if not exists finance_installments_owner_idx on public.finance_installments(user_id,status,due_date);

create table if not exists public.finance_transaction_splits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.finance_users(id) on delete cascade,
  transaction_id uuid not null references public.finance_transactions(id) on delete cascade,
  account_id uuid references public.finance_accounts(id) on delete restrict,
  credit_card_id uuid references public.finance_credit_cards(id) on delete restrict,
  installment_plan_id uuid references public.finance_installment_plans(id) on delete set null,
  amount numeric not null check (amount > 0 and amount = round(amount,2)),
  created_at timestamptz not null default now(),
  check ((account_id is not null) <> (credit_card_id is not null))
);
create index if not exists finance_transaction_splits_transaction_idx on public.finance_transaction_splits(transaction_id);

create table if not exists public.finance_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.finance_users(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 120),
  merchant text,
  amount numeric not null check (amount > 0 and amount = round(amount,2)),
  currency text not null default 'BRL' check (currency ~ '^[A-Z]{3}$'),
  frequency text not null check (frequency in ('weekly','monthly','quarterly','yearly','custom')),
  next_due_date date,
  last_charge_date date,
  status text not null default 'active' check (status in ('active','paused','cancelled')),
  source_transaction_id uuid references public.finance_transactions(id) on delete set null,
  confidence numeric check (confidence is null or confidence between 0 and 1),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists finance_subscriptions_owner_idx on public.finance_subscriptions(user_id,status,next_due_date);

alter table public.finance_accounts enable row level security;
alter table public.finance_credit_cards enable row level security;
alter table public.finance_card_statements enable row level security;
alter table public.finance_installment_plans enable row level security;
alter table public.finance_installments enable row level security;
alter table public.finance_transaction_splits enable row level security;
alter table public.finance_subscriptions enable row level security;
revoke all on public.finance_accounts,public.finance_credit_cards,public.finance_card_statements,public.finance_installment_plans,public.finance_installments,public.finance_transaction_splits,public.finance_subscriptions from public,anon,authenticated;
grant select,insert,update,delete on public.finance_accounts,public.finance_credit_cards,public.finance_card_statements,public.finance_installment_plans,public.finance_installments,public.finance_transaction_splits,public.finance_subscriptions to service_role;

create or replace function public.finance_account_list(p_user_id uuid)
returns jsonb language sql security invoker set search_path=public as $$
  select coalesce(jsonb_agg(to_jsonb(a) order by a.status,a.name),'[]'::jsonb)
  from finance_accounts a where a.user_id=p_user_id;
$$;

create or replace function public.finance_account_create(p_user_id uuid,p_values jsonb)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare a finance_accounts;
begin
  if jsonb_typeof(p_values)<>'object' or nullif(btrim(p_values->>'name'),'') is null
    or p_values->>'type' not in ('current_account','digital_account','cash','physical_wallet','virtual_wallet','joint','custom')
    or coalesce(p_values->>'currency','BRL') !~ '^[A-Z]{3}$' then
    raise exception 'Invalid account' using errcode='22023';
  end if;
  insert into finance_accounts(user_id,name,type,opening_balance,currency,icon,color,notes)
  values(p_user_id,btrim(p_values->>'name'),p_values->>'type',coalesce((p_values->>'opening_balance')::numeric,0),coalesce(p_values->>'currency','BRL'),p_values->>'icon',p_values->>'color',p_values->>'notes')
  returning * into a;
  perform finance_audit_write(p_user_id,'WEB','CREATE','finance_account',a.id,null,null,null,to_jsonb(a),'{}'::jsonb);
  return to_jsonb(a);
end $$;

create or replace function public.finance_card_list(p_user_id uuid)
returns jsonb language sql security invoker set search_path=public as $$
  select coalesce(jsonb_agg(to_jsonb(c) order by c.status,c.name),'[]'::jsonb)
  from finance_credit_cards c where c.user_id=p_user_id;
$$;

create or replace function public.finance_card_create(p_user_id uuid,p_values jsonb)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare c finance_credit_cards;
begin
  if jsonb_typeof(p_values)<>'object' or nullif(btrim(p_values->>'name'),'') is null then raise exception 'Invalid card' using errcode='22023'; end if;
  insert into finance_credit_cards(user_id,name,nickname,brand,last_four,limit_amount,closing_day,due_day,currency,notes)
  values(p_user_id,btrim(p_values->>'name'),p_values->>'nickname',p_values->>'brand',p_values->>'last_four',(p_values->>'limit_amount')::numeric,(p_values->>'closing_day')::integer,(p_values->>'due_day')::integer,coalesce(p_values->>'currency','BRL'),p_values->>'notes')
  returning * into c;
  perform finance_audit_write(p_user_id,'WEB','CREATE','credit_card',c.id,null,null,null,to_jsonb(c),'{}'::jsonb);
  return to_jsonb(c);
end $$;

create or replace function public.finance_transaction_splits_replace(p_user_id uuid,p_transaction_id uuid,p_splits jsonb,p_account_id uuid default null)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare t finance_transactions; item jsonb; total numeric:=0; n integer:=0; result jsonb:='[]'::jsonb; account_ok boolean; card_ok boolean; split_id uuid;
begin
  if jsonb_typeof(p_splits)<>'array' or jsonb_array_length(p_splits)<1 or jsonb_array_length(p_splits)>20 then raise exception 'Invalid splits' using errcode='22023'; end if;
  select * into t from finance_transactions where id=p_transaction_id and user_id=p_user_id and deleted_at is null for update;
  if not found then return null; end if;
  for item in select value from jsonb_array_elements(p_splits) loop
    account_ok:=(item->>'account_id') is not null and exists(select 1 from finance_accounts where id=(item->>'account_id')::uuid and user_id=p_user_id and status='active');
    card_ok:=(item->>'credit_card_id') is not null and exists(select 1 from finance_credit_cards where id=(item->>'credit_card_id')::uuid and user_id=p_user_id and status='active');
    if account_ok=card_ok or ((item->>'amount')::numeric)<=0 or round((item->>'amount')::numeric,2)<>(item->>'amount')::numeric then raise exception 'Invalid split item' using errcode='22023'; end if;
    total:=total+(item->>'amount')::numeric; n:=n+1;
  end loop;
  if round(total,2)<>round(t.amount,2) then raise exception 'Split total must equal transaction total' using errcode='22023'; end if;
  delete from finance_transaction_splits where transaction_id=t.id;
  for item in select value from jsonb_array_elements(p_splits) loop
    insert into finance_transaction_splits(user_id,transaction_id,account_id,credit_card_id,installment_plan_id,amount)
    values(p_user_id,t.id,(item->>'account_id')::uuid,(item->>'credit_card_id')::uuid,(item->>'installment_plan_id')::uuid,(item->>'amount')::numeric)
    returning id into split_id;
    result:=result||jsonb_build_array(jsonb_build_object('id',split_id,'amount',(item->>'amount')::numeric,'account_id',item->>'account_id','credit_card_id',item->>'credit_card_id','installment_plan_id',item->>'installment_plan_id'));
  end loop;
  perform finance_audit_write(p_user_id,'WEB','UPDATE','transaction_splits',t.id,p_account_id,null,null,result,'{}'::jsonb);
  return result;
end $$;

create or replace function public.finance_installment_plan_create(p_user_id uuid,p_values jsonb,p_account_id uuid default null)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare plan finance_installment_plans; i integer; portion numeric; remainder numeric; item jsonb:='[]'::jsonb; tx finance_transactions;
begin
  select * into tx from finance_transactions where id=(p_values->>'transaction_id')::uuid and user_id=p_user_id and deleted_at is null for update;
  if not found or coalesce((p_values->>'installment_count')::integer,0) not between 2 and 120 then raise exception 'Invalid installment plan' using errcode='22023'; end if;
  if (p_values->>'credit_card_id') is not null and not exists(select 1 from finance_credit_cards where id=(p_values->>'credit_card_id')::uuid and user_id=p_user_id and status='active') then raise exception 'Card not owned' using errcode='42501'; end if;
  if (p_values->>'total_amount')::numeric<=0 or (p_values->>'total_amount')::numeric>tx.amount then raise exception 'Invalid installment amount' using errcode='22023'; end if;
  insert into finance_installment_plans(user_id,transaction_id,credit_card_id,total_amount,installment_count,first_due_date)
  values(p_user_id,tx.id,(p_values->>'credit_card_id')::uuid,(p_values->>'total_amount')::numeric,(p_values->>'installment_count')::integer,(p_values->>'first_due_date')::date)
  returning * into plan;
  portion:=round(plan.total_amount/plan.installment_count,2); remainder:=plan.total_amount;
  for i in 1..plan.installment_count loop
    if i=plan.installment_count then portion:=remainder; end if;
    insert into finance_installments(user_id,plan_id,number,due_date,amount)
    values(p_user_id,plan.id,i,(plan.first_due_date+((i-1)||' months')::interval)::date,portion);
    remainder:=round(remainder-portion,2);
  end loop;
  perform finance_audit_write(p_user_id,'WEB','CREATE','installment_plan',plan.id,p_account_id,null,null,to_jsonb(plan),'{}'::jsonb);
  return jsonb_build_object('plan',to_jsonb(plan),'installments',(select jsonb_agg(to_jsonb(x) order by x.number) from finance_installments x where x.plan_id=plan.id));
end $$;

create or replace function public.finance_installment_list(p_user_id uuid,p_plan_id uuid default null)
returns jsonb language sql security invoker set search_path=public as $$
  select coalesce(jsonb_agg(to_jsonb(i) order by i.due_date,i.number),'[]'::jsonb)
  from finance_installments i where i.user_id=p_user_id and (p_plan_id is null or i.plan_id=p_plan_id);
$$;

create or replace function public.finance_transactions_query(
  p_user_id uuid, p_search text default null, p_date_from date default null,
  p_date_to date default null, p_type text default null, p_category text default null,
  p_limit integer default 100
)
returns jsonb language sql security invoker set search_path=public as $$
  select coalesce(jsonb_agg(to_jsonb(t) order by t.transaction_date desc,t.created_at desc,t.id desc),'[]'::jsonb)
  from (
    select * from finance_transactions
    where user_id=p_user_id and deleted_at is null
      and (p_search is null or description ilike '%'||p_search||'%' or merchant ilike '%'||p_search||'%')
      and (p_date_from is null or transaction_date>=p_date_from)
      and (p_date_to is null or transaction_date<=p_date_to)
      and (p_type is null or transaction_type=p_type)
      and (p_category is null or category=p_category)
    order by transaction_date desc,created_at desc,id desc
    limit greatest(1,least(coalesce(p_limit,100),500))
  ) t;
$$;

create or replace function public.finance_balance_summary(
  p_user_id uuid, p_date_from date default null, p_date_to date default null
)
returns jsonb language sql security invoker set search_path=public as $$
  with rows as (
    select transaction_type,amount,category from finance_transactions
    where user_id=p_user_id and deleted_at is null
      and (p_date_from is null or transaction_date>=p_date_from)
      and (p_date_to is null or transaction_date<=p_date_to)
  ), totals as (
    select coalesce(sum(amount) filter(where transaction_type='receita'),0) income,
      coalesce(sum(amount) filter(where transaction_type='despesa'),0) expense from rows
  ), cats as (
    select coalesce(jsonb_object_agg(category,total),'{}'::jsonb) value
    from (select category,sum(amount) total from rows where transaction_type='despesa' group by category) x
  ) select jsonb_build_object('income',income,'expense',expense,'balance',income-expense,'byCategory',(select value from cats)) from totals;
$$;

create or replace function public.finance_card_statement_list(p_user_id uuid,p_credit_card_id uuid default null)
returns jsonb language sql security invoker set search_path=public as $$
  select coalesce(jsonb_agg(to_jsonb(s) order by s.due_date nulls last,s.reference_year desc,s.reference_month desc),'[]'::jsonb)
  from finance_card_statements s where s.user_id=p_user_id and (p_credit_card_id is null or s.credit_card_id=p_credit_card_id);
$$;

create or replace function public.finance_subscription_list(p_user_id uuid)
returns jsonb language sql security invoker set search_path=public as $$
  select coalesce(jsonb_agg(to_jsonb(s) order by s.status,s.next_due_date nulls last,s.name),'[]'::jsonb)
  from finance_subscriptions s where s.user_id=p_user_id;
$$;

create or replace function public.finance_timeline(p_user_id uuid,p_date_from date default null,p_date_to date default null,p_limit integer default 200)
returns jsonb language sql security invoker set search_path=public as $$
  select coalesce(jsonb_agg(to_jsonb(x) order by x.event_date desc,x.kind),'[]'::jsonb)
  from (
    select t.transaction_date event_date,'transaction' kind,to_jsonb(t) data
    from finance_transactions t where t.user_id=p_user_id and t.deleted_at is null
      and (p_date_from is null or t.transaction_date>=p_date_from) and (p_date_to is null or t.transaction_date<=p_date_to)
    union all
    select i.due_date,'installment',to_jsonb(i) from finance_installments i where i.user_id=p_user_id
      and (p_date_from is null or i.due_date>=p_date_from) and (p_date_to is null or i.due_date<=p_date_to)
    union all
    select r.due_date,'reminder',to_jsonb(r) from finance_reminders r where r.finance_user_id=p_user_id and r.status='pending'
      and r.due_date is not null and (p_date_from is null or r.due_date>=p_date_from) and (p_date_to is null or r.due_date<=p_date_to)
    union all
    select a.created_at::date,'alert',to_jsonb(a) from finance_alerts a where a.user_id=p_user_id
      and (p_date_from is null or a.created_at::date>=p_date_from) and (p_date_to is null or a.created_at::date<=p_date_to)
    order by event_date desc,kind limit greatest(1,least(coalesce(p_limit,200),500))
  ) x;
$$;

do $$ declare f record; begin
  for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('finance_account_list','finance_account_create','finance_card_list','finance_card_create',
      'finance_transaction_splits_replace','finance_installment_plan_create','finance_installment_list',
      'finance_transactions_query','finance_balance_summary','finance_card_statement_list','finance_subscription_list','finance_timeline') loop
    execute format('revoke all on function %s from public,anon,authenticated',f.sig);
    execute format('grant execute on function %s to service_role',f.sig);
  end loop;
end $$;
