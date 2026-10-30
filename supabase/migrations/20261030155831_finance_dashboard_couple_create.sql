-- Server-only creation: resolve the wallet from the authenticated account's membership.
create function public.finance_dashboard_couple_create_transaction(
  p_account_id uuid,p_request_id uuid,p_values jsonb
) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare wallets uuid[]; uid uuid; saved finance_transactions; amount_value numeric; payment jsonb;
begin
  perform 1 from dashboard_accounts where id=p_account_id and active for share;
  if not found then raise exception 'Conta não autorizada' using errcode='42501'; end if;
  perform 1 from finance_dashboard_couple_memberships where account_id=p_account_id for share;
  select array_agg(finance_user_id) into wallets from finance_dashboard_couple_memberships where account_id=p_account_id;
  if coalesce(cardinality(wallets),0)<>1 then
    raise exception 'Carteira do casal não autorizada ou ambígua' using errcode='42501';
  end if;
  uid:=wallets[1];
  if p_request_id is null or p_values is null or jsonb_typeof(p_values)<>'object' then
    raise exception 'Lançamento inválido' using errcode='22023';
  end if;
  amount_value:=(p_values->>'amount')::numeric;
  payment:=coalesce(p_values->'payment_details','{}'::jsonb);
  if amount_value is null or amount_value<=0 or amount_value>100000000 or amount_value<>round(amount_value,2)
    or coalesce(p_values->>'transaction_type','') not in ('receita','despesa')
    or length(btrim(coalesce(p_values->>'description',''))) not between 1 and 180
    or length(btrim(coalesce(p_values->>'category',''))) not between 2 and 60
    or coalesce(p_values->>'transaction_date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or (p_values->>'transaction_date')::date > (now() at time zone 'America/Sao_Paulo')::date
    or jsonb_typeof(payment)<>'object' then
    raise exception 'Lançamento inválido; confira valor, categoria e data' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('finance-web-create:'||p_request_id::text,0));
  select * into saved from finance_transactions where id=p_request_id;
  if found then
    if saved.user_id<>uid or saved.updated_by_account_id is distinct from p_account_id then
      raise exception 'Solicitação não autorizada' using errcode='42501';
    end if;
    if saved.deleted_at is not null or saved.amount<>amount_value
      or saved.transaction_type<>p_values->>'transaction_type' or saved.description<>btrim(p_values->>'description')
      or saved.category<>btrim(p_values->>'category') or saved.transaction_date<>(p_values->>'transaction_date')::date
      or coalesce(saved.payment_details->>'method','')<>coalesce(payment->>'method','')
      or coalesce(saved.payment_details->>'cash_amount','')<>coalesce(payment->>'cash_amount','')
      or coalesce(saved.payment_details->>'installments','')<>coalesce(payment->>'installments','')
      or lower(btrim(coalesce(saved.payment_details->>'card_name','')))<>lower(btrim(coalesce(payment->>'card_name',''))) then
      raise exception 'Solicitação já utilizada; abra um novo lançamento' using errcode='22023';
    end if;
    return to_jsonb(saved)||jsonb_build_object('_idempotent_replay',true);
  end if;
  insert into finance_transactions(id,user_id,telegram_message_id,transaction_type,amount,category,description,
    transaction_date,payment_details,updated_by_account_id,source,fingerprint)
  values(p_request_id,uid,-(extract(epoch from clock_timestamp())*1000000)::bigint,p_values->>'transaction_type',
    amount_value,btrim(p_values->>'category'),btrim(p_values->>'description'),(p_values->>'transaction_date')::date,
    payment,p_account_id,'WEB',finance_transaction_fingerprint(uid,p_values->>'transaction_type',amount_value,
      (p_values->>'transaction_date')::date,btrim(p_values->>'description'),btrim(p_values->>'category'),'WEB'))
  returning * into saved;
  return to_jsonb(saved)||jsonb_build_object('_idempotent_replay',false);
end $$;
revoke all on function public.finance_dashboard_couple_create_transaction(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.finance_dashboard_couple_create_transaction(uuid,uuid,jsonb) to service_role;
