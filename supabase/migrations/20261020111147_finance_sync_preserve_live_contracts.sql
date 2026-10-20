-- Reconcile repository additions while preserving the live WhatsApp API.
-- No existing financial rows or preferences are updated.

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
  if p_account_id is not null and not exists(select 1 from dashboard_accounts where id=p_account_id and finance_user_id=p_user_id and active) then raise exception 'Unknown account'; end if;
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


-- Normalized financial domain. Existing transaction APIs remain unchanged.

create table if not exists public.finance_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.finance_users(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 100),
  type text not null check (type in ('current_account','digital_account','cash','physical_wallet','virtual_wallet','joint','custom')),
  opening_balance numeric not null default 0 check (opening_balance >= -100000000 and opening_balance = round(opening_balance,2)),
  currency text not null default 'BRL' check (currency ~ '^[A-Z]{3}$'),
  status text not null default 'active' check (status in ('active','archived')),
  icon text,
  color text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists finance_accounts_owner_idx on public.finance_accounts(user_id,status,name);

create table if not exists public.finance_credit_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.finance_users(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 100),
  nickname text,
  brand text,
  last_four text check (last_four is null or last_four ~ '^[0-9]{4}$'),
  limit_amount numeric check (limit_amount is null or (limit_amount >= 0 and limit_amount = round(limit_amount,2))),
  closing_day integer check (closing_day is null or closing_day between 1 and 31),
  due_day integer check (due_day is null or due_day between 1 and 31),
  currency text not null default 'BRL' check (currency ~ '^[A-Z]{3}$'),
  status text not null default 'active' check (status in ('active','archived')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists finance_credit_cards_owner_idx on public.finance_credit_cards(user_id,status,name);

create table if not exists public.finance_card_statements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.finance_users(id) on delete cascade,
  credit_card_id uuid not null references public.finance_credit_cards(id) on delete cascade,
  reference_year integer not null check (reference_year between 2000 and 2200),
  reference_month integer not null check (reference_month between 1 and 12),
  closing_date date,
  due_date date,
  total_amount numeric not null default 0 check (total_amount >= 0 and total_amount = round(total_amount,2)),
  status text not null default 'open' check (status in ('open','closed','paid','overdue')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (credit_card_id, reference_year, reference_month)
);
create index if not exists finance_card_statements_owner_idx on public.finance_card_statements(user_id,due_date);

create table if not exists public.finance_installment_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.finance_users(id) on delete cascade,
  transaction_id uuid references public.finance_transactions(id) on delete set null,
  credit_card_id uuid references public.finance_credit_cards(id) on delete set null,
  total_amount numeric not null check (total_amount > 0 and total_amount = round(total_amount,2)),
  installment_count integer not null check (installment_count between 2 and 120),
  first_due_date date not null,
  status text not null default 'active' check (status in ('active','completed','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists finance_installment_plans_owner_idx on public.finance_installment_plans(user_id,status,first_due_date);

create table if not exists public.finance_installments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.finance_users(id) on delete cascade,
  plan_id uuid not null references public.finance_installment_plans(id) on delete cascade,
  number integer not null check (number >= 1),
  due_date date not null,
  amount numeric not null check (amount > 0 and amount = round(amount,2)),
  status text not null default 'planned' check (status in ('planned','paid','cancelled')),
  paid_transaction_id uuid references public.finance_transactions(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (plan_id, number)
);
create index if not exists finance_installments_owner_idx on public.finance_installments(user_id,status,due_date);

create table if not exists public.finance_transaction_splits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.finance_users(id) on delete cascade,
  transaction_id uuid not null references public.finance_transactions(id) on delete cascade,
  account_id uuid references public.finance_accounts(id) on delete restrict,
  credit_card_id uuid references public.finance_credit_cards(id) on delete restrict,
  installment_plan_id uuid references public.finance_installment_plans(id) on delete set null,
  amount numeric not null check (amount > 0 and amount = round(amount,2)),
  created_at timestamptz not null default now(),
  check ((account_id is not null) <> (credit_card_id is not null))
);
create index if not exists finance_transaction_splits_transaction_idx on public.finance_transaction_splits(transaction_id);

create table if not exists public.finance_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.finance_users(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 120),
  merchant text,
  amount numeric not null check (amount > 0 and amount = round(amount,2)),
  currency text not null default 'BRL' check (currency ~ '^[A-Z]{3}$'),
  frequency text not null check (frequency in ('weekly','monthly','quarterly','yearly','custom')),
  next_due_date date,
  last_charge_date date,
  status text not null default 'active' check (status in ('active','paused','cancelled')),
  source_transaction_id uuid references public.finance_transactions(id) on delete set null,
  confidence numeric check (confidence is null or confidence between 0 and 1),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists finance_subscriptions_owner_idx on public.finance_subscriptions(user_id,status,next_due_date);

alter table public.finance_accounts enable row level security;
alter table public.finance_credit_cards enable row level security;
alter table public.finance_card_statements enable row level security;
alter table public.finance_installment_plans enable row level security;
alter table public.finance_installments enable row level security;
alter table public.finance_transaction_splits enable row level security;
alter table public.finance_subscriptions enable row level security;
revoke all on public.finance_accounts,public.finance_credit_cards,public.finance_card_statements,public.finance_installment_plans,public.finance_installments,public.finance_transaction_splits,public.finance_subscriptions from public,anon,authenticated;
grant select,insert,update,delete on public.finance_accounts,public.finance_credit_cards,public.finance_card_statements,public.finance_installment_plans,public.finance_installments,public.finance_transaction_splits,public.finance_subscriptions to service_role;

create or replace function public.finance_account_list(p_user_id uuid)
returns jsonb language sql security invoker set search_path=public as $$
  select coalesce(jsonb_agg(to_jsonb(a) order by a.status,a.name),'[]'::jsonb)
  from finance_accounts a where a.user_id=p_user_id;
$$;

create or replace function public.finance_account_create(p_user_id uuid,p_values jsonb)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare a finance_accounts;
begin
  if jsonb_typeof(p_values)<>'object' or nullif(btrim(p_values->>'name'),'') is null
    or p_values->>'type' not in ('current_account','digital_account','cash','physical_wallet','virtual_wallet','joint','custom')
    or coalesce(p_values->>'currency','BRL') !~ '^[A-Z]{3}$' then
    raise exception 'Invalid account' using errcode='22023';
  end if;
  insert into finance_accounts(user_id,name,type,opening_balance,currency,icon,color,notes)
  values(p_user_id,btrim(p_values->>'name'),p_values->>'type',coalesce((p_values->>'opening_balance')::numeric,0),coalesce(p_values->>'currency','BRL'),p_values->>'icon',p_values->>'color',p_values->>'notes')
  returning * into a;
  perform finance_audit_write(p_user_id,'WEB','CREATE','finance_account',a.id,null,null,null,to_jsonb(a),'{}'::jsonb);
  return to_jsonb(a);
end $$;

create or replace function public.finance_card_list(p_user_id uuid)
returns jsonb language sql security invoker set search_path=public as $$
  select coalesce(jsonb_agg(to_jsonb(c) order by c.status,c.name),'[]'::jsonb)
  from finance_credit_cards c where c.user_id=p_user_id;
$$;

create or replace function public.finance_card_create(p_user_id uuid,p_values jsonb)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare c finance_credit_cards;
begin
  if jsonb_typeof(p_values)<>'object' or nullif(btrim(p_values->>'name'),'') is null then raise exception 'Invalid card' using errcode='22023'; end if;
  insert into finance_credit_cards(user_id,name,nickname,brand,last_four,limit_amount,closing_day,due_day,currency,notes)
  values(p_user_id,btrim(p_values->>'name'),p_values->>'nickname',p_values->>'brand',p_values->>'last_four',(p_values->>'limit_amount')::numeric,(p_values->>'closing_day')::integer,(p_values->>'due_day')::integer,coalesce(p_values->>'currency','BRL'),p_values->>'notes')
  returning * into c;
  perform finance_audit_write(p_user_id,'WEB','CREATE','credit_card',c.id,null,null,null,to_jsonb(c),'{}'::jsonb);
  return to_jsonb(c);
end $$;

create or replace function public.finance_transaction_splits_replace(p_user_id uuid,p_transaction_id uuid,p_splits jsonb,p_account_id uuid default null)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare t finance_transactions; item jsonb; total numeric:=0; n integer:=0; result jsonb:='[]'::jsonb; account_ok boolean; card_ok boolean; split_id uuid;
begin
  if jsonb_typeof(p_splits)<>'array' or jsonb_array_length(p_splits)<1 or jsonb_array_length(p_splits)>20 then raise exception 'Invalid splits' using errcode='22023'; end if;
  select * into t from finance_transactions where id=p_transaction_id and user_id=p_user_id and deleted_at is null for update;
  if not found then return null; end if;
  for item in select value from jsonb_array_elements(p_splits) loop
    account_ok:=(item->>'account_id') is not null and exists(select 1 from finance_accounts where id=(item->>'account_id')::uuid and user_id=p_user_id and status='active');
    card_ok:=(item->>'credit_card_id') is not null and exists(select 1 from finance_credit_cards where id=(item->>'credit_card_id')::uuid and user_id=p_user_id and status='active');
    if account_ok=card_ok or ((item->>'amount')::numeric)<=0 or round((item->>'amount')::numeric,2)<>(item->>'amount')::numeric then raise exception 'Invalid split item' using errcode='22023'; end if;
    total:=total+(item->>'amount')::numeric; n:=n+1;
  end loop;
  if round(total,2)<>round(t.amount,2) then raise exception 'Split total must equal transaction total' using errcode='22023'; end if;
  delete from finance_transaction_splits where transaction_id=t.id;
  for item in select value from jsonb_array_elements(p_splits) loop
    insert into finance_transaction_splits(user_id,transaction_id,account_id,credit_card_id,installment_plan_id,amount)
    values(p_user_id,t.id,(item->>'account_id')::uuid,(item->>'credit_card_id')::uuid,(item->>'installment_plan_id')::uuid,(item->>'amount')::numeric)
    returning id into split_id;
    result:=result||jsonb_build_array(jsonb_build_object('id',split_id,'amount',(item->>'amount')::numeric,'account_id',item->>'account_id','credit_card_id',item->>'credit_card_id','installment_plan_id',item->>'installment_plan_id'));
  end loop;
  perform finance_audit_write(p_user_id,'WEB','UPDATE','transaction_splits',t.id,p_account_id,null,null,result,'{}'::jsonb);
  return result;
end $$;

create or replace function public.finance_installment_plan_create(p_user_id uuid,p_values jsonb,p_account_id uuid default null)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare plan finance_installment_plans; i integer; portion numeric; remainder numeric; item jsonb:='[]'::jsonb; tx finance_transactions;
begin
  select * into tx from finance_transactions where id=(p_values->>'transaction_id')::uuid and user_id=p_user_id and deleted_at is null for update;
  if not found or coalesce((p_values->>'installment_count')::integer,0) not between 2 and 120 then raise exception 'Invalid installment plan' using errcode='22023'; end if;
  if (p_values->>'credit_card_id') is not null and not exists(select 1 from finance_credit_cards where id=(p_values->>'credit_card_id')::uuid and user_id=p_user_id and status='active') then raise exception 'Card not owned' using errcode='42501'; end if;
  if (p_values->>'total_amount')::numeric<=0 or (p_values->>'total_amount')::numeric>tx.amount then raise exception 'Invalid installment amount' using errcode='22023'; end if;
  insert into finance_installment_plans(user_id,transaction_id,credit_card_id,total_amount,installment_count,first_due_date)
  values(p_user_id,tx.id,(p_values->>'credit_card_id')::uuid,(p_values->>'total_amount')::numeric,(p_values->>'installment_count')::integer,(p_values->>'first_due_date')::date)
  returning * into plan;
  portion:=round(plan.total_amount/plan.installment_count,2); remainder:=plan.total_amount;
  for i in 1..plan.installment_count loop
    if i=plan.installment_count then portion:=remainder; end if;
    insert into finance_installments(user_id,plan_id,number,due_date,amount)
    values(p_user_id,plan.id,i,(plan.first_due_date+((i-1)||' months')::interval)::date,portion);
    remainder:=round(remainder-portion,2);
  end loop;
  perform finance_audit_write(p_user_id,'WEB','CREATE','installment_plan',plan.id,p_account_id,null,null,to_jsonb(plan),'{}'::jsonb);
  return jsonb_build_object('plan',to_jsonb(plan),'installments',(select jsonb_agg(to_jsonb(x) order by x.number) from finance_installments x where x.plan_id=plan.id));
end $$;

create or replace function public.finance_installment_list(p_user_id uuid,p_plan_id uuid default null)
returns jsonb language sql security invoker set search_path=public as $$
  select coalesce(jsonb_agg(to_jsonb(i) order by i.due_date,i.number),'[]'::jsonb)
  from finance_installments i where i.user_id=p_user_id and (p_plan_id is null or i.plan_id=p_plan_id);
$$;

create or replace function public.finance_transactions_query(
  p_user_id uuid, p_search text default null, p_date_from date default null,
  p_date_to date default null, p_type text default null, p_category text default null,
  p_limit integer default 100
)
returns jsonb language sql security invoker set search_path=public as $$
  select coalesce(jsonb_agg(to_jsonb(t) order by t.transaction_date desc,t.created_at desc,t.id desc),'[]'::jsonb)
  from (
    select * from finance_transactions
    where user_id=p_user_id and deleted_at is null
      and (p_search is null or description ilike '%'||p_search||'%' or merchant ilike '%'||p_search||'%')
      and (p_date_from is null or transaction_date>=p_date_from)
      and (p_date_to is null or transaction_date<=p_date_to)
      and (p_type is null or transaction_type=p_type)
      and (p_category is null or category=p_category)
    order by transaction_date desc,created_at desc,id desc
    limit greatest(1,least(coalesce(p_limit,100),500))
  ) t;
$$;

create or replace function public.finance_balance_summary(
  p_user_id uuid, p_date_from date default null, p_date_to date default null
)
returns jsonb language sql security invoker set search_path=public as $$
  with rows as (
    select transaction_type,amount,category from finance_transactions
    where user_id=p_user_id and deleted_at is null
      and (p_date_from is null or transaction_date>=p_date_from)
      and (p_date_to is null or transaction_date<=p_date_to)
  ), totals as (
    select coalesce(sum(amount) filter(where transaction_type='receita'),0) income,
      coalesce(sum(amount) filter(where transaction_type='despesa'),0) expense from rows
  ), cats as (
    select coalesce(jsonb_object_agg(category,total),'{}'::jsonb) value
    from (select category,sum(amount) total from rows where transaction_type='despesa' group by category) x
  ) select jsonb_build_object('income',income,'expense',expense,'balance',income-expense,'byCategory',(select value from cats)) from totals;
$$;

create or replace function public.finance_card_statement_list(p_user_id uuid,p_credit_card_id uuid default null)
returns jsonb language sql security invoker set search_path=public as $$
  select coalesce(jsonb_agg(to_jsonb(s) order by s.due_date nulls last,s.reference_year desc,s.reference_month desc),'[]'::jsonb)
  from finance_card_statements s where s.user_id=p_user_id and (p_credit_card_id is null or s.credit_card_id=p_credit_card_id);
$$;

create or replace function public.finance_subscription_list(p_user_id uuid)
returns jsonb language sql security invoker set search_path=public as $$
  select coalesce(jsonb_agg(to_jsonb(s) order by s.status,s.next_due_date nulls last,s.name),'[]'::jsonb)
  from finance_subscriptions s where s.user_id=p_user_id;
$$;

do $$ declare f record; begin
  for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('finance_account_list','finance_account_create','finance_card_list','finance_card_create',
      'finance_transaction_splits_replace','finance_installment_plan_create','finance_installment_list',
      'finance_transactions_query','finance_balance_summary','finance_card_statement_list','finance_subscription_list') loop
    execute format('revoke all on function %s from public,anon,authenticated',f.sig);
    execute format('grant execute on function %s to service_role',f.sig);
  end loop;
end $$;


-- Planning, categorization, alerts and explainable insights.

create table if not exists public.finance_category_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.finance_users(id) on delete cascade,
  pattern text not null check (length(btrim(pattern)) between 1 and 180),
  category text not null check (category in ('Alimentação','Transporte','Moradia','Saúde','Educação','Lazer','Assinaturas','Outros')),
  subcategory text,
  priority integer not null default 100,
  confidence numeric not null default 0.8 check (confidence between 0 and 1),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists finance_category_rules_owner_idx on public.finance_category_rules(user_id,enabled,priority);

create table if not exists public.finance_budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.finance_users(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 120),
  scope_type text not null check (scope_type in ('general','category','subcategory')),
  category text,
  subcategory text,
  planned_amount numeric not null check (planned_amount > 0 and planned_amount = round(planned_amount,2)),
  period_type text not null check (period_type in ('monthly','quarterly','yearly','custom')),
  start_date date not null,
  end_date date not null,
  status text not null default 'active' check (status in ('active','paused','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date),
  check (scope_type='general' or category is not null)
);
create index if not exists finance_budgets_owner_idx on public.finance_budgets(user_id,status,start_date,end_date);

create table if not exists public.finance_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.finance_users(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 120),
  target_amount numeric not null check (target_amount > 0 and target_amount = round(target_amount,2)),
  deadline date,
  priority integer not null default 100,
  status text not null default 'active' check (status in ('active','paused','completed','cancelled')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.finance_goal_contributions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.finance_users(id) on delete cascade,
  goal_id uuid not null references public.finance_goals(id) on delete cascade,
  amount numeric not null check (amount > 0 and amount = round(amount,2)),
  contribution_date date not null,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists finance_goals_owner_idx on public.finance_goals(user_id,status,deadline);
create index if not exists finance_goal_contributions_goal_idx on public.finance_goal_contributions(goal_id,contribution_date desc);

create table if not exists public.finance_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.finance_users(id) on delete cascade,
  type text not null,
  severity text not null check (severity in ('info','warning','critical')),
  status text not null default 'open' check (status in ('open','read','dismissed','resolved')),
  source text not null check (source in ('SYSTEM','AI','USER','TELEGRAM','WEB')),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  dismissed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);
create index if not exists finance_alerts_owner_idx on public.finance_alerts(user_id,status,created_at desc);

create table if not exists public.finance_ai_insights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.finance_users(id) on delete cascade,
  kind text not null,
  title text not null,
  body text not null,
  evidence jsonb not null default '[]'::jsonb,
  confidence numeric check (confidence is null or confidence between 0 and 1),
  status text not null default 'active' check (status in ('active','dismissed','expired')),
  generated_at timestamptz not null default now(),
  valid_until timestamptz
);
create index if not exists finance_ai_insights_owner_idx on public.finance_ai_insights(user_id,status,generated_at desc);

alter table public.finance_category_rules enable row level security;
alter table public.finance_budgets enable row level security;
alter table public.finance_goals enable row level security;
alter table public.finance_goal_contributions enable row level security;
alter table public.finance_alerts enable row level security;
alter table public.finance_ai_insights enable row level security;
revoke all on public.finance_category_rules,public.finance_budgets,public.finance_goals,public.finance_goal_contributions,public.finance_alerts,public.finance_ai_insights from public,anon,authenticated;
grant select,insert,update,delete on public.finance_category_rules,public.finance_budgets,public.finance_goals,public.finance_goal_contributions,public.finance_alerts,public.finance_ai_insights to service_role;

create or replace function public.finance_budget_summary(p_user_id uuid,p_budget_id uuid default null,p_date_from date default null,p_date_to date default null)
returns jsonb language sql security invoker set search_path=public as $$
  select coalesce(jsonb_agg(jsonb_build_object('budget',to_jsonb(b),'realized',coalesce(x.realized,0),'remaining',b.planned_amount-coalesce(x.realized,0),'percent_consumed',case when b.planned_amount=0 then 0 else round(coalesce(x.realized,0)/b.planned_amount*100,2) end) order by b.start_date),'[]'::jsonb)
  from finance_budgets b left join lateral (
    select sum(t.amount) realized from finance_transactions t
    where t.user_id=b.user_id and t.deleted_at is null and t.transaction_type='despesa'
      and t.transaction_date between coalesce(p_date_from,b.start_date) and coalesce(p_date_to,b.end_date)
      and (b.scope_type='general' or (b.scope_type='category' and t.category=b.category))
  ) x on true
  where b.user_id=p_user_id and (p_budget_id is null or b.id=p_budget_id) and b.status='active';
$$;

create or replace function public.finance_budget_create(p_user_id uuid,p_values jsonb)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare b finance_budgets;
begin
  insert into finance_budgets(user_id,name,scope_type,category,subcategory,planned_amount,period_type,start_date,end_date)
  values(p_user_id,btrim(p_values->>'name'),p_values->>'scope_type',p_values->>'category',p_values->>'subcategory',(p_values->>'planned_amount')::numeric,p_values->>'period_type',(p_values->>'start_date')::date,(p_values->>'end_date')::date)
  returning * into b;
  perform finance_audit_write(p_user_id,'WEB','CREATE','budget',b.id,null,null,null,to_jsonb(b),'{}'::jsonb);
  return to_jsonb(b);
end $$;

create or replace function public.finance_goal_list(p_user_id uuid)
returns jsonb language sql security invoker set search_path=public as $$
  select coalesce(jsonb_agg(jsonb_build_object('goal',to_jsonb(g),'current_amount',coalesce(c.current_amount,0),'remaining',greatest(g.target_amount-coalesce(c.current_amount,0),0),'progress',least(round(coalesce(c.current_amount,0)/g.target_amount*100,2),100)) order by g.priority,g.deadline),'[]'::jsonb)
  from finance_goals g left join lateral (select sum(amount) current_amount from finance_goal_contributions where goal_id=g.id) c on true
  where g.user_id=p_user_id;
$$;

create or replace function public.finance_goal_create(p_user_id uuid,p_values jsonb)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare g finance_goals;
begin
  insert into finance_goals(user_id,name,target_amount,deadline,priority,notes)
  values(p_user_id,btrim(p_values->>'name'),(p_values->>'target_amount')::numeric,(p_values->>'deadline')::date,coalesce((p_values->>'priority')::integer,100),p_values->>'notes') returning * into g;
  perform finance_audit_write(p_user_id,'WEB','CREATE','goal',g.id,null,null,null,to_jsonb(g),'{}'::jsonb);
  return to_jsonb(g);
end $$;

create or replace function public.finance_goal_contribute(p_user_id uuid,p_goal_id uuid,p_values jsonb,p_account_id uuid default null)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare c finance_goal_contributions; g finance_goals;
begin
  select * into g from finance_goals where id=p_goal_id and user_id=p_user_id and status='active' for update;
  if not found then return null; end if;
  insert into finance_goal_contributions(user_id,goal_id,amount,contribution_date,note)
  values(p_user_id,p_goal_id,(p_values->>'amount')::numeric,coalesce((p_values->>'contribution_date')::date,(now() at time zone 'America/Sao_Paulo')::date),p_values->>'note') returning * into c;
  perform finance_audit_write(p_user_id,'WEB','CREATE','goal_contribution',c.id,p_account_id,null,null,to_jsonb(c),'{}'::jsonb);
  return to_jsonb(c);
end $$;

create or replace function public.finance_alert_list(p_user_id uuid,p_status text default 'open',p_limit integer default 50)
returns jsonb language sql security invoker set search_path=public as $$
  select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc),'[]'::jsonb) from finance_alerts a
  where a.user_id=p_user_id and (p_status is null or a.status=p_status) limit greatest(1,least(coalesce(p_limit,50),100));
$$;

create or replace function public.finance_alert_dismiss(p_user_id uuid,p_alert_id uuid,p_account_id uuid default null)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare a finance_alerts;
begin
  update finance_alerts set status='dismissed',dismissed_at=now() where id=p_alert_id and user_id=p_user_id and status<>'dismissed' returning * into a;
  if not found then return null; end if;
  perform finance_audit_write(p_user_id,'WEB','USER_CONFIRMATION','alert',a.id,p_account_id,null,null,to_jsonb(a),'{}'::jsonb);
  return to_jsonb(a);
end $$;

create or replace function public.finance_insight_list(p_user_id uuid,p_limit integer default 20)
returns jsonb language sql security invoker set search_path=public as $$
  select coalesce(jsonb_agg(to_jsonb(i) order by i.generated_at desc),'[]'::jsonb) from finance_ai_insights i
  where i.user_id=p_user_id and i.status='active' and (i.valid_until is null or i.valid_until>now()) limit greatest(1,least(coalesce(p_limit,20),50));
$$;

create or replace function public.finance_cashflow_projection(p_user_id uuid,p_horizon_days integer default 30)
returns jsonb language sql security invoker set search_path=public as $$
  with horizon as (select (now() at time zone 'America/Sao_Paulo')::date today, (now() at time zone 'America/Sao_Paulo')::date+greatest(1,least(coalesce(p_horizon_days,30),365)) finish),
  items as (
    select i.due_date event_date,'installment' source,'despesa' transaction_type,i.amount amount from finance_installments i,horizon h where i.user_id=p_user_id and i.status='planned' and i.due_date between h.today and h.finish
    union all
    select r.due_date,'reminder', 'despesa',coalesce(r.amount,0) from finance_reminders r,horizon h where r.finance_user_id=p_user_id and r.status='pending' and r.kind='bill' and r.due_date between h.today and h.finish
    union all
    select s.next_due_date,'subscription','despesa',s.amount from finance_subscriptions s,horizon h where s.user_id=p_user_id and s.status='active' and s.next_due_date between h.today and h.finish
  )
  select jsonb_build_object('horizon_days',greatest(1,least(coalesce(p_horizon_days,30),365)),'assumptions',jsonb_build_array('Inclui parcelas planejadas, contas pendentes e assinaturas ativas cadastradas.','Valores são projeções e não alteram lançamentos realizados.'),'items',coalesce((select jsonb_agg(to_jsonb(i) order by i.event_date) from items i),'[]'::jsonb),'total_expenses',coalesce((select sum(amount) from items),0));
$$;

create or replace function public.finance_timeline(p_user_id uuid,p_date_from date default null,p_date_to date default null,p_limit integer default 200)
returns jsonb language sql security invoker set search_path=public as $$
  select coalesce(jsonb_agg(to_jsonb(x) order by x.event_date desc,x.kind),'[]'::jsonb)
  from (
    select t.transaction_date event_date,'transaction' kind,to_jsonb(t) data
    from finance_transactions t where t.user_id=p_user_id and t.deleted_at is null
      and (p_date_from is null or t.transaction_date>=p_date_from) and (p_date_to is null or t.transaction_date<=p_date_to)
    union all
    select i.due_date,'installment',to_jsonb(i) from finance_installments i where i.user_id=p_user_id
      and (p_date_from is null or i.due_date>=p_date_from) and (p_date_to is null or i.due_date<=p_date_to)
    union all
    select r.due_date,'reminder',to_jsonb(r) from finance_reminders r where r.finance_user_id=p_user_id and r.status='pending'
      and r.due_date is not null and (p_date_from is null or r.due_date>=p_date_from) and (p_date_to is null or r.due_date<=p_date_to)
    union all
    select a.created_at::date,'alert',to_jsonb(a) from finance_alerts a where a.user_id=p_user_id
      and (p_date_from is null or a.created_at::date>=p_date_from) and (p_date_to is null or a.created_at::date<=p_date_to)
    order by event_date desc,kind limit greatest(1,least(coalesce(p_limit,200),500))
  ) x;
$$;

do $$ declare f record; begin
  for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('finance_budget_summary','finance_budget_create','finance_goal_list','finance_goal_create',
      'finance_goal_contribute','finance_alert_list','finance_alert_dismiss','finance_insight_list','finance_cashflow_projection','finance_timeline') loop
    execute format('revoke all on function %s from public,anon,authenticated',f.sig);
    execute format('grant execute on function %s to service_role',f.sig);
  end loop;
end $$;


-- Manual investments, assets, liabilities and net-worth snapshots.

create table if not exists public.finance_investments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.finance_users(id) on delete cascade,
  institution text,
  category text not null,
  asset text not null,
  quantity numeric check (quantity is null or quantity >= 0),
  invested_amount numeric not null check (invested_amount >= 0 and invested_amount = round(invested_amount,2)),
  current_value numeric check (current_value is null or (current_value >= 0 and current_value = round(current_value,2))),
  valuation_source text not null default 'USER_INFORMED' check (valuation_source in ('USER_INFORMED','CALCULATED','ESTIMATE')),
  recorded_at date not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists finance_investments_owner_idx on public.finance_investments(user_id,recorded_at desc);

create table if not exists public.finance_assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.finance_users(id) on delete cascade,
  name text not null,
  category text not null,
  informed_value numeric not null check (informed_value >= 0 and informed_value = round(informed_value,2)),
  valuation_source text not null default 'USER_INFORMED' check (valuation_source in ('USER_INFORMED','CALCULATED','ESTIMATE')),
  recorded_at date not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.finance_liabilities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.finance_users(id) on delete cascade,
  name text not null,
  category text not null,
  outstanding_amount numeric not null check (outstanding_amount >= 0 and outstanding_amount = round(outstanding_amount,2)),
  due_date date,
  recorded_at date not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists finance_assets_owner_idx on public.finance_assets(user_id,recorded_at desc);
create index if not exists finance_liabilities_owner_idx on public.finance_liabilities(user_id,recorded_at desc);

create table if not exists public.finance_financial_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.finance_users(id) on delete cascade,
  snapshot_date date not null,
  gross_assets numeric not null check (gross_assets >= 0),
  liabilities numeric not null check (liabilities >= 0),
  net_worth numeric not null,
  assumptions jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(user_id,snapshot_date)
);
create index if not exists finance_snapshots_owner_idx on public.finance_financial_snapshots(user_id,snapshot_date desc);

alter table public.finance_investments enable row level security;
alter table public.finance_assets enable row level security;
alter table public.finance_liabilities enable row level security;
alter table public.finance_financial_snapshots enable row level security;
revoke all on public.finance_investments,public.finance_assets,public.finance_liabilities,public.finance_financial_snapshots from public,anon,authenticated;
grant select,insert,update,delete on public.finance_investments,public.finance_assets,public.finance_liabilities,public.finance_financial_snapshots to service_role;

create or replace function public.finance_investment_list(p_user_id uuid)
returns jsonb language sql security invoker set search_path=public as $$
  select coalesce(jsonb_agg(to_jsonb(i) order by i.recorded_at desc,i.created_at desc),'[]'::jsonb) from finance_investments i where i.user_id=p_user_id;
$$;

create or replace function public.finance_investment_create(p_user_id uuid,p_values jsonb)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare i finance_investments;
begin
  insert into finance_investments(user_id,institution,category,asset,quantity,invested_amount,current_value,valuation_source,recorded_at,notes)
  values(p_user_id,p_values->>'institution',btrim(p_values->>'category'),btrim(p_values->>'asset'),(p_values->>'quantity')::numeric,(p_values->>'invested_amount')::numeric,(p_values->>'current_value')::numeric,coalesce(p_values->>'valuation_source','USER_INFORMED'),(p_values->>'recorded_at')::date,p_values->>'notes') returning * into i;
  perform finance_audit_write(p_user_id,'WEB','CREATE','investment',i.id,null,null,null,to_jsonb(i),'{}'::jsonb);
  return to_jsonb(i);
end $$;

create or replace function public.finance_net_worth(p_user_id uuid)
returns jsonb language sql security invoker set search_path=public as $$
  with balances as (select coalesce(sum(case when transaction_type='receita' then amount else -amount end),0) cash from finance_transactions where user_id=p_user_id and deleted_at is null),
  investments as (select coalesce(sum(coalesce(current_value,invested_amount)),0) value from finance_investments where user_id=p_user_id),
  assets as (select coalesce(sum(informed_value),0) value from finance_assets where user_id=p_user_id),
  debts as (select coalesce(sum(outstanding_amount),0) value from finance_liabilities where user_id=p_user_id)
  select jsonb_build_object('cash',balances.cash,'investments',investments.value,'assets',assets.value,'gross_assets',balances.cash+investments.value+assets.value,'liabilities',debts.value,'net_worth',balances.cash+investments.value+assets.value-debts.value,'valuation','USER_INFORMED') from balances,investments,assets,debts;
$$;

do $$ declare f record; begin
  for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('finance_investment_list','finance_investment_create','finance_net_worth') loop
    execute format('revoke all on function %s from public,anon,authenticated',f.sig);
    execute format('grant execute on function %s to service_role',f.sig);
  end loop;
end $$;


-- Preserve live payment-aware contracts and service-only permissions.
CREATE OR REPLACE FUNCTION public.finance_dashboard_create_transaction(p_account_id uuid, p_transaction_type text, p_amount numeric, p_category text, p_description text, p_transaction_date date, p_payment_details jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r public.finance_transactions; uid uuid;
begin select finance_user_id into uid from dashboard_accounts where id=p_account_id and active;
if uid is null then return null; end if;
insert into finance_transactions(user_id,telegram_message_id,transaction_type,amount,category,description,transaction_date,payment_details,updated_by_account_id,source,fingerprint)
values(uid,-(extract(epoch from clock_timestamp())*1000000)::bigint,p_transaction_type,p_amount,p_category,p_description,p_transaction_date,coalesce(p_payment_details,'{}'::jsonb),p_account_id,'WEB',finance_transaction_fingerprint(uid,p_transaction_type,p_amount,p_transaction_date,p_description,p_category,'WEB')) returning * into r; return to_jsonb(r); end $function$
;


CREATE OR REPLACE FUNCTION public.finance_dashboard_update_transaction(p_account_id uuid, p_transaction_id uuid, p_transaction_type text, p_amount numeric, p_category text, p_description text, p_transaction_date date, p_payment_details jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r public.finance_transactions; begin
if not exists(select 1 from dashboard_accounts where id=p_account_id and active) then return null; end if;
update finance_transactions t set transaction_type=p_transaction_type,amount=p_amount,category=p_category,description=p_description,transaction_date=p_transaction_date,payment_details=coalesce(p_payment_details,'{}'::jsonb),updated_by_account_id=p_account_id,source='WEB',fingerprint=finance_transaction_fingerprint(t.user_id,p_transaction_type,p_amount,p_transaction_date,p_description,p_category,'WEB')
where t.id=p_transaction_id and t.deleted_at is null and (exists(select 1 from dashboard_accounts a where a.id=p_account_id and a.active and a.finance_user_id=t.user_id) or exists(select 1 from finance_transaction_shares s where s.transaction_id=t.id and s.shared_with_account_id=p_account_id)) returning t.* into r;
if not found then return null; end if; return to_jsonb(r); end $function$
;

do $$ declare f record; begin
 for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname like 'finance_%' loop
 execute format('revoke all on function %s from public,anon,authenticated',f.sig);
 execute format('grant execute on function %s to service_role',f.sig);
 end loop;
end $$;
