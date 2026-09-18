-- Unified reminders are separate from posted expenses until explicitly completed.
create table public.finance_reminders (
  id uuid primary key default gen_random_uuid(),
  short_code text not null unique default substr(replace(gen_random_uuid()::text,'-',''),1,8),
  finance_user_id uuid not null references public.finance_users(id) on delete cascade,
  kind text not null check (kind in ('bill','review')),
  description text not null check (length(btrim(description)) between 1 and 180),
  amount numeric check (amount > 0 and amount <= 100000000 and amount = round(amount,2)),
  category text check (category in ('Alimentação','Transporte','Moradia','Saúde','Educação','Lazer','Assinaturas','Outros')),
  due_date date,
  transaction_date date,
  status text not null default 'pending' check (status in ('pending','completed','cancelled')),
  reminder_offsets integer[] not null default array[3,1,0] check (reminder_offsets <@ array[3,1,0] and cardinality(reminder_offsets) <= 3),
  reminder_hour integer not null default 9 check (reminder_hour between 0 and 23),
  notify_telegram boolean not null default true,
  notify_push boolean not null default true,
  source text not null default 'web' check (source in ('web','telegram')),
  external_key text check (length(external_key) between 1 and 120),
  completed_transaction_id uuid references public.finance_transactions(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (kind <> 'bill' or due_date is not null),
  unique (finance_user_id, external_key)
);
create index finance_reminders_owner_status on public.finance_reminders(finance_user_id,status,created_at desc);

create table public.finance_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.dashboard_accounts(id) on delete cascade,
  endpoint text not null unique check (length(endpoint) <= 2048),
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index finance_push_subscriptions_account on public.finance_push_subscriptions(account_id);

create table public.finance_notification_config (
  singleton boolean primary key default true check (singleton),
  private_key text not null,
  public_key text not null,
  dispatch_secret text not null check (length(dispatch_secret) between 32 and 256),
  vapid_subject text not null default 'https://example.invalid'
);

create table public.finance_notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  reminder_id uuid not null references public.finance_reminders(id) on delete cascade,
  occurrence text not null,
  channel text not null check (channel in ('telegram','push')),
  destination text not null,
  subscription_id uuid references public.finance_push_subscriptions(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','leased','sent','cancelled','failed')),
  available_at timestamptz not null default now(),
  attempts integer not null default 0,
  lease_token uuid,
  lease_until timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (reminder_id,occurrence,channel,destination)
);
create index finance_notification_deliveries_claim on public.finance_notification_deliveries(status,available_at,lease_until);

alter table public.finance_reminders enable row level security;
alter table public.finance_push_subscriptions enable row level security;
alter table public.finance_notification_config enable row level security;
alter table public.finance_notification_deliveries enable row level security;
revoke all on public.finance_reminders,public.finance_push_subscriptions,public.finance_notification_config,public.finance_notification_deliveries from public,anon,authenticated;
grant all on public.finance_reminders,public.finance_push_subscriptions,public.finance_notification_config,public.finance_notification_deliveries to service_role;

create function public.finance_reminder_create(p_user_id uuid,p_values jsonb)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare r finance_reminders; offsets integer[]; begin
  if jsonb_typeof(p_values) <> 'object' or exists(select 1 from jsonb_object_keys(p_values) k where k not in ('kind','description','amount','category','due_date','transaction_date','reminder_offsets','reminder_hour','notify_telegram','notify_push','source','external_key')) then
    raise exception 'Invalid fields' using errcode='22023';
  end if;
  if p_values ? 'reminder_offsets' then select coalesce(array_agg(value::integer),'{}'::integer[]) into offsets from jsonb_array_elements_text(p_values->'reminder_offsets'); else offsets:=array[3,1,0]; end if;
  -- ON CONFLICT provides atomic source-message deduplication under parallel deliveries.
  insert into finance_reminders(finance_user_id,kind,description,amount,category,due_date,transaction_date,reminder_offsets,reminder_hour,notify_telegram,notify_push,source,external_key)
  values(p_user_id,p_values->>'kind',btrim(p_values->>'description'),(p_values->>'amount')::numeric,p_values->>'category',(p_values->>'due_date')::date,(p_values->>'transaction_date')::date,offsets,
    coalesce((p_values->>'reminder_hour')::integer,9),coalesce((p_values->>'notify_telegram')::boolean,true),coalesce((p_values->>'notify_push')::boolean,true),coalesce(p_values->>'source','web'),p_values->>'external_key')
  on conflict(finance_user_id,external_key) do update set external_key=excluded.external_key
  returning * into r;
  return to_jsonb(r);
end $$;

create function public.finance_reminder_action(p_user_id uuid,p_id uuid,p_action text,p_values jsonb default '{}'::jsonb,p_account_id uuid default null)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare r finance_reminders; v jsonb; tx finance_transactions; offsets integer[]; d date; a numeric; c text; description_value text; begin
  if p_account_id is not null and not exists(select 1 from dashboard_accounts where id=p_account_id and finance_user_id=p_user_id and active) then return null; end if;
  select * into r from finance_reminders where id=p_id and finance_user_id=p_user_id for update;
  if not found then return null; end if;
  if p_action not in ('complete','cancel','update') or jsonb_typeof(p_values)<>'object' or exists(select 1 from jsonb_object_keys(p_values) k where k not in ('description','amount','category','due_date','transaction_date','reminder_offsets','reminder_hour','notify_telegram','notify_push')) then
    raise exception 'Invalid action' using errcode='22023';
  end if;
  if p_action='complete' and r.status='completed' then return to_jsonb(r); end if;
  if p_action='cancel' and r.status='cancelled' then return to_jsonb(r); end if;
  if r.status<>'pending' then raise exception 'Reminder already closed' using errcode='55000'; end if;
  if p_action='cancel' then
    update finance_reminders set status='cancelled',updated_at=now() where id=r.id returning * into r;
  else
    v:=to_jsonb(r)||p_values;
    if p_action='update' then
      select coalesce(array_agg(value::integer),'{}'::integer[]) into offsets from jsonb_array_elements_text(v->'reminder_offsets');
      update finance_reminders set description=btrim(v->>'description'),amount=(v->>'amount')::numeric,category=v->>'category',due_date=(v->>'due_date')::date,transaction_date=(v->>'transaction_date')::date,
        reminder_offsets=offsets,reminder_hour=(v->>'reminder_hour')::integer,notify_telegram=(v->>'notify_telegram')::boolean,notify_push=(v->>'notify_push')::boolean,updated_at=now()
        where id=r.id returning * into r;
      -- Re-evaluate changed schedules; sent occurrences remain deduplicated.
      update finance_notification_deliveries set status='cancelled',lease_token=null,lease_until=null where reminder_id=r.id and status in ('pending','leased');
      return to_jsonb(r);
    end if;
    a:=(v->>'amount')::numeric; c:=v->>'category'; d:=(v->>'transaction_date')::date; description_value:=btrim(v->>'description');
    if a is null or a<=0 or a>100000000 or a<>round(a,2) or c is null or c not in ('Alimentação','Transporte','Moradia','Saúde','Educação','Lazer','Assinaturas','Outros')
      or d is null or d>(now() at time zone 'America/Sao_Paulo')::date or description_value is null or length(description_value) not between 1 and 180 then
      raise exception 'Expense needs valid amount, category, description and nonfuture date' using errcode='22023';
    end if;
    insert into finance_transactions(user_id,telegram_message_id,transaction_type,amount,category,description,transaction_date,updated_by_account_id)
      values(p_user_id,-(extract(epoch from clock_timestamp())*1000000)::bigint,'despesa',a,c,description_value,d,p_account_id) returning * into tx;
    update finance_reminders set status='completed',completed_transaction_id=tx.id,amount=a,category=c,description=description_value,transaction_date=d,updated_at=now() where id=r.id returning * into r;
  end if;
  update finance_notification_deliveries set status='cancelled',lease_token=null,lease_until=null where reminder_id=r.id and status in ('pending','leased');
  return to_jsonb(r);
end $$;

create function public.finance_push_subscribe(p_account_id uuid,p_endpoint text,p_p256dh text,p_auth text)
returns boolean language plpgsql security invoker set search_path=public as $$
declare owned uuid; begin
  if not exists(select 1 from dashboard_accounts where id=p_account_id and active) then return false; end if;
  insert into finance_push_subscriptions(account_id,endpoint,p256dh,auth) values(p_account_id,p_endpoint,p_p256dh,p_auth)
  on conflict(endpoint) do update set p256dh=excluded.p256dh,auth=excluded.auth,updated_at=now() where finance_push_subscriptions.account_id=excluded.account_id
  returning account_id into owned;
  return owned=p_account_id;
end $$;
create function public.finance_push_unsubscribe(p_account_id uuid,p_endpoint text)
returns boolean language plpgsql security invoker set search_path=public as $$
begin delete from finance_push_subscriptions where account_id=p_account_id and endpoint=p_endpoint; return true; end $$;

-- Clock injection is service-role only, useful for deterministic scheduling tests.
create function public.finance_notification_claim(p_now timestamptz default now(),p_limit integer default 30)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare today date := (p_now at time zone 'America/Sao_Paulo')::date; result jsonb; begin
  -- No catch-up burst: only today's bill offset, one overdue notice, latest review occurrence.
  with scheduled as (
    select r.*,case when r.kind='bill' then case when r.due_date<today then 'overdue' else 'due:'||r.due_date::text||':'||(r.due_date-today)::text end
      else 'review:'||least(2,floor(extract(epoch from(p_now-r.created_at))/86400)::integer)::text end occurrence
    from finance_reminders r where r.status='pending' and
      ((r.kind='bill' and extract(hour from(p_now at time zone 'America/Sao_Paulo'))>=r.reminder_hour and
        ((r.due_date-today)=any(r.reminder_offsets) or (r.due_date<today and cardinality(r.reminder_offsets)>0)))
       or (r.kind='review' and r.created_at<=p_now))
  ), targets as (
    select r.id,r.occurrence,'telegram' channel,u.telegram_chat_id::text destination,null::uuid subscription_id
      from scheduled r join finance_users u on u.id=r.finance_user_id where r.notify_telegram and u.telegram_chat_id is not null
    union all
    select r.id,r.occurrence,'push',s.id::text,s.id from scheduled r join dashboard_accounts a on a.finance_user_id=r.finance_user_id and a.active
      join finance_push_subscriptions s on s.account_id=a.id where r.notify_push
  )
  insert into finance_notification_deliveries(reminder_id,occurrence,channel,destination,subscription_id,available_at)
    select id,occurrence,channel,destination,subscription_id,p_now from targets
    on conflict(reminder_id,occurrence,channel,destination) do update set status='pending',available_at=excluded.available_at
      where finance_notification_deliveries.status='cancelled';
  -- Expired retries must not stack with the current occurrence after downtime.
  update finance_notification_deliveries d set status='cancelled',lease_token=null,lease_until=null
    from finance_reminders r where r.id=d.reminder_id and d.status in ('pending','leased') and
      ((r.kind='bill' and d.occurrence<>case when r.due_date<today then 'overdue' else 'due:'||r.due_date::text||':'||(r.due_date-today)::text end)
       or (r.kind='review' and d.occurrence<>'review:'||least(2,greatest(0,floor(extract(epoch from(p_now-r.created_at))/86400)::integer))::text));
  update finance_notification_deliveries d set status='cancelled',lease_token=null,lease_until=null
    where d.status in ('pending','leased') and not exists(select 1 from finance_reminders r where r.id=d.reminder_id and r.status='pending');
  update finance_notification_deliveries set status='failed',lease_token=null,lease_until=null
    where status='leased' and lease_until<=p_now and attempts>=3;
  with selected as (
    select d.id from finance_notification_deliveries d join finance_reminders r on r.id=d.reminder_id
    where r.status='pending' and d.attempts<3 and d.available_at<=p_now and (d.status='pending' or (d.status='leased' and d.lease_until<=p_now))
    order by d.available_at,d.created_at limit greatest(1,least(p_limit,50)) for update of d skip locked
  ), claimed as (
    update finance_notification_deliveries d set status='leased',attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=p_now+interval '5 minutes'
      from selected s where d.id=s.id returning d.*
  ) select coalesce(jsonb_agg(to_jsonb(claimed)),'[]'::jsonb) into result from claimed;
  return result;
end $$;

create function public.finance_notification_check(p_id uuid,p_lease_token uuid)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare d finance_notification_deliveries; r finance_reminders; s finance_push_subscriptions; begin
  select * into d from finance_notification_deliveries where id=p_id and lease_token=p_lease_token and status='leased' and lease_until>now();
  if not found then return null; end if;
  select * into r from finance_reminders where id=d.reminder_id and status='pending';
  if not found then return null; end if;
  if d.channel='telegram' then
    if not r.notify_telegram or not exists(select 1 from finance_users where id=r.finance_user_id and telegram_chat_id::text=d.destination) then return null; end if;
    return jsonb_build_object('id',d.id,'lease_token',d.lease_token,'channel','telegram','chat_id',d.destination,'kind',r.kind,'short_code',r.short_code);
  end if;
  if not r.notify_push then return null; end if;
  select ps.* into s from finance_push_subscriptions ps join dashboard_accounts a on a.id=ps.account_id and a.active and a.finance_user_id=r.finance_user_id where ps.id=d.subscription_id;
  if not found then return null; end if;
  return jsonb_build_object('id',d.id,'lease_token',d.lease_token,'channel','push','subscription_id',s.id,'endpoint',s.endpoint,'keys',jsonb_build_object('p256dh',s.p256dh,'auth',s.auth));
end $$;

create function public.finance_notification_ack(p_id uuid,p_lease_token uuid,p_success boolean)
returns boolean language plpgsql security invoker set search_path=public as $$
begin
  update finance_notification_deliveries set status=case when p_success then 'sent' when attempts>=3 then 'failed' else 'pending' end,
    sent_at=case when p_success then now() else sent_at end,available_at=now()+interval '15 minutes',lease_token=null,lease_until=null
    where id=p_id and lease_token=p_lease_token and status='leased';
  return found;
end $$;

revoke all on function public.finance_reminder_create(uuid,jsonb),public.finance_reminder_action(uuid,uuid,text,jsonb,uuid),public.finance_push_subscribe(uuid,text,text,text),public.finance_push_unsubscribe(uuid,text),public.finance_notification_claim(timestamptz,integer),public.finance_notification_check(uuid,uuid),public.finance_notification_ack(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.finance_reminder_create(uuid,jsonb),public.finance_reminder_action(uuid,uuid,text,jsonb,uuid),public.finance_push_subscribe(uuid,text,text,text),public.finance_push_unsubscribe(uuid,text),public.finance_notification_claim(timestamptz,integer),public.finance_notification_check(uuid,uuid),public.finance_notification_ack(uuid,uuid,boolean) to service_role;
