-- Service-role/owner smoke test. No network sends. Every fixture/change is rolled back.
begin;
do $$
declare
  aid uuid; uid uuid; item jsonb; duplicate jsonb; done_once jsonb; done_twice jsonb;
  rid uuid; claims jsonb; claimed jsonb; stale uuid; today date:=(now() at time zone 'America/Sao_Paulo')::date;
begin
  select id,finance_user_id into aid,uid from public.dashboard_accounts where active order by created_at limit 1;
  if aid is null then raise exception 'Smoke requires one active account'; end if;
  item:=public.finance_reminder_create(uid,jsonb_build_object('kind','bill','description','Synthetic rollback-only smoke','amount',1.25,'category','Outros','due_date',today+3,'external_key','smoke:'||gen_random_uuid()::text));
  rid:=(item->>'id')::uuid;
  duplicate:=public.finance_reminder_create(uid,item-'id'-'short_code'-'finance_user_id'-'status'-'completed_transaction_id'-'created_at'-'updated_at');
  if duplicate->>'id'<>item->>'id' then raise exception 'Idempotent create failed'; end if;
  if public.finance_reminder_action(gen_random_uuid(),rid,'cancel') is not null then raise exception 'Owner isolation failed'; end if;
  claims:=public.finance_notification_claim((today::timestamp+interval '12 hours') at time zone 'UTC',50);
  select value into claimed from jsonb_array_elements(claims) where value->>'reminder_id'=rid::text limit 1;
  -- A Telegram-linked account or subscribed browser is needed to exercise delivery leasing.
  if claimed is not null then
    stale:=gen_random_uuid();
    if public.finance_notification_ack((claimed->>'id')::uuid,stale,true) then raise exception 'Stale lease accepted'; end if;
    if not public.finance_notification_ack((claimed->>'id')::uuid,(claimed->>'lease_token')::uuid,true) then raise exception 'Current lease rejected'; end if;
  end if;
  begin
    perform public.finance_reminder_action(uid,rid,'complete',jsonb_build_object('transaction_date',today+1),aid);
    raise exception 'Future transaction accepted';
  exception when invalid_parameter_value then null;
  end;
  done_once:=public.finance_reminder_action(uid,rid,'complete',jsonb_build_object('transaction_date',today),aid);
  done_twice:=public.finance_reminder_action(uid,rid,'complete',jsonb_build_object('transaction_date',today),aid);
  if done_once->>'completed_transaction_id' is null or done_once->>'completed_transaction_id'<>done_twice->>'completed_transaction_id' then raise exception 'Atomic completion idempotence failed'; end if;
  if exists(select 1 from public.finance_notification_deliveries where reminder_id=rid and status in ('pending','leased')) then raise exception 'Completion retained active deliveries'; end if;
end $$;
rollback;
