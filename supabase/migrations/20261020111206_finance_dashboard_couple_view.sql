-- Explicit, service-managed access to a shared wallet. Personal ownership is unchanged.
create table if not exists public.finance_dashboard_couple_memberships (
  account_id uuid not null references public.dashboard_accounts(id) on delete cascade,
  finance_user_id uuid not null references public.finance_users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (account_id, finance_user_id)
);
alter table public.finance_dashboard_couple_memberships enable row level security;
revoke all on public.finance_dashboard_couple_memberships from public,anon,authenticated;
grant select,insert,update,delete on public.finance_dashboard_couple_memberships to service_role;

create or replace function public.finance_dashboard_couple_transactions(p_account_id uuid,p_values jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare
  wallets uuid[]; month_start date; month_end date; date_from date; date_to date;
  page_number integer:=coalesce((p_values->>'page')::integer,1); page_size integer:=50;
  requested_view text:=coalesce(p_values->>'view','active');
  search_text text:=nullif(btrim(p_values->>'q'),''); category_name text:=nullif(p_values->>'category','');
  selected_type text:=nullif(p_values->>'type',''); rows_json jsonb; summary_json jsonb;
begin
  if not exists(select 1 from dashboard_accounts where id=p_account_id and active) then
    raise exception 'Acesso à carteira do casal não autorizado' using errcode='42501';
  end if;
  select array_agg(finance_user_id) into wallets from finance_dashboard_couple_memberships where account_id=p_account_id;
  if wallets is null then raise exception 'Acesso à carteira do casal não autorizado' using errcode='42501'; end if;
  if requested_view not in ('active','trash') or page_number not between 1 and 9999
    or length(coalesce(search_text,''))>120 or length(coalesce(category_name,''))>80
    or (selected_type is not null and selected_type not in ('receita','despesa'))
    or coalesce(p_values->>'month','') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'Filtros inválidos' using errcode='22023';
  end if;
  month_start:=((p_values->>'month')||'-01')::date;
  month_end:=(month_start+interval '1 month')::date;
  date_from:=nullif(p_values->>'date_from','')::date;
  date_to:=nullif(p_values->>'date_to','')::date;
  if date_from is not null and date_to is not null and date_from>date_to then
    raise exception 'Intervalo inválido' using errcode='22023';
  end if;
  if requested_view='active' and date_from is null and date_to is null then date_from:=month_start; date_to:=month_end-1; end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.transaction_date desc,x.created_at desc,x.id desc),'[]'::jsonb) into rows_json
  from (
    select t.*,false is_owner,false is_shared,true read_only,'Finanças do casal'::text owner_name
    from finance_transactions t where t.user_id=any(wallets)
      and ((requested_view='active' and t.deleted_at is null) or (requested_view='trash' and t.deleted_at>now()-interval '30 days'))
      and (search_text is null or t.description ilike '%'||search_text||'%')
      and (category_name is null or t.category=category_name)
      and (selected_type is null or t.transaction_type=selected_type)
      and (date_from is null or t.transaction_date>=date_from)
      and (date_to is null or t.transaction_date<=date_to)
    order by t.transaction_date desc,t.created_at desc,t.id desc offset (page_number-1)*page_size limit page_size+1
  ) x;
  with monthly as (
    select transaction_type,amount,category from finance_transactions where user_id=any(wallets)
      and deleted_at is null and transaction_date>=month_start and transaction_date<month_end
  ), totals as (
    select coalesce(sum(amount) filter(where transaction_type='receita'),0) income,
      coalesce(sum(amount) filter(where transaction_type='despesa'),0) expense from monthly
  ) select jsonb_build_object('income',income,'expense',expense,'balance',income-expense,'byCategory',
    coalesce((select jsonb_object_agg(category,total) from (select category,sum(amount) total from monthly where transaction_type='despesa' group by category) categories),'{}'::jsonb))
    into summary_json from totals;
  return jsonb_build_object('transactions',(select coalesce(jsonb_agg(value order by ord),'[]'::jsonb) from jsonb_array_elements(rows_json) with ordinality e(value,ord) where ord<=page_size),
    'summary',summary_json,'pagination',jsonb_build_object('page',page_number,'pageSize',page_size,'hasMore',jsonb_array_length(rows_json)>page_size),'scope','couple','readOnly',true);
end $$;
revoke all on function public.finance_dashboard_couple_transactions(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.finance_dashboard_couple_transactions(uuid,jsonb) to service_role;
