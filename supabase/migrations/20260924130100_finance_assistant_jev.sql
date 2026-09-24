-- Jev telemetry is appended after the atomic assistant operation completes.
-- It remains in the existing result JSON so dashboard and Telegram consumers
-- can display a repaired response without a second public table.
create function public.finance_assistant_record_quality(p_id uuid,p_quality jsonb,p_text text default null)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare j finance_assistant_jobs; merged jsonb;
begin
 select * into j from finance_assistant_jobs where id=p_id for update;
 if not found then return null; end if;
 if j.status not in ('done','failed','awaiting_confirmation') then return to_jsonb(j)-'payload'-'operation'-'lease_token'; end if;
 merged:=coalesce(j.result,'{}'::jsonb)||jsonb_build_object('quality',coalesce(p_quality,'{}'::jsonb));
 if p_text is not null and length(btrim(p_text))>0 then merged:=merged||jsonb_build_object('text',left(p_text,3000)); end if;
 update finance_assistant_jobs set result=merged,updated_at=now() where id=j.id returning * into j;
 return to_jsonb(j)-'payload'-'operation'-'lease_token';
end $$;

-- Jev can request confirmation before the normal finish RPC performs a
-- mutation. The existing confirm/cancel jobs then reuse finance_assistant_finish.
create function public.finance_assistant_request_confirmation(p_id uuid,p_lease uuid,p_operation jsonb,p_text text,p_transcript text default '')
returns jsonb language plpgsql security invoker set search_path=public as $$
declare j finance_assistant_jobs; op jsonb:=p_operation; items jsonb:='[]';
begin
 select * into j from finance_assistant_jobs where id=p_id for update;
 if not found then return null; end if;
 if j.status<>'processing' or j.lease_token is distinct from p_lease or j.lease_until<=now() then raise exception 'Expired lease'; end if;
 if op is null or op->>'action' not in ('create','update','delete','reminder','complete_reminder') then raise exception 'Invalid confirmation operation'; end if;
 if jsonb_typeof(op->'transactions')='array' then items:=op->'transactions'; end if;
 update finance_assistant_jobs set status='awaiting_confirmation',operation=op,payload='{}',lease_until=null,updated_at=now(),
   result=jsonb_build_object('text',left(p_text,3000),'transcript',left(p_transcript,12000),'transactions',items,'confirmation_id',j.id)
 where id=j.id returning * into j;
 return to_jsonb(j)-'payload'-'operation'-'lease_token';
end $$;

do $$ declare f record; begin
 for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('finance_assistant_record_quality','finance_assistant_request_confirmation') loop
 execute format('revoke all on function %s from public,anon,authenticated',f.sig);
 execute format('grant execute on function %s to service_role',f.sig);
 end loop;
end $$;
