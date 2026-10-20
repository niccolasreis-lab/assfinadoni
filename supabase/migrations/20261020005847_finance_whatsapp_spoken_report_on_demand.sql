create table public.finance_whatsapp_spoken_requests(
 id uuid primary key default gen_random_uuid(),finance_user_id uuid not null references finance_users(id)on delete cascade,
 source_message_id text not null check(length(source_message_id)between 1 and 256),
 body text not null check(length(body)between 1 and 5000),explicit_voice boolean not null default false,
 lease_token uuid not null default gen_random_uuid(),status text not null default 'sending' check(status in('sending','sent','failed','skipped')),
 created_at timestamptz not null default now(),sent_at timestamptz,unique(finance_user_id,source_message_id)
);
alter table public.finance_whatsapp_spoken_requests enable row level security;
create policy service_only on public.finance_whatsapp_spoken_requests to service_role using(true)with check(true);
revoke all on public.finance_whatsapp_spoken_requests from public,anon,authenticated;
grant select,insert,update,delete on public.finance_whatsapp_spoken_requests to service_role;
create function public.finance_whatsapp_spoken_report(p_action text,p_user_id uuid,p_values jsonb default '{}')returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare u uuid;p record;j public.finance_whatsapp_spoken_requests%rowtype;explicit_voice boolean:=coalesce((p_values->>'explicit_voice')::boolean,false);
begin
 select id into u from finance_users where telegram_chat_id=120363433 limit 1;
 if u is null or p_user_id is distinct from u then return jsonb_build_object('ok',false);end if;
 select coalesce(q.weekly_enabled,false)weekly_enabled,q.muted_until,coalesce(q.speed,1)speed,q.updated_at into p from(select u id)x left join finance_whatsapp_voice_preferences q on q.finance_user_id=x.id;
 if p_action='claim' then
 if not explicit_voice and(not p.weekly_enabled or p.muted_until>now())then return jsonb_build_object('ok',false,'reason','preference');end if;
 if coalesce(length(p_values->>'source_message_id'),0)not between 1 and 256 or coalesce(length(p_values->>'body'),0)not between 1 and 5000 then return jsonb_build_object('ok',false);end if;
 insert into finance_whatsapp_spoken_requests(finance_user_id,source_message_id,body,explicit_voice)values(u,p_values->>'source_message_id',p_values->>'body',explicit_voice)on conflict do nothing returning * into j;
 if not found then return jsonb_build_object('ok',false,'reason','already_attempted');end if;
 return jsonb_build_object('ok',true,'voice_id',j.id,'voice_lease',j.lease_token,'speed',p.speed,'source_kind','insight','is_weekly',true,'source',jsonb_build_object('body',j.body));
 end if;
 select * into j from finance_whatsapp_spoken_requests where finance_user_id=u and id=(p_values->>'voice_id')::uuid and lease_token=(p_values->>'voice_lease')::uuid and status='sending';
 if not found then return jsonb_build_object('ok',false);end if;
 if p_action='check' then
 if j.created_at<now()-interval '10 minutes' or(p.updated_at>j.created_at and(p.muted_until>now()or not p.weekly_enabled)) or(not j.explicit_voice and(not p.weekly_enabled or p.muted_until>now()))then update finance_whatsapp_spoken_requests set status='skipped'where id=j.id;return jsonb_build_object('ok',false);end if;
 return jsonb_build_object('ok',true);
 elsif p_action='ack' then
 update finance_whatsapp_spoken_requests set status=case when(p_values->>'success')::boolean then 'sent'else 'failed'end,sent_at=case when(p_values->>'success')::boolean then now()end where id=j.id;
 return jsonb_build_object('ok',true);
 end if;return jsonb_build_object('ok',false);
end $$;
revoke all on function public.finance_whatsapp_spoken_report(text,uuid,jsonb)from public,anon,authenticated;
grant execute on function public.finance_whatsapp_spoken_report(text,uuid,jsonb)to service_role;

