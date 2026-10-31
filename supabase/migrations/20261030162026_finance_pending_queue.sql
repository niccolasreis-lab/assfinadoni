create table public.finance_pending_queue (
 user_id uuid not null references public.finance_users(id),chat_id text not null,sender_id text not null,
 source_message_id text not null,transactions jsonb not null,attachment jsonb,
 version integer not null default 1,status text not null default 'pending' check(status in ('pending','processing','saved','cancelled')),
 claim_id text,lease_until timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),expires_at timestamptz not null default now()+interval '30 minutes',
 primary key(user_id,chat_id,sender_id,source_message_id),
 check(jsonb_typeof(transactions)='array' and jsonb_array_length(transactions) between 1 and 10)
);
alter table public.finance_pending_queue enable row level security;
revoke all on public.finance_pending_queue from public,anon,authenticated;
grant select,insert,update on public.finance_pending_queue to service_role;
create function public.finance_pending_queue_action(p_user_id uuid,p_chat_id text,p_sender_id text,p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare r finance_pending_queue; wanted jsonb; drafts jsonb; receipts jsonb; n integer; tx_count integer; sid text; cid text;
begin
 if p_action is null or p_action not in ('load','put','adjust','cancel','claim','ack') or p_user_id is null or length(coalesce(p_chat_id,'')) not between 1 and 160 or length(coalesce(p_sender_id,'')) not between 1 and 160 or p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception 'Fila inválida' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('pending:'||p_user_id::text||':'||p_chat_id||':'||p_sender_id,0));
 if p_action='put' then
  sid:=p_payload->>'source_message_id';drafts:=p_payload->'transactions';
  if coalesce(sid,'') !~ '^[A-Za-z0-9_-]{1,200}$' or drafts is null or jsonb_typeof(drafts)<>'array' or jsonb_array_length(drafts) not between 1 and 10 then raise exception 'Proposta inválida' using errcode='22023';end if;
  if not exists(select 1 from finance_pending_queue where user_id=p_user_id and chat_id=p_chat_id and sender_id=p_sender_id and source_message_id=sid) then
   select coalesce(sum(jsonb_array_length(transactions)),0) into tx_count from finance_pending_queue where user_id=p_user_id and chat_id=p_chat_id and sender_id=p_sender_id and status in ('pending','processing') and expires_at>now();
   if tx_count+jsonb_array_length(drafts)>10 then raise exception 'Sua fila já tem dez itens. Confirme os pendentes antes de enviar outros comprovantes.' using errcode='22023';end if;
   insert into finance_pending_queue(user_id,chat_id,sender_id,source_message_id,transactions,attachment) values(p_user_id,p_chat_id,p_sender_id,sid,drafts,p_payload->'attachment');
  end if;
 elsif p_action in ('adjust','cancel') then
  for wanted in select value from jsonb_array_elements(coalesce(p_payload->'receipts','[]')) loop
   update finance_pending_queue set transactions=case when p_action='adjust' then wanted->'transactions' else transactions end,
    status=case when p_action='cancel' then 'cancelled' else status end,
    attachment=case when p_action='cancel' then null else attachment end,version=version+1,updated_at=now()
   where user_id=p_user_id and chat_id=p_chat_id and sender_id=p_sender_id and source_message_id=wanted->>'source_message_id'
    and version=(wanted->>'version')::integer and status='pending' and expires_at>now();
   if not found then raise exception 'A fila mudou. Confira os itens antes de confirmar.' using errcode='40001';end if;
  end loop;
 elsif p_action='claim' then
  cid:=p_payload->>'confirmation_id';
  if length(coalesce(cid,'')) not between 1 and 200 or jsonb_typeof(p_payload->'receipts') is distinct from 'array' or jsonb_array_length(p_payload->'receipts') not between 1 and 10 then raise exception 'Confirmação inválida' using errcode='22023';end if;
  for wanted in select value from jsonb_array_elements(p_payload->'receipts') loop
   select * into r from finance_pending_queue where user_id=p_user_id and chat_id=p_chat_id and sender_id=p_sender_id and source_message_id=wanted->>'source_message_id' for update;
   if not found or r.version is distinct from (wanted->>'version')::integer or r.expires_at<=now() or r.status not in ('pending','processing') or (r.status='processing' and r.lease_until>now() and r.claim_id<>cid) then raise exception 'A proposta mudou ou já está sendo confirmada. Aguarde a resposta do bot.' using errcode='40001';end if;
   drafts:=wanted->'transactions';
   if drafts is null or jsonb_typeof(drafts)<>'array' or jsonb_array_length(drafts)<>jsonb_array_length(r.transactions) then raise exception 'Itens da proposta inválidos' using errcode='22023';end if;
   update finance_pending_queue set status='processing',claim_id=cid,lease_until=now()+interval '10 minutes',transactions=drafts,updated_at=now() where user_id=p_user_id and chat_id=p_chat_id and sender_id=p_sender_id and source_message_id=r.source_message_id;
  end loop;
 elsif p_action='ack' then
  for wanted in select value from jsonb_array_elements(coalesce(p_payload->'receipts','[]')) loop
   update finance_pending_queue set status=case when (wanted->>'complete')::boolean then 'saved' else 'pending' end,
    attachment=case when (wanted->>'complete')::boolean then null else attachment end,
    version=version+1,claim_id=null,lease_until=null,updated_at=now()
   where user_id=p_user_id and chat_id=p_chat_id and sender_id=p_sender_id and source_message_id=wanted->>'source_message_id' and status='processing' and claim_id=p_payload->>'confirmation_id';
  end loop;
 elsif p_action<>'load' then raise exception 'Ação da fila inválida' using errcode='22023';
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('source_message_id',source_message_id,'version',version,'transactions',transactions,'attachment',attachment) order by created_at,source_message_id),'[]') into receipts from finance_pending_queue where user_id=p_user_id and chat_id=p_chat_id and sender_id=p_sender_id and expires_at>now() and (status='pending' or (status='processing' and lease_until<=now()));
 return jsonb_build_object('ok',true,'receipts',receipts,'pending_count',(select coalesce(sum(jsonb_array_length(x->'transactions')),0) from jsonb_array_elements(receipts) x));
end $$;
revoke all on function public.finance_pending_queue_action(uuid,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.finance_pending_queue_action(uuid,text,text,text,jsonb) to service_role;
