
create table public.finance_whatsapp_alerts (
 id uuid primary key default gen_random_uuid(),
 finance_user_id uuid not null references public.finance_users(id) on delete cascade,
 chat_id text not null check(chat_id='120363433444431792@g.us'),
 actor_jid text,
 description text not null check(length(btrim(description)) between 1 and 180),
 amount numeric(14,2) check(amount>0 and amount<=100000000),
 kind text not null check(kind in ('bill','transfer','payment')),
 due_at timestamptz not null,
 status text not null default 'pending' check(status in ('pending','completed','cancelled')),
 transaction_id uuid references public.finance_transactions(id) on delete set null,
 source_message_id text not null check(length(source_message_id) between 1 and 256),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(finance_user_id,source_message_id)
);
create index finance_wa_alerts_user_pending on public.finance_whatsapp_alerts(finance_user_id,due_at) where status='pending';
create table public.finance_whatsapp_alert_deliveries (
 id uuid primary key default gen_random_uuid(),
 alert_id uuid not null references public.finance_whatsapp_alerts(id) on delete cascade,
 due_version timestamptz not null,
 send_at timestamptz not null,
 status text not null default 'pending' check(status in ('pending','sending','sent','failed','cancelled')),
 lease_token uuid,
 sent_at timestamptz,
 created_at timestamptz not null default now(),
 unique(alert_id,due_version,send_at)
);
create index finance_wa_deliveries_due on public.finance_whatsapp_alert_deliveries(send_at) where status='pending';
alter table public.finance_whatsapp_alerts enable row level security;
alter table public.finance_whatsapp_alert_deliveries enable row level security;
revoke all on public.finance_whatsapp_alerts,public.finance_whatsapp_alert_deliveries from public,anon,authenticated;
grant select,insert,update,delete on public.finance_whatsapp_alerts,public.finance_whatsapp_alert_deliveries to service_role;
create policy finance_wa_service_alerts on public.finance_whatsapp_alerts to service_role using(true) with check(true);
create policy finance_wa_service_deliveries on public.finance_whatsapp_alert_deliveries to service_role using(true) with check(true);

create function public.finance_whatsapp_alert(p_action text,p_user_id uuid default null,p_values jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare
 v_user uuid; v_alert public.finance_whatsapp_alerts%rowtype;
 v_due timestamptz; v_id uuid; v_result jsonb;
begin
 select id into v_user from public.finance_users where telegram_chat_id=120363433 limit 1;
 if v_user is null or (p_user_id is not null and p_user_id<>v_user) then raise exception 'Carteira inválida'; end if;
 if p_action='create' then
  if p_user_id is null then raise exception 'Carteira obrigatória'; end if;
  v_due=(p_values->>'due_at')::timestamptz;
  if v_due is null or v_due<now()-interval '5 minutes' or v_due>now()+interval '366 days' then raise exception 'Data inválida'; end if;
  if nullif(p_values->>'transaction_id','') is not null and not exists(select 1 from public.finance_transactions where id=(p_values->>'transaction_id')::uuid and user_id=v_user and deleted_at is null) then raise exception 'Lançamento inválido'; end if;
  insert into public.finance_whatsapp_alerts(finance_user_id,chat_id,actor_jid,description,amount,kind,due_at,transaction_id,source_message_id)
  values(v_user,'120363433444431792@g.us',nullif(p_values->>'actor_jid',''),p_values->>'description',nullif(p_values->>'amount','')::numeric,p_values->>'kind',v_due,nullif(p_values->>'transaction_id','')::uuid,p_values->>'source_message_id')
  on conflict(finance_user_id,source_message_id) do nothing returning * into v_alert;
  if v_alert.id is null then select * into v_alert from public.finance_whatsapp_alerts where finance_user_id=v_user and source_message_id=p_values->>'source_message_id'; end if;
  insert into public.finance_whatsapp_alert_deliveries(alert_id,due_version,send_at)
  select v_alert.id,v_alert.due_at,t from (values(v_alert.due_at-interval '1 day'),(v_alert.due_at)) as s(t) where t>=now()-interval '5 minutes'
  on conflict do nothing;
  return jsonb_build_object('ok',true,'action',p_action,'alert',to_jsonb(v_alert));
 elsif p_action in ('complete','cancel','snooze') then
  if p_user_id is null then raise exception 'Carteira obrigatória'; end if;
  v_id=(p_values->>'id')::uuid;
  select * into v_alert from public.finance_whatsapp_alerts where id=v_id and finance_user_id=v_user and status='pending' for update;
  if v_alert.id is null then return jsonb_build_object('ok',false,'reason','stale'); end if;
  if p_action='snooze' then
   v_due=(p_values->>'due_at')::timestamptz;
   if v_due is null or v_due<now() or v_due>now()+interval '366 days' then raise exception 'Data inválida'; end if;
   update public.finance_whatsapp_alerts set due_at=v_due,updated_at=now() where id=v_id returning * into v_alert;
  else
   update public.finance_whatsapp_alerts set status=case when p_action='complete' then 'completed' else 'cancelled' end,updated_at=now() where id=v_id returning * into v_alert;
  end if;
  update public.finance_whatsapp_alert_deliveries set status='cancelled' where alert_id=v_id and status='pending';
  if p_action='snooze' then insert into public.finance_whatsapp_alert_deliveries(alert_id,due_version,send_at) values(v_id,v_due,v_due) on conflict do nothing; end if;
  return jsonb_build_object('ok',true,'action',p_action,'alert',to_jsonb(v_alert));
 elsif p_action='claim' then
  with ready as (
   select d.id from public.finance_whatsapp_alert_deliveries d join public.finance_whatsapp_alerts a on a.id=d.alert_id
   where a.finance_user_id=v_user and a.status='pending' and d.due_version=a.due_at and d.status='pending' and d.send_at<=now() and d.send_at>now()-interval '1 day'
   order by d.send_at limit 20 for update of d skip locked
  ), claimed as (
   update public.finance_whatsapp_alert_deliveries d set status='sending',lease_token=gen_random_uuid() from ready where d.id=ready.id returning d.*
  )
  select coalesce(jsonb_agg(jsonb_build_object('delivery_id',d.id,'lease_token',d.lease_token,'send_at',d.send_at,'due_version',d.due_version,'alert',to_jsonb(a))),'[]'::jsonb)
  into v_result from claimed d join public.finance_whatsapp_alerts a on a.id=d.alert_id;
  return jsonb_build_object('deliveries',v_result);
 elsif p_action='check' then
  return jsonb_build_object('ok',exists(select 1 from public.finance_whatsapp_alert_deliveries d join public.finance_whatsapp_alerts a on a.id=d.alert_id where d.id=(p_values->>'delivery_id')::uuid and d.lease_token=(p_values->>'lease_token')::uuid and d.status='sending' and a.finance_user_id=v_user and a.status='pending' and a.due_at=d.due_version));
 elsif p_action='ack' then
  update public.finance_whatsapp_alert_deliveries d set status=case when (p_values->>'success')::boolean then 'sent' else 'failed' end,sent_at=case when (p_values->>'success')::boolean then now() else null end
  where d.id=(p_values->>'delivery_id')::uuid and d.lease_token=(p_values->>'lease_token')::uuid and d.status='sending' and exists(select 1 from public.finance_whatsapp_alerts a where a.id=d.alert_id and a.finance_user_id=v_user);
  return jsonb_build_object('ok',found);
 end if;
 raise exception 'Ação inválida';
end $$;
revoke all on function public.finance_whatsapp_alert(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.finance_whatsapp_alert(text,uuid,jsonb) to service_role;
notify pgrst,'reload schema';

