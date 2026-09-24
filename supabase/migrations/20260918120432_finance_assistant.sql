-- Only the authenticated backend and VPS worker can access assistant jobs.
create table public.finance_assistant_jobs (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.finance_users(id) on delete cascade,
 account_id uuid references public.dashboard_accounts(id) on delete cascade,
 channel text not null check(channel in ('dashboard','telegram')),
 request_key text not null check(length(request_key) between 1 and 150),
 payload jsonb not null,
 file_hash text,
 status text not null default 'queued' check(status in ('queued','processing','done','awaiting_confirmation','failed')),
 operation jsonb,
 result jsonb,
 lease_token uuid,
 lease_until timestamptz,
 attempts integer not null default 0,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '24 hours',
 delivered_at timestamptz,
 delivery_lease_until timestamptz,
 unique(user_id,channel,request_key)
);
create index finance_assistant_queue_idx on public.finance_assistant_jobs(created_at) where status in ('queued','processing');
create index finance_assistant_owner_idx on public.finance_assistant_jobs(user_id,created_at desc);
create index finance_assistant_hash_idx on public.finance_assistant_jobs(user_id,file_hash) where file_hash is not null;
alter table public.finance_assistant_jobs enable row level security;
revoke all on public.finance_assistant_jobs from public,anon,authenticated;
grant select,insert,update,delete on public.finance_assistant_jobs to service_role;

create function public.finance_assistant_enqueue(p_user_id uuid,p_account_id uuid,p_channel text,p_key text,p_payload jsonb,p_hash text default null)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare j finance_assistant_jobs;
begin
 perform 1 from finance_users where id=p_user_id for update;
 if not found then raise exception 'Unknown owner'; end if;
 if p_account_id is not null and not exists(select 1 from dashboard_accounts where id=p_account_id and finance_user_id=p_user_id and active) then raise exception 'Unknown account'; end if;
 select * into j from finance_assistant_jobs where user_id=p_user_id and channel=p_channel and request_key=p_key;
 if found then return to_jsonb(j)-'payload'-'operation'-'lease_token'; end if;
 if (select count(*) from finance_assistant_jobs where user_id=p_user_id and status in ('queued','processing'))>=5 then raise exception 'Assistant busy' using errcode='54000'; end if;
 if octet_length(p_payload::text)>4200000 then raise exception 'Payload too large'; end if;
 insert into finance_assistant_jobs(user_id,account_id,channel,request_key,payload,file_hash)
 values(p_user_id,p_account_id,p_channel,p_key,p_payload,p_hash) returning * into j;
 return to_jsonb(j)-'payload'-'operation'-'lease_token';
end $$;

create function public.finance_assistant_claim()
returns jsonb language plpgsql security invoker set search_path=public as $$
declare j finance_assistant_jobs;
begin
 -- A single short transaction selects work; no lock is held during model calls.
 perform pg_advisory_xact_lock(18260918);
 delete from finance_assistant_jobs where expires_at<now() and (lease_until is null or lease_until<now());
 update finance_assistant_jobs set status='failed',payload='{}',result='{"text":"O processamento foi interrompido. Envie novamente ou use texto."}',updated_at=now()
 where status='processing' and lease_until<now() and attempts>=3;
 select q.* into j from finance_assistant_jobs q
 where (q.status='queued' or (q.status='processing' and q.lease_until<now())) and q.attempts<3
 and not exists(select 1 from finance_assistant_jobs b where b.user_id=q.user_id and b.status='processing' and b.lease_until>now())
 and not exists(select 1 from finance_assistant_jobs b where b.user_id=q.user_id and b.status='queued' and (b.created_at,b.id)<(q.created_at,q.id))
 order by q.created_at,q.id limit 1 for update skip locked;
 if not found then return null; end if;
 update finance_assistant_jobs set status='processing',lease_token=gen_random_uuid(),lease_until=now()+interval '10 minutes',attempts=attempts+1,updated_at=now()
 where id=j.id returning * into j;
 return to_jsonb(j);
end $$;

-- All financial effects and the final job result commit in the same transaction.
create function public.finance_assistant_finish(p_id uuid,p_lease uuid,p_operation jsonb,p_text text,p_transcript text default '')
returns jsonb language plpgsql security invoker set search_path=public as $$
declare j finance_assistant_jobs; prior finance_assistant_jobs; op jsonb:=p_operation; action text;
 v jsonb; tx finance_transactions; items jsonb:='[]'; confirmation boolean:=false; needs boolean:=false;
 dup boolean:=false; reason text:=''; response text:=left(p_text,3000); rem jsonb;
begin
 select * into j from finance_assistant_jobs where id=p_id for update;
 if not found then return null; end if;
 if j.status not in ('processing','queued') then return to_jsonb(j)-'payload'-'operation'-'lease_token'; end if;
 if j.status<>'processing' or j.lease_token is distinct from p_lease or j.lease_until<=now() then raise exception 'Expired lease'; end if;
 perform 1 from finance_users where id=j.user_id for update;
 if j.account_id is not null and not exists(select 1 from dashboard_accounts where id=j.account_id and finance_user_id=j.user_id and active) then raise exception 'Inactive account'; end if;
 if j.payload->>'action' in ('confirm','cancel') then
   select * into prior from finance_assistant_jobs where id=(j.payload->>'confirmation_id')::uuid and user_id=j.user_id for update;
   if not found or prior.status<>'awaiting_confirmation' or prior.updated_at<now()-interval '30 minutes' then
     op:='{"action":"chat"}'; response:='Essa confirmação expirou ou já foi utilizada. Faça o pedido novamente.';
   elsif j.payload->>'action'='cancel' then
     update finance_assistant_jobs set status='done',operation=null,result=jsonb_build_object('text','Operação cancelada.'),updated_at=now() where id=prior.id;
     op:='{"action":"chat"}'; response:='Operação cancelada.';
   else
     op:=prior.operation; confirmation:=true;
   end if;
 end if;
 action:=op->>'action';
 if action not in ('chat','create','update','delete','reminder','complete_reminder','error') or action is null then raise exception 'Invalid operation'; end if;
 if action in ('create','update') then
   if jsonb_typeof(op->'transactions') is distinct from 'array' or jsonb_array_length(op->'transactions') not between 1 and 10 then raise exception 'Invalid transactions'; end if;
   if action='update' and jsonb_array_length(op->'transactions')<>1 then raise exception 'Ambiguous update'; end if;
   for v in select value from jsonb_array_elements(op->'transactions') loop
     if v->>'transaction_type' not in ('receita','despesa') or v->>'transaction_type' is null
       or (v->>'amount')::numeric is null or (v->>'amount')::numeric<=0 or (v->>'amount')::numeric>1e8
       or round((v->>'amount')::numeric,2)<>(v->>'amount')::numeric
       or v->>'category' is null or v->>'category' not in ('Alimentação','Transporte','Moradia','Saúde','Educação','Lazer','Assinaturas','Outros')
       or length(btrim(coalesce(v->>'description',''))) not between 1 and 180
       or v->>'transaction_date' is null or (v->>'transaction_date')::date>(now() at time zone 'America/Sao_Paulo')::date then raise exception 'Invalid transaction fields'; end if;
     if action='create' and exists(select 1 from finance_transactions t where t.user_id=j.user_id and t.deleted_at is null
       and t.amount=(v->>'amount')::numeric and t.transaction_date=(v->>'transaction_date')::date
       and t.transaction_type=v->>'transaction_type' and lower(btrim(t.description))=lower(btrim(v->>'description'))) then dup:=true; end if;
   end loop;
   if action='create' then
     dup:=dup or (j.file_hash is not null and exists(select 1 from finance_assistant_jobs h where h.user_id=j.user_id and h.file_hash=j.file_hash and h.id<>j.id and h.status in ('done','awaiting_confirmation') and h.operation->>'action'='create'));
     needs:=not confirmation and (dup or jsonb_array_length(op->'transactions')>1);
     reason:=case when dup then 'Encontrei um possível lançamento repetido. Confirma registrar novamente?' else 'Encontrei vários lançamentos. Confirma registrar este conjunto?' end;
   end if;
 end if;
 if action in ('delete','update') then
   select * into tx from finance_transactions where id=(op->>'target_id')::uuid and user_id=j.user_id and deleted_at is null for update;
   if not found then raise exception 'Transaction not owned'; end if;
   if confirmation and op->'snapshot' is distinct from to_jsonb(tx) then raise exception 'Transaction changed'; end if;
   if action='delete' then
     op:=op||jsonb_build_object('snapshot',to_jsonb(tx)); needs:=not confirmation;
     reason:='Confirma enviar este lançamento para a lixeira por 30 dias?'; items:=jsonb_build_array(to_jsonb(tx));
   end if;
 end if;
 if needs then
   if action='create' then items:=op->'transactions'; end if;
   update finance_assistant_jobs set status='awaiting_confirmation',operation=op,payload='{}',lease_until=null,updated_at=now(),
     result=jsonb_build_object('text',reason,'transcript',left(p_transcript,12000),'transactions',items,'confirmation_id',j.id)
   where id=j.id returning * into j;
   return to_jsonb(j)-'payload'-'operation'-'lease_token';
 end if;
 if action='create' then
   for v in select value from jsonb_array_elements(op->'transactions') loop
     insert into finance_transactions(user_id,telegram_message_id,transaction_type,amount,category,description,transaction_date,updated_by_account_id)
     values(j.user_id,-(extract(epoch from clock_timestamp())*1000000)::bigint,v->>'transaction_type',(v->>'amount')::numeric,v->>'category',v->>'description',(v->>'transaction_date')::date,j.account_id) returning * into tx;
     items:=items||jsonb_build_array(to_jsonb(tx));
   end loop;
   response:='Lançamento registrado.';
 elsif action='update' then
   v:=op->'transactions'->0;
   update finance_transactions set transaction_type=v->>'transaction_type',amount=(v->>'amount')::numeric,category=v->>'category',description=v->>'description',transaction_date=(v->>'transaction_date')::date,updated_by_account_id=j.account_id where id=tx.id returning * into tx;
   items:=jsonb_build_array(to_jsonb(tx)); response:='Lançamento atualizado.';
 elsif action='delete' then
   update finance_transactions set deleted_at=now(),deleted_by_account_id=j.account_id where id=tx.id returning * into tx;
   items:=jsonb_build_array(to_jsonb(tx)); response:='Lançamento enviado à lixeira. Você pode restaurá-lo em até 30 dias.';
 elsif action='reminder' then
   rem:=finance_reminder_create(j.user_id,(op->'values')||jsonb_build_object('external_key','assistant:'||j.id,'source',case when j.channel='dashboard' then 'web' else 'telegram' end));
   response:='Pendência salva ('||(rem->>'short_code')||'). Você pode acompanhar na central de lembretes.';
 elsif action='complete_reminder' then
   rem:=finance_reminder_action(j.user_id,(op->>'target_id')::uuid,'complete',op->'values',j.account_id);
   if rem is null then raise exception 'Reminder not owned'; end if;
   select * into tx from finance_transactions where id=(rem->>'completed_transaction_id')::uuid and user_id=j.user_id;
   items:=jsonb_build_array(to_jsonb(tx)); response:='Pendência concluída. Lançamento atualizado.';
 end if;
 if confirmation then
   update finance_assistant_jobs set status='done',operation=null,result=jsonb_build_object('text','Confirmação utilizada.'),updated_at=now() where id=prior.id;
 end if;
 update finance_assistant_jobs set status=case when action='error' then 'failed' else 'done' end,operation=op,payload='{}',lease_until=null,updated_at=now(),
   result=jsonb_build_object('text',response,'transcript',left(p_transcript,12000),'transactions',items,'reminder',rem,'changed',action in ('create','update','delete','reminder','complete_reminder'))
 where id=j.id returning * into j;
 return to_jsonb(j)-'payload'-'operation'-'lease_token';
end $$;

create function public.finance_assistant_delivery_claim()
returns jsonb language plpgsql security invoker set search_path=public as $$
declare j finance_assistant_jobs;
begin
 select * into j from finance_assistant_jobs where channel='telegram' and status in ('done','failed','awaiting_confirmation') and delivered_at is null
 and (delivery_lease_until is null or delivery_lease_until<now()) and expires_at>now() order by created_at limit 1 for update skip locked;
 if not found then return null; end if;
 update finance_assistant_jobs set delivery_lease_until=now()+interval '2 minutes' where id=j.id returning * into j;
 return to_jsonb(j)-'payload'-'operation'-'lease_token';
end $$;

do $$ declare f record; begin
 for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'finance_assistant_%' loop
 execute format('revoke all on function %s from public,anon,authenticated',f.sig);
 execute format('grant execute on function %s to service_role',f.sig);
 end loop;
end $$;
