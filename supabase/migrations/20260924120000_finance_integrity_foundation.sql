-- Foundation for idempotent ingestion, duplicate review, attachments and audit.
-- This migration is additive and keeps all existing dashboard contracts intact.

create table if not exists public.finance_processing_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.finance_users(id) on delete cascade,
  source text not null check (source in ('WEB','APK','TELEGRAM','API','MCP','SYSTEM','AI')),
  external_event_id text,
  idempotency_key text not null,
  payload_hash text,
  status text not null default 'received' check (status in ('received','processing','succeeded','failed','ignored')),
  result jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, source, idempotency_key)
);

create unique index if not exists finance_processing_events_external_uidx
  on public.finance_processing_events(user_id, source, external_event_id)
  where external_event_id is not null;
create index if not exists finance_processing_events_status_idx
  on public.finance_processing_events(status, created_at);

alter table public.finance_transactions
  add column if not exists source text default 'SYSTEM',
  add column if not exists external_event_id text,
  add column if not exists idempotency_key text,
  add column if not exists payload_hash text,
  add column if not exists fingerprint text,
  add column if not exists occurred_at timestamptz,
  add column if not exists merchant text;

create index if not exists finance_transactions_fingerprint_idx
  on public.finance_transactions(user_id, fingerprint, transaction_date)
  where deleted_at is null and fingerprint is not null;

create table if not exists public.finance_transaction_duplicates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.finance_users(id) on delete cascade,
  transaction_id uuid not null references public.finance_transactions(id) on delete cascade,
  candidate_transaction_id uuid not null references public.finance_transactions(id) on delete cascade,
  kind text not null check (kind in ('EXACT_DUPLICATE','POSSIBLE_DUPLICATE')),
  confidence numeric not null check (confidence >= 0 and confidence <= 1),
  reasons jsonb not null default '[]'::jsonb,
  status text not null default 'open' check (status in ('open','confirmed','ignored','merged')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by_account_id uuid references public.dashboard_accounts(id),
  unique (transaction_id, candidate_transaction_id)
);
create index if not exists finance_transaction_duplicates_owner_idx
  on public.finance_transaction_duplicates(user_id, status, created_at desc);

create table if not exists public.finance_attachments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.finance_users(id) on delete cascade,
  transaction_id uuid references public.finance_transactions(id) on delete set null,
  processing_event_id uuid references public.finance_processing_events(id) on delete set null,
  sha256 text not null,
  mime_type text not null,
  original_name text,
  storage_path text,
  size_bytes bigint not null check (size_bytes > 0),
  extraction_status text not null default 'pending' check (extraction_status in ('pending','processing','succeeded','failed')),
  extracted_data jsonb,
  confidence numeric check (confidence >= 0 and confidence <= 1),
  created_at timestamptz not null default now(),
  unique (user_id, sha256)
);
create index if not exists finance_attachments_transaction_idx
  on public.finance_attachments(transaction_id, created_at desc);

create table if not exists public.finance_audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.finance_users(id) on delete cascade,
  account_id uuid references public.dashboard_accounts(id) on delete set null,
  origin text not null check (origin in ('WEB','APK','TELEGRAM','API','MCP','SYSTEM','AI')),
  action text not null check (action in ('CREATE','UPDATE','DELETE','IMPORT','MERGE','AI_ACTION','USER_CONFIRMATION','SYSTEM_ACTION')),
  entity_type text not null,
  entity_id uuid,
  request_id text,
  before_value jsonb,
  after_value jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists finance_audit_logs_owner_idx
  on public.finance_audit_logs(user_id, created_at desc);

alter table public.finance_processing_events enable row level security;
alter table public.finance_transaction_duplicates enable row level security;
alter table public.finance_attachments enable row level security;
alter table public.finance_audit_logs enable row level security;
revoke all on public.finance_processing_events, public.finance_transaction_duplicates, public.finance_attachments, public.finance_audit_logs from public, anon, authenticated;
grant select, insert, update on public.finance_processing_events to service_role;
grant select, insert, update on public.finance_transaction_duplicates to service_role;
grant select, insert, update on public.finance_attachments to service_role;
grant select, insert on public.finance_audit_logs to service_role;

create or replace function public.finance_processing_event_begin(
  p_user_id uuid,
  p_source text,
  p_idempotency_key text,
  p_external_event_id text default null,
  p_payload_hash text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare e finance_processing_events;
begin
  if p_source not in ('WEB','APK','TELEGRAM','API','MCP','SYSTEM','AI')
    or nullif(btrim(p_idempotency_key),'') is null
    or jsonb_typeof(p_metadata) <> 'object' then
    raise exception 'Invalid processing event' using errcode='22023';
  end if;
  perform 1 from finance_users where id=p_user_id for update;
  if not found then raise exception 'Unknown owner' using errcode='23503'; end if;
  select * into e from finance_processing_events
  where user_id=p_user_id and source=p_source
    and (idempotency_key=p_idempotency_key or (p_external_event_id is not null and external_event_id=p_external_event_id))
  order by created_at limit 1 for update;
  if found then
    return jsonb_build_object('duplicate',true,'event',to_jsonb(e));
  end if;
  begin
    insert into finance_processing_events(user_id,source,external_event_id,idempotency_key,payload_hash,metadata)
    values(p_user_id,p_source,nullif(btrim(p_external_event_id),''),btrim(p_idempotency_key),nullif(btrim(p_payload_hash),''),p_metadata)
    returning * into e;
  exception when unique_violation then
    select * into e from finance_processing_events
    where user_id=p_user_id and source=p_source
      and (idempotency_key=p_idempotency_key or (p_external_event_id is not null and external_event_id=p_external_event_id))
    order by created_at limit 1;
    return jsonb_build_object('duplicate',true,'event',to_jsonb(e));
  end;
  return jsonb_build_object('duplicate',false,'event',to_jsonb(e));
end $$;

create or replace function public.finance_processing_event_complete(
  p_event_id uuid, p_status text, p_result jsonb default null
)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare e finance_processing_events;
begin
  if p_status not in ('succeeded','failed','ignored') then raise exception 'Invalid event status' using errcode='22023'; end if;
  update finance_processing_events set status=p_status,result=p_result,updated_at=now()
  where id=p_event_id returning * into e;
  if not found then raise exception 'Processing event not found' using errcode='P0002'; end if;
  return to_jsonb(e);
end $$;

create or replace function public.finance_transaction_fingerprint(
  p_user_id uuid, p_transaction_type text, p_amount numeric, p_transaction_date date,
  p_description text, p_category text default null, p_source text default null,
  p_occurred_at timestamptz default null, p_merchant text default null
)
returns text language sql immutable set search_path=public as $$
  select md5(concat_ws('|',p_user_id::text,p_transaction_type,to_char(p_amount,'FM999999999999990.00'),p_transaction_date::text,
    coalesce(to_char(p_occurred_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),''),
    lower(regexp_replace(btrim(coalesce(p_merchant,'')),'\s+',' ','g')),
    lower(regexp_replace(btrim(coalesce(p_description,'')),'\s+',' ','g')),
    lower(btrim(coalesce(p_category,''))),upper(btrim(coalesce(p_source,'')))));
$$;

create or replace function public.finance_audit_write(
  p_user_id uuid, p_origin text, p_action text, p_entity_type text,
  p_entity_id uuid default null, p_account_id uuid default null,
  p_request_id text default null, p_before jsonb default null,
  p_after jsonb default null, p_metadata jsonb default '{}'::jsonb
)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare a finance_audit_logs;
begin
  if p_origin not in ('WEB','APK','TELEGRAM','API','MCP','SYSTEM','AI')
    or p_action not in ('CREATE','UPDATE','DELETE','IMPORT','MERGE','AI_ACTION','USER_CONFIRMATION','SYSTEM_ACTION')
    or nullif(btrim(p_entity_type),'') is null then
    raise exception 'Invalid audit entry' using errcode='22023';
  end if;
  insert into finance_audit_logs(user_id,account_id,origin,action,entity_type,entity_id,request_id,before_value,after_value,metadata)
  values(p_user_id,p_account_id,p_origin,p_action,btrim(p_entity_type),p_entity_id,p_request_id,p_before,p_after,coalesce(p_metadata,'{}'::jsonb))
  returning * into a;
  return to_jsonb(a);
end $$;

create or replace function public.finance_duplicate_candidates(
  p_user_id uuid, p_status text default 'open', p_limit integer default 50
)
returns jsonb language sql security invoker set search_path=public as $$
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]'::jsonb)
  from (
    select d.*, row_to_json(t) transaction, row_to_json(c) candidate_transaction
    from finance_transaction_duplicates d
    join finance_transactions t on t.id=d.transaction_id
    join finance_transactions c on c.id=d.candidate_transaction_id
    where d.user_id=p_user_id and (p_status is null or d.status=p_status)
    order by d.created_at desc limit greatest(1,least(coalesce(p_limit,50),100))
  ) x;
$$;

create or replace function public.finance_duplicate_resolve(
  p_user_id uuid, p_account_id uuid, p_duplicate_id uuid, p_action text
)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare d finance_transaction_duplicates; t finance_transactions; c finance_transactions;
begin
  if p_action not in ('confirm','ignore','merge') then raise exception 'Invalid duplicate action' using errcode='22023'; end if;
  select * into d from finance_transaction_duplicates where id=p_duplicate_id and user_id=p_user_id and status='open' for update;
  if not found then return null; end if;
  select * into t from finance_transactions where id=d.transaction_id and user_id=p_user_id for update;
  select * into c from finance_transactions where id=d.candidate_transaction_id and user_id=p_user_id for update;
  if not found then return null; end if;
  if p_action='merge' then
    if d.kind<>'EXACT_DUPLICATE' or t.fingerprint is null or t.fingerprint is distinct from c.fingerprint then
      raise exception 'Only exact duplicates can be merged' using errcode='55000';
    end if;
    update finance_transactions set deleted_at=coalesce(deleted_at,now()),deleted_by_account_id=p_account_id where id=c.id;
    update finance_transaction_duplicates set status='merged',resolved_at=now(),resolved_by_account_id=p_account_id where id=d.id;
  else
    update finance_transaction_duplicates set status=case when p_action='confirm' then 'confirmed' else 'ignored' end,
      resolved_at=now(),resolved_by_account_id=p_account_id where id=d.id;
  end if;
  perform finance_audit_write(p_user_id,'WEB',case when p_action='merge' then 'MERGE' else 'USER_CONFIRMATION' end,
    'transaction_duplicate',d.id,p_account_id,null,to_jsonb(d),jsonb_build_object('action',p_action));
  return (select to_jsonb(x) from finance_transaction_duplicates x where x.id=d.id);
end $$;

-- Link the existing assistant queue to the shared event ledger without changing
-- its public function signature or response shape.
alter table public.finance_assistant_jobs
  add column if not exists processing_event_id uuid references public.finance_processing_events(id) on delete set null;
create index if not exists finance_assistant_jobs_processing_event_idx
  on public.finance_assistant_jobs(processing_event_id);

create or replace function public.finance_assistant_enqueue(
  p_user_id uuid, p_account_id uuid, p_channel text, p_key text,
  p_payload jsonb, p_hash text default null
)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare j finance_assistant_jobs; event jsonb; event_id uuid; source_name text;
begin
  source_name:=case when p_channel='telegram' then 'TELEGRAM' when p_channel='dashboard' then 'WEB' else 'API' end;
  event:=finance_processing_event_begin(p_user_id,source_name,p_key,p_key,p_hash,jsonb_build_object('channel',p_channel));
  event_id:=(event->'event'->>'id')::uuid;
  select * into j from finance_assistant_jobs where user_id=p_user_id and channel=p_channel and request_key=p_key;
  if found then return to_jsonb(j)-'payload'-'operation'-'lease_token'; end if;
  if (select count(*) from finance_assistant_jobs where user_id=p_user_id and status in ('queued','processing'))>=5 then raise exception 'Assistant busy' using errcode='54000'; end if;
  if octet_length(p_payload::text)>4200000 then raise exception 'Payload too large'; end if;
  insert into finance_assistant_jobs(user_id,account_id,channel,request_key,payload,file_hash,processing_event_id)
  values(p_user_id,p_account_id,p_channel,p_key,p_payload,p_hash,event_id) returning * into j;
  return to_jsonb(j)-'payload'-'operation'-'lease_token';
end $$;

create or replace function public.finance_sync_assistant_processing_event()
returns trigger language plpgsql security invoker set search_path=public as $$
begin
  if new.processing_event_id is not null then
    update finance_processing_events
    set status=case
      when new.status='done' then 'succeeded'
      when new.status='failed' then 'failed'
      when new.status='awaiting_confirmation' then 'processing'
      else 'received'
    end, result=new.result, updated_at=now()
    where id=new.processing_event_id;
  end if;
  return new;
end $$;
drop trigger if exists finance_sync_assistant_processing_event on public.finance_assistant_jobs;
create trigger finance_sync_assistant_processing_event
after insert or update of status, result on public.finance_assistant_jobs
for each row execute function public.finance_sync_assistant_processing_event();

create or replace function public.finance_audit_transaction_change()
returns trigger language plpgsql security invoker set search_path=public as $$
declare owner_id uuid; account_id uuid; origin_name text; action_name text; entity uuid; before_value jsonb; after_value jsonb;
begin
  owner_id:=case when TG_OP='DELETE' then old.user_id else new.user_id end;
  entity:=case when TG_OP='DELETE' then old.id else new.id end;
  account_id:=case when TG_OP='DELETE' then old.deleted_by_account_id else coalesce(new.updated_by_account_id,new.deleted_by_account_id) end;
  origin_name:=case
    when coalesce(case when TG_OP='DELETE' then old.source else new.source end,'')='TELEGRAM' then 'TELEGRAM'
    when account_id is not null then 'WEB'
    when coalesce(case when TG_OP='DELETE' then old.source else new.source end,'')='AI' then 'AI'
    else 'SYSTEM' end;
  action_name:=case
    when TG_OP='INSERT' then 'CREATE'
    when TG_OP='DELETE' then 'DELETE'
    when old.deleted_at is null and new.deleted_at is not null then 'DELETE'
    else 'UPDATE' end;
  before_value:=case when TG_OP in ('UPDATE','DELETE') then to_jsonb(old) end;
  after_value:=case when TG_OP in ('INSERT','UPDATE') then to_jsonb(new) end;
  perform finance_audit_write(owner_id,origin_name,action_name,'transaction',entity,account_id,null,before_value,after_value,'{}'::jsonb);
  return case when TG_OP='DELETE' then old else new end;
end $$;
drop trigger if exists finance_audit_transaction_change on public.finance_transactions;
create trigger finance_audit_transaction_change
after insert or update or delete on public.finance_transactions
for each row execute function public.finance_audit_transaction_change();

create or replace function public.finance_dashboard_create_transaction(
  p_account_id uuid,p_transaction_type text,p_amount numeric,p_category text,p_description text,p_transaction_date date
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r finance_transactions; uid uuid; fp text;
begin
  select finance_user_id into uid from dashboard_accounts where id=p_account_id and active;
  if uid is null then return null; end if;
  fp:=finance_transaction_fingerprint(uid,p_transaction_type,p_amount,p_transaction_date,p_description,p_category,'WEB');
  insert into finance_transactions(user_id,telegram_message_id,transaction_type,amount,category,description,transaction_date,updated_by_account_id,source,fingerprint)
  values(uid,-(extract(epoch from clock_timestamp())*1000000)::bigint,p_transaction_type,p_amount,p_category,p_description,p_transaction_date,p_account_id,'WEB',fp)
  returning * into r;
  return to_jsonb(r);
end $$;

create or replace function public.finance_dashboard_update_transaction(
  p_account_id uuid,p_transaction_id uuid,p_transaction_type text,p_amount numeric,p_category text,p_description text,p_transaction_date date
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r finance_transactions; uid uuid; fp text;
begin
  select finance_user_id into uid from dashboard_accounts where id=p_account_id and active;
  if uid is null then return null; end if;
  fp:=finance_transaction_fingerprint(uid,p_transaction_type,p_amount,p_transaction_date,p_description,p_category,'WEB');
  update finance_transactions t set transaction_type=p_transaction_type,amount=p_amount,category=p_category,description=p_description,
    transaction_date=p_transaction_date,updated_by_account_id=p_account_id,source='WEB',fingerprint=fp
  where t.id=p_transaction_id and t.deleted_at is null and
    (t.user_id=uid or exists(select 1 from finance_transaction_shares s where s.transaction_id=t.id and s.shared_with_account_id=p_account_id))
  returning t.* into r;
  if not found then return null; end if;
  return to_jsonb(r);
end $$;

do $$ declare f record; begin
  for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('finance_processing_event_begin','finance_processing_event_complete',
      'finance_transaction_fingerprint','finance_audit_write','finance_duplicate_candidates','finance_duplicate_resolve') loop
    execute format('revoke all on function %s from public,anon,authenticated',f.sig);
    execute format('grant execute on function %s to service_role',f.sig);
  end loop;
  for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='finance_sync_assistant_processing_event' loop
    execute format('revoke all on function %s from public,anon,authenticated',f.sig);
    execute format('grant execute on function %s to service_role',f.sig);
  end loop;
end $$;
