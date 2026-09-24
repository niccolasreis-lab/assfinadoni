-- Manual investments, assets, liabilities and net-worth snapshots.

create table if not exists public.finance_investments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.finance_users(id) on delete cascade,
  institution text,
  category text not null,
  asset text not null,
  quantity numeric check (quantity is null or quantity >= 0),
  invested_amount numeric not null check (invested_amount >= 0 and invested_amount = round(invested_amount,2)),
  current_value numeric check (current_value is null or (current_value >= 0 and current_value = round(current_value,2))),
  valuation_source text not null default 'USER_INFORMED' check (valuation_source in ('USER_INFORMED','CALCULATED','ESTIMATE')),
  recorded_at date not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists finance_investments_owner_idx on public.finance_investments(user_id,recorded_at desc);

create table if not exists public.finance_assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.finance_users(id) on delete cascade,
  name text not null,
  category text not null,
  informed_value numeric not null check (informed_value >= 0 and informed_value = round(informed_value,2)),
  valuation_source text not null default 'USER_INFORMED' check (valuation_source in ('USER_INFORMED','CALCULATED','ESTIMATE')),
  recorded_at date not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.finance_liabilities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.finance_users(id) on delete cascade,
  name text not null,
  category text not null,
  outstanding_amount numeric not null check (outstanding_amount >= 0 and outstanding_amount = round(outstanding_amount,2)),
  due_date date,
  recorded_at date not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists finance_assets_owner_idx on public.finance_assets(user_id,recorded_at desc);
create index if not exists finance_liabilities_owner_idx on public.finance_liabilities(user_id,recorded_at desc);

create table if not exists public.finance_financial_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.finance_users(id) on delete cascade,
  snapshot_date date not null,
  gross_assets numeric not null check (gross_assets >= 0),
  liabilities numeric not null check (liabilities >= 0),
  net_worth numeric not null,
  assumptions jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(user_id,snapshot_date)
);
create index if not exists finance_snapshots_owner_idx on public.finance_financial_snapshots(user_id,snapshot_date desc);

alter table public.finance_investments enable row level security;
alter table public.finance_assets enable row level security;
alter table public.finance_liabilities enable row level security;
alter table public.finance_financial_snapshots enable row level security;
revoke all on public.finance_investments,public.finance_assets,public.finance_liabilities,public.finance_financial_snapshots from public,anon,authenticated;
grant select,insert,update,delete on public.finance_investments,public.finance_assets,public.finance_liabilities,public.finance_financial_snapshots to service_role;

create or replace function public.finance_investment_list(p_user_id uuid)
returns jsonb language sql security invoker set search_path=public as $$
  select coalesce(jsonb_agg(to_jsonb(i) order by i.recorded_at desc,i.created_at desc),'[]'::jsonb) from finance_investments i where i.user_id=p_user_id;
$$;

create or replace function public.finance_investment_create(p_user_id uuid,p_values jsonb)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare i finance_investments;
begin
  insert into finance_investments(user_id,institution,category,asset,quantity,invested_amount,current_value,valuation_source,recorded_at,notes)
  values(p_user_id,p_values->>'institution',btrim(p_values->>'category'),btrim(p_values->>'asset'),(p_values->>'quantity')::numeric,(p_values->>'invested_amount')::numeric,(p_values->>'current_value')::numeric,coalesce(p_values->>'valuation_source','USER_INFORMED'),(p_values->>'recorded_at')::date,p_values->>'notes') returning * into i;
  perform finance_audit_write(p_user_id,'WEB','CREATE','investment',i.id,null,null,null,to_jsonb(i),'{}'::jsonb);
  return to_jsonb(i);
end $$;

create or replace function public.finance_net_worth(p_user_id uuid)
returns jsonb language sql security invoker set search_path=public as $$
  with balances as (select coalesce(sum(case when transaction_type='receita' then amount else -amount end),0) cash from finance_transactions where user_id=p_user_id and deleted_at is null),
  investments as (select coalesce(sum(coalesce(current_value,invested_amount)),0) value from finance_investments where user_id=p_user_id),
  assets as (select coalesce(sum(informed_value),0) value from finance_assets where user_id=p_user_id),
  debts as (select coalesce(sum(outstanding_amount),0) value from finance_liabilities where user_id=p_user_id)
  select jsonb_build_object('cash',balances.cash,'investments',investments.value,'assets',assets.value,'gross_assets',balances.cash+investments.value+assets.value,'liabilities',debts.value,'net_worth',balances.cash+investments.value+assets.value-debts.value,'valuation','USER_INFORMED') from balances,investments,assets,debts;
$$;

do $$ declare f record; begin
  for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('finance_investment_list','finance_investment_create','finance_net_worth') loop
    execute format('revoke all on function %s from public,anon,authenticated',f.sig);
    execute format('grant execute on function %s to service_role',f.sig);
  end loop;
end $$;
