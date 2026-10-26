-- Additive protection: deleted rows continue to reserve their source event.
create unique index finance_transactions_user_external_event_uidx
  on public.finance_transactions(user_id,external_event_id) where external_event_id is not null;

create table public.finance_external_event_tombstones (
  user_id uuid not null references public.finance_users(id) on delete cascade,
  external_event_id text not null,
  deleted_at timestamptz not null default now(),
  primary key(user_id,external_event_id)
);
alter table public.finance_external_event_tombstones enable row level security;
revoke all on public.finance_external_event_tombstones from public,anon,authenticated;
grant select,insert on public.finance_external_event_tombstones to service_role;

create function public.finance_preserve_external_event()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  if old.external_event_id is not null and exists(select 1 from finance_users where id=old.user_id) then
    insert into finance_external_event_tombstones(user_id,external_event_id)
    values(old.user_id,old.external_event_id) on conflict do nothing;
  end if;
  return old;
end $$;
create trigger finance_preserve_external_event after delete on public.finance_transactions
for each row execute function public.finance_preserve_external_event();

-- Serialize name resolution per wallet; identical labels may exist in separate wallets.
create unique index finance_credit_cards_active_name_uidx
on public.finance_credit_cards(user_id,lower(regexp_replace(btrim(name),'\s+',' ','g')))
where status='active';

create function public.finance_bind_transaction_card()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
declare payment jsonb:=coalesce(new.payment_details,'{}'::jsonb); card finance_credit_cards; label text; key text;
begin
  if tg_op='INSERT' and new.external_event_id is not null and exists(
    select 1 from finance_external_event_tombstones where user_id=new.user_id and external_event_id=new.external_event_id) then
    raise exception 'Este evento foi excluído permanentemente' using errcode='23505';
  end if;
  if jsonb_typeof(payment)<>'object' then raise exception 'Forma de pagamento inválida' using errcode='22023'; end if;
  if new.transaction_type<>'despesa' or coalesce(payment->>'method','') not in ('cartao','misto') then
    new.payment_details:=payment-'credit_card_id'-'card_name'; return new;
  end if;
  -- Older clients editing an unrelated field must not erase an existing card.
  if tg_op='UPDATE' and not payment?'card_name' and not payment?'credit_card_id'
    and payment->>'method'=old.payment_details->>'method' then
    payment:=payment || jsonb_strip_nulls(jsonb_build_object('card_name',old.payment_details->'card_name','credit_card_id',old.payment_details->'credit_card_id'));
  end if;
  label:=nullif(regexp_replace(btrim(payment->>'card_name'),'\s+',' ','g'),'');
  if label is not null and (length(label)>80 or label !~ '^[[:alnum:] .&()/''-]+$' or label ~ '[0-9][0-9 .-]{10,}[0-9]') then
    raise exception 'Informe apenas o nome ou apelido do cartão' using errcode='22023';
  end if;
  if nullif(payment->>'credit_card_id','') is not null then
    select * into card from finance_credit_cards where id=(payment->>'credit_card_id')::uuid and user_id=new.user_id and status='active';
    if not found then raise exception 'Cartão não pertence à carteira' using errcode='42501'; end if;
    if label is not null and lower(label)<>lower(regexp_replace(btrim(card.name),'\s+',' ','g')) then
      raise exception 'Nome e cartão selecionado não correspondem' using errcode='22023';
    end if;
  elsif label is not null then
    key:=lower(label);
    perform pg_advisory_xact_lock(hashtextextended('finance-card:'||new.user_id::text||':'||key,0));
    select * into card from finance_credit_cards where user_id=new.user_id and status='active'
      and lower(regexp_replace(btrim(name),'\s+',' ','g'))=key;
    if not found then
      insert into finance_credit_cards(user_id,name) values(new.user_id,label) returning * into card;
    end if;
  else
    new.payment_details:=payment-'card_name'-'credit_card_id'; return new;
  end if;
  new.payment_details:=payment||jsonb_build_object('card_name',card.name,'credit_card_id',card.id);
  return new;
end $$;
create trigger finance_bind_transaction_card before insert or update of payment_details,user_id,transaction_type
on public.finance_transactions for each row execute function public.finance_bind_transaction_card();

-- One atomic, service-only boundary for confirmed WhatsApp transactions.
create function public.finance_whatsapp_record_transaction(
  p_user_id uuid,p_event_id text,p_legacy_key bigint,p_values jsonb,p_confirmed boolean
) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare saved finance_transactions; amount_value numeric; payment jsonb;
begin
  if p_confirmed is distinct from true or p_user_id is null or p_legacy_key is null
    or p_event_id is null or p_event_id !~ '^wa:[A-Za-z0-9_-]+:[0-9]+$' or length(p_event_id)>240
    or p_values is null or jsonb_typeof(p_values)<>'object' then
    raise exception 'Confirme uma proposta válida antes de registrar' using errcode='22023';
  end if;
  amount_value:=(p_values->>'amount')::numeric;
  payment:=coalesce(p_values->'payment_details','{}'::jsonb);
  if amount_value is null or amount_value<=0 or amount_value>100000000 or amount_value<>round(amount_value,2)
    or coalesce(p_values->>'transaction_type','') not in ('receita','despesa')
    or length(btrim(coalesce(p_values->>'description',''))) not between 1 and 180
    or length(btrim(coalesce(p_values->>'category',''))) not between 1 and 80
    or coalesce(p_values->>'transaction_date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or jsonb_typeof(payment)<>'object' then
    raise exception 'Movimentação inválida' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('finance-event:'||p_user_id::text||':'||p_event_id,0));
  if exists(select 1 from finance_external_event_tombstones where user_id=p_user_id and external_event_id=p_event_id) then
    raise exception 'Este evento foi excluído permanentemente e não pode ser recriado' using errcode='23505';
  end if;
  select * into saved from finance_transactions where user_id=p_user_id and external_event_id=p_event_id;
  if found then
    if saved.amount<>amount_value or saved.transaction_type<>p_values->>'transaction_type'
      or saved.description<>p_values->>'description' or saved.category<>p_values->>'category'
      or saved.transaction_date<>(p_values->>'transaction_date')::date
      or coalesce(saved.payment_details->>'method','')<>coalesce(payment->>'method','')
      or (nullif(payment->>'card_name','') is not null and lower(btrim(payment->>'card_name'))<>lower(btrim(coalesce(saved.payment_details->>'card_name','')))) then
      raise exception 'Evento já registrado com dados diferentes; consulte o lançamento existente' using errcode='22023';
    end if;
    return to_jsonb(saved)||jsonb_build_object('_idempotent_replay',true);
  end if;
  insert into finance_transactions(user_id,telegram_message_id,external_event_id,idempotency_key,transaction_type,amount,description,category,transaction_date,payment_details,source)
  values(p_user_id,p_legacy_key,p_event_id,p_event_id,p_values->>'transaction_type',amount_value,p_values->>'description',p_values->>'category',(p_values->>'transaction_date')::date,payment,'API')
  returning * into saved;
  return to_jsonb(saved)||jsonb_build_object('_idempotent_replay',false);
end $$;

revoke all on function public.finance_preserve_external_event(),public.finance_bind_transaction_card(),public.finance_whatsapp_record_transaction(uuid,text,bigint,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.finance_preserve_external_event(),public.finance_bind_transaction_card(),public.finance_whatsapp_record_transaction(uuid,text,bigint,jsonb,boolean) to service_role;

create function public.finance_dashboard_card_list(p_account_id uuid,p_scope text default 'mine')
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare own_wallet uuid; result jsonb;
begin
  if p_scope is null or p_scope not in ('mine','couple','all') then raise exception 'Escopo inválido' using errcode='22023'; end if;
  select finance_user_id into own_wallet from dashboard_accounts where id=p_account_id and active;
  if not found then raise exception 'Conta não autorizada' using errcode='42501'; end if;
  if p_scope='couple' and not exists(select 1 from finance_dashboard_couple_memberships where account_id=p_account_id) then
    raise exception 'Carteira do casal não autorizada' using errcode='42501';
  end if;
  select coalesce(jsonb_agg(to_jsonb(c)||jsonb_build_object('wallet_scope',case when c.user_id=own_wallet then 'mine' else 'couple' end) order by c.name),'[]'::jsonb)
  into result from finance_credit_cards c where c.status='active' and
    ((p_scope in ('mine','all') and c.user_id=own_wallet) or (p_scope in ('couple','all') and exists(
      select 1 from finance_dashboard_couple_memberships m where m.account_id=p_account_id and m.finance_user_id=c.user_id)));
  return result;
end $$;
revoke all on function public.finance_dashboard_card_list(uuid,text) from public,anon,authenticated;
grant execute on function public.finance_dashboard_card_list(uuid,text) to service_role;
