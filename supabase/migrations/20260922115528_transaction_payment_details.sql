alter table public.finance_transactions add column if not exists payment_details jsonb not null default '{}'::jsonb;

CREATE OR REPLACE FUNCTION public.finance_dashboard_create_transaction(p_account_id uuid, p_transaction_type text, p_amount numeric, p_category text, p_description text, p_transaction_date date, p_payment_details jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r public.finance_transactions; uid uuid;
begin select finance_user_id into uid from dashboard_accounts where id=p_account_id and active;
if uid is null then return null; end if;
insert into finance_transactions(user_id,telegram_message_id,transaction_type,amount,category,description,transaction_date,payment_details,updated_by_account_id)
values(uid,-(extract(epoch from clock_timestamp())*1000000)::bigint,p_transaction_type,p_amount,p_category,p_description,p_transaction_date,coalesce(p_payment_details,'{}'::jsonb),p_account_id) returning * into r; return to_jsonb(r); end $function$
;

CREATE OR REPLACE FUNCTION public.finance_dashboard_update_transaction(p_account_id uuid, p_transaction_id uuid, p_transaction_type text, p_amount numeric, p_category text, p_description text, p_transaction_date date, p_payment_details jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r public.finance_transactions; begin
if not exists(select 1 from dashboard_accounts where id=p_account_id and active) then return null; end if;
update finance_transactions t set transaction_type=p_transaction_type,amount=p_amount,category=p_category,description=p_description,transaction_date=p_transaction_date,payment_details=coalesce(p_payment_details,'{}'::jsonb),updated_by_account_id=p_account_id
where t.id=p_transaction_id and t.deleted_at is null and (exists(select 1 from dashboard_accounts a where a.id=p_account_id and a.active and a.finance_user_id=t.user_id) or exists(select 1 from finance_transaction_shares s where s.transaction_id=t.id and s.shared_with_account_id=p_account_id)) returning t.* into r;
if not found then return null; end if; return to_jsonb(r); end $function$
;
do $$ declare f record; begin
for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('finance_dashboard_create_transaction','finance_dashboard_update_transaction') loop
execute format('revoke all on function %s from public,anon,authenticated',f.sig);
execute format('grant execute on function %s to service_role',f.sig);
end loop; end $$;

