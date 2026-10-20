create extension if not exists pgcrypto with schema extensions;
-- Web-only users have no Telegram identity until explicitly linked.
alter table public.finance_users alter column telegram_chat_id drop not null;

create table if not exists public.dashboard_accounts (
  id uuid primary key default gen_random_uuid(),
  username text not null unique check (username = lower(username) and username ~ '^[a-z0-9_]{3,40}$'),
  display_name text not null,
  password_hash text not null,
  finance_user_id uuid not null unique references public.finance_users(id) on delete cascade,
  session_version integer not null default 1,
  active boolean not null default true,
  failed_login_count integer not null default 0,
  failed_login_window_start timestamptz,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.finance_transaction_shares (
  transaction_id uuid not null references public.finance_transactions(id) on delete cascade,
  shared_with_account_id uuid not null references public.dashboard_accounts(id) on delete cascade,
  shared_by_account_id uuid not null references public.dashboard_accounts(id),
  shared_at timestamptz not null default now(),
  primary key (transaction_id, shared_with_account_id)
);

alter table public.finance_transactions
  add column if not exists updated_by_account_id uuid references public.dashboard_accounts(id),
  add column if not exists deleted_by_account_id uuid references public.dashboard_accounts(id);

create index if not exists finance_transaction_shares_recipient_idx on public.finance_transaction_shares(shared_with_account_id, transaction_id);
alter table public.dashboard_accounts add column if not exists failed_login_window_start timestamptz;
alter table public.dashboard_accounts enable row level security;
alter table public.finance_transaction_shares enable row level security;
revoke all on public.dashboard_accounts, public.finance_transaction_shares from public, anon, authenticated;
grant select, insert, update, delete on public.dashboard_accounts, public.finance_transaction_shares to service_role;

create or replace function public.finance_dashboard_record_login_failure(p_username text, p_ip text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  update dashboard_accounts set
    failed_login_count = case when failed_login_window_start is null or failed_login_window_start <= now()-interval '15 minutes' then 1 else failed_login_count+1 end,
    failed_login_window_start = case when failed_login_window_start is null or failed_login_window_start <= now()-interval '15 minutes' then now() else failed_login_window_start end,
    locked_until = case when locked_until > now() then locked_until when failed_login_window_start > now()-interval '15 minutes' and failed_login_count+1 >= 5 then now()+interval '15 minutes' else null end,
    updated_at = now()
  where username = lower(p_username);
end $$;

create or replace function public.finance_dashboard_clear_login_failures(p_account_id uuid)
returns void language sql security definer set search_path = public as $$
  update dashboard_accounts set failed_login_count = 0, failed_login_window_start = null, locked_until = null, updated_at = now() where id = p_account_id and active;
$$;

create or replace function public.finance_dashboard_list_transactions(
  p_account_id uuid, p_scope text, p_view text, p_search text default null, p_category text default null,
  p_type text default null, p_date_from date default null, p_date_to date default null, p_page integer default 1, p_page_size integer default 50)
returns jsonb language sql security definer set search_path = public as $$
  with me as (select finance_user_id from dashboard_accounts where id=p_account_id and active),
  accessible as (
    select t.*, owner.id owner_account_id, owner.username owner_username, owner.display_name owner_name,
      (t.user_id=(select finance_user_id from me)) is_owner,
      exists(select 1 from finance_transaction_shares s where s.transaction_id=t.id and (s.shared_with_account_id=p_account_id or s.shared_by_account_id=p_account_id)) is_shared
    from finance_transactions t
    join dashboard_accounts owner on owner.finance_user_id=t.user_id
    where exists(select 1 from me) and ((p_scope in ('mine','all') and t.user_id=(select finance_user_id from me))
      or (p_scope in ('shared','all') and exists(select 1 from finance_transaction_shares s where s.transaction_id=t.id and s.shared_with_account_id=p_account_id)))
      and ((p_view='active' and t.deleted_at is null) or (p_view='trash' and t.deleted_at >= now()-interval '30 days'))
      and (p_search is null or t.description ilike '%'||p_search||'%')
      and (p_category is null or t.category=p_category) and (p_type is null or t.transaction_type=p_type)
      and (p_date_from is null or t.transaction_date>=p_date_from) and (p_date_to is null or t.transaction_date<=p_date_to)
  ), paged as (
    select * from accessible order by case when p_view='trash' then deleted_at end desc nulls last, transaction_date desc, created_at desc, id desc
    limit p_page_size+1 offset greatest(p_page-1,0)*p_page_size
  )
  select jsonb_build_object('transactions',coalesce((select jsonb_agg(to_jsonb(x)) from (select * from paged limit p_page_size) x),'[]'::jsonb),
    'has_more',(select count(*)>p_page_size from paged));
$$;

create or replace function public.finance_dashboard_monthly_summary(p_account_id uuid, p_month_start date, p_month_end date, p_include_shared boolean default false)
returns jsonb language sql security definer set search_path = public as $$
  with me as (select finance_user_id from dashboard_accounts where id=p_account_id and active), rows as (
    select distinct t.id,t.transaction_type,t.amount,t.category from finance_transactions t
    where exists(select 1 from me) and t.deleted_at is null and t.transaction_date>=p_month_start and t.transaction_date<p_month_end
      and (t.user_id=(select finance_user_id from me) or (p_include_shared and exists(select 1 from finance_transaction_shares s where s.transaction_id=t.id and s.shared_with_account_id=p_account_id)))
  ), totals as (select coalesce(sum(amount) filter(where transaction_type='receita'),0) income, coalesce(sum(amount) filter(where transaction_type='despesa'),0) expense from rows),
  cats as (select coalesce(jsonb_object_agg(category,total),'{}'::jsonb) value from (select category,sum(amount) total from rows where transaction_type='despesa' group by category) c)
  select jsonb_build_object('income',income,'expense',expense,'balance',income-expense,'byCategory',(select value from cats)) from totals;
$$;

create or replace function public.finance_dashboard_create_transaction(p_account_id uuid,p_transaction_type text,p_amount numeric,p_category text,p_description text,p_transaction_date date)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r finance_transactions; uid uuid; begin
 select finance_user_id into uid from dashboard_accounts where id=p_account_id and active;
 if uid is null then return null; end if;
 insert into finance_transactions(user_id,telegram_message_id,transaction_type,amount,category,description,transaction_date,updated_by_account_id)
 values(uid,-(extract(epoch from clock_timestamp())*1000000)::bigint,p_transaction_type,p_amount,p_category,p_description,p_transaction_date,p_account_id) returning * into r;
 return to_jsonb(r); end $$;

create or replace function public.finance_dashboard_update_transaction(p_account_id uuid,p_transaction_id uuid,p_transaction_type text,p_amount numeric,p_category text,p_description text,p_transaction_date date)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r finance_transactions; begin
 if not exists(select 1 from dashboard_accounts where id=p_account_id and active) then return null; end if;
 update finance_transactions t set transaction_type=p_transaction_type,amount=p_amount,category=p_category,description=p_description,transaction_date=p_transaction_date,updated_by_account_id=p_account_id
 where t.id=p_transaction_id and t.deleted_at is null and (exists(select 1 from dashboard_accounts a where a.id=p_account_id and a.active and a.finance_user_id=t.user_id) or exists(select 1 from finance_transaction_shares s where s.transaction_id=t.id and s.shared_with_account_id=p_account_id)) returning t.* into r;
 if not found then return null; end if; return to_jsonb(r); end $$;

create or replace function public.finance_dashboard_delete_transaction(p_account_id uuid,p_transaction_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r finance_transactions; begin
 if not exists(select 1 from dashboard_accounts where id=p_account_id and active) then return null; end if;
 update finance_transactions t set deleted_at=now(),deleted_by_account_id=p_account_id where t.id=p_transaction_id and t.deleted_at is null and (exists(select 1 from dashboard_accounts a where a.id=p_account_id and a.active and a.finance_user_id=t.user_id) or exists(select 1 from finance_transaction_shares s where s.transaction_id=t.id and s.shared_with_account_id=p_account_id)) returning t.* into r; if not found then return null; end if; return to_jsonb(r); end $$;

create or replace function public.finance_dashboard_restore_transaction(p_account_id uuid,p_transaction_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r finance_transactions; begin
 if not exists(select 1 from dashboard_accounts where id=p_account_id and active) then return null; end if;
 update finance_transactions t set deleted_at=null,deleted_by_account_id=null,updated_by_account_id=p_account_id where t.id=p_transaction_id and t.deleted_at>=now()-interval '30 days' and (exists(select 1 from dashboard_accounts a where a.id=p_account_id and a.active and a.finance_user_id=t.user_id) or exists(select 1 from finance_transaction_shares s where s.transaction_id=t.id and s.shared_with_account_id=p_account_id)) returning t.* into r; if not found then return null; end if; return to_jsonb(r); end $$;

create or replace function public.finance_dashboard_share_state(p_account_id uuid,p_transaction_id uuid default null)
returns jsonb language sql security definer set search_path=public as $$
 select jsonb_build_object('candidates',coalesce((select jsonb_agg(jsonb_build_object('id',id,'username',username,'name',display_name)) from dashboard_accounts where active and id<>p_account_id),'[]'::jsonb),
 'share',(select to_jsonb(s) from finance_transaction_shares s where s.transaction_id=p_transaction_id and (s.shared_with_account_id=p_account_id or s.shared_by_account_id=p_account_id) limit 1));
$$;

create or replace function public.finance_dashboard_share_transaction(p_account_id uuid,p_transaction_id uuid,p_recipient_account_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare recipient uuid; r finance_transaction_shares; begin
 if not exists(select 1 from finance_transactions t join dashboard_accounts a on a.finance_user_id=t.user_id where t.id=p_transaction_id and a.id=p_account_id and a.active and t.deleted_at is null) then return null; end if;
 select id into recipient from dashboard_accounts where active and id<>p_account_id and (p_recipient_account_id is null or id=p_recipient_account_id) order by username limit 1;
 if recipient is null then return null; end if;
 insert into finance_transaction_shares(transaction_id,shared_with_account_id,shared_by_account_id) values(p_transaction_id,recipient,p_account_id)
 on conflict(transaction_id,shared_with_account_id) do update set shared_by_account_id=excluded.shared_by_account_id,shared_at=now() returning * into r; return to_jsonb(r); end $$;

create or replace function public.finance_dashboard_unshare_transaction(p_account_id uuid,p_transaction_id uuid)
returns boolean language plpgsql security definer set search_path=public as $$
declare n integer; begin if not exists(select 1 from dashboard_accounts where id=p_account_id and active) then return false; end if; delete from finance_transaction_shares s where s.transaction_id=p_transaction_id and (s.shared_with_account_id=p_account_id or s.shared_by_account_id=p_account_id); get diagnostics n=row_count; return n>0; end $$;

do $$ declare f record; begin for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'finance_dashboard_%' loop execute format('revoke all on function %s from public, anon, authenticated',f.sig); execute format('grant execute on function %s to service_role',f.sig); end loop; end $$;
