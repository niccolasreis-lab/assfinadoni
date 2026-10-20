create table public.finance_whatsapp_voice_preferences (
 finance_user_id uuid primary key references public.finance_users(id) on delete cascade,
 important_enabled boolean not null default true,weekly_enabled boolean not null default false,
 muted_until timestamptz,speed numeric(3,2) not null default 1 check(speed in (0.9,1,1.1)),updated_at timestamptz not null default now()
);
create table public.finance_whatsapp_voice_deliveries (
 id uuid primary key default gen_random_uuid(),finance_user_id uuid not null references public.finance_users(id) on delete cascade,
 source_kind text not null check(source_kind in ('alert','insight')),source_delivery_id uuid not null,parent_lease_token uuid not null,
 lease_token uuid not null default gen_random_uuid(),status text not null default 'sending' check(status in ('sending','sent','failed','skipped')),
 created_at timestamptz not null default now(),sent_at timestamptz,unique(source_kind,source_delivery_id)
);
create index finance_wa_voice_user on public.finance_whatsapp_voice_deliveries(finance_user_id,created_at);
alter table public.finance_whatsapp_voice_preferences enable row level security;
alter table public.finance_whatsapp_voice_deliveries enable row level security;
create policy service_only on public.finance_whatsapp_voice_preferences to service_role using(true) with check(true);
create policy service_only on public.finance_whatsapp_voice_deliveries to service_role using(true) with check(true);
revoke all on public.finance_whatsapp_voice_preferences,public.finance_whatsapp_voice_deliveries from public,anon,authenticated;
grant select,insert,update,delete on public.finance_whatsapp_voice_preferences,public.finance_whatsapp_voice_deliveries to service_role;
create function public.finance_whatsapp_voice(p_action text,p_user_id uuid default null,p_values jsonb default '{}') returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare u uuid;p record;d record;v record; source text;is_weekly boolean:=false;allowed boolean:=false;volume_speed numeric;new_mute timestamptz;
begin
 select id into u from finance_users where telegram_chat_id=120363433 limit 1;
 if u is null or(p_user_id is not null and p_user_id<>u)then return jsonb_build_object('ok',false);end if;
 if p_action='configure' then
 if p_user_id is null then return jsonb_build_object('ok',false);end if;
 if p_values ? 'speed' and (p_values->>'speed')::numeric not in(0.9,1,1.1)then return jsonb_build_object('ok',false);end if;
 if p_values ? 'muted_until' and p_values->>'muted_until' is not null then new_mute:=(p_values->>'muted_until')::timestamptz;if new_mute<now() or new_mute>now()+interval '31 days' then return jsonb_build_object('ok',false);end if;end if;
 insert into finance_whatsapp_voice_preferences(finance_user_id)values(u)on conflict do nothing;
 update finance_whatsapp_voice_preferences set important_enabled=case when p_values?'important_enabled' then (p_values->>'important_enabled')::boolean else important_enabled end,weekly_enabled=case when p_values?'weekly_enabled' then(p_values->>'weekly_enabled')::boolean else weekly_enabled end,muted_until=case when p_values?'muted_until' then new_mute else muted_until end,speed=case when p_values?'speed' then(p_values->>'speed')::numeric else speed end,updated_at=now() where finance_user_id=u;
 end if;
 select coalesce(q.important_enabled,true) important_enabled,coalesce(q.weekly_enabled,false) weekly_enabled,q.muted_until,coalesce(q.speed,1) speed into p from (select u id) x left join finance_whatsapp_voice_preferences q on q.finance_user_id=x.id;
 if p_action in('context','configure')then return jsonb_build_object('ok',true,'preferences',to_jsonb(p),'voice_name','Bot do Ni');end if;
 if p_action in('check','ack')then
 select * into v from finance_whatsapp_voice_deliveries where finance_user_id=u and id=(p_values->>'voice_id')::uuid and lease_token=(p_values->>'voice_lease')::uuid and status='sending';
 if not found then return jsonb_build_object('ok',false);end if;
 if p_action='ack' then update finance_whatsapp_voice_deliveries set status=case when(p_values->>'success')::boolean then 'sent' else 'failed' end,sent_at=case when(p_values->>'success')::boolean then now() end where id=v.id;return jsonb_build_object('ok',true);end if;
 source:=v.source_kind;
 else source:=p_values->>'source_kind';end if;
 if source='alert' then
 select d1.*,a.status parent_status,a.due_at,a.description,a.amount,a.actor_jid from finance_whatsapp_alert_deliveries d1 join finance_whatsapp_alerts a on a.id=d1.alert_id where a.finance_user_id=u and d1.id=case when p_action='check' then v.source_delivery_id else(p_values->>'source_delivery_id')::uuid end and d1.lease_token=case when p_action='check' then v.parent_lease_token else(p_values->>'parent_lease_token')::uuid end into d;
 if found then allowed:=d.status='sent' and d.parent_status='pending' and d.due_version=d.due_at and p.important_enabled;end if;
 elsif source='insight' then
 select * into d from finance_whatsapp_insight_deliveries where finance_user_id=u and id=case when p_action='check' then v.source_delivery_id else(p_values->>'source_delivery_id')::uuid end and lease_token=case when p_action='check' then v.parent_lease_token else(p_values->>'parent_lease_token')::uuid end;
 if found then
 is_weekly:=d.kind='weekly';allowed:=d.status='sent' and case when is_weekly then p.weekly_enabled and exists(select 1 from finance_whatsapp_insight_settings s where s.finance_user_id=u and s.weekly_enabled) else p.important_enabled and exists(select 1 from finance_whatsapp_budgets b where b.finance_user_id=u and b.category=d.category and b.enabled and b.updated_at<=d.created_at)end;
 if not is_weekly then allowed:=allowed and exists(select 1 from finance_whatsapp_budgets b where b.finance_user_id=u and b.category=d.category and coalesce((select sum(amount) from finance_transactions t where t.user_id=u and t.deleted_at is null and t.transaction_type='despesa' and t.category=b.category and t.transaction_date>=d.period_start and t.transaction_date<(d.period_start+interval '1 month')::date and t.transaction_date<=(now() at time zone 'America/Sao_Paulo')::date),0)>=b.monthly_limit*d.threshold/100);end if;
 end if;
 end if;
 allowed:=coalesce(allowed,false) and(p.muted_until is null or p.muted_until<=now()) and(extract(hour from now() at time zone 'America/Sao_Paulo') between 9 and 20);
 if p_action='check' then
 if not allowed then update finance_whatsapp_voice_deliveries set status='skipped' where id=v.id;end if;
 return jsonb_build_object('ok',allowed);
 elsif p_action='claim' and allowed then
 insert into finance_whatsapp_voice_deliveries(finance_user_id,source_kind,source_delivery_id,parent_lease_token) values(u,source,(p_values->>'source_delivery_id')::uuid,(p_values->>'parent_lease_token')::uuid) on conflict do nothing returning * into v;
 if not found then return jsonb_build_object('ok',false,'reason','already_attempted');end if;
 return jsonb_build_object('ok',true,'voice_id',v.id,'voice_lease',v.lease_token,'speed',p.speed,'source_kind',source,'is_weekly',is_weekly,'source',to_jsonb(d));
 end if;
 return jsonb_build_object('ok',false);
end $$;
revoke all on function public.finance_whatsapp_voice(text,uuid,jsonb)from public,anon,authenticated;
grant execute on function public.finance_whatsapp_voice(text,uuid,jsonb)to service_role;

