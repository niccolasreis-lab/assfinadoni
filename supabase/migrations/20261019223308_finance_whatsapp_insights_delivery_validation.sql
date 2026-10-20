create or replace function public.finance_whatsapp_insights(p_action text,p_user_id uuid default null,p_values jsonb default '{}') returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare u uuid; local_now timestamp:=now() at time zone 'America/Sao_Paulo'; m date; w date; r record; income numeric; expense numeric; n integer; categories text; b text; category_name text; lim numeric; ratio numeric; level integer; result jsonb;
begin
 select id into u from finance_users where telegram_chat_id=120363433 limit 1;
 if u is null or (p_user_id is not null and p_user_id<>u) then return jsonb_build_object('ok',false);end if;
 m:=date_trunc('month',local_now)::date;w:=date_trunc('week',local_now)::date-7;
 if p_action='context' then
 return jsonb_build_object('ok',true,'weekly',coalesce((select weekly_enabled from finance_whatsapp_insight_settings where finance_user_id=u),false),'weekly_schedule','Segunda-feira às 09:00, São Paulo','budgets',coalesce((select jsonb_agg(jsonb_build_object('category',q.category,'monthly_limit',q.monthly_limit,'enabled',q.enabled,'spent',coalesce((select sum(t.amount) from finance_transactions t where t.user_id=u and t.deleted_at is null and t.transaction_type='despesa' and t.category=q.category and t.transaction_date>=m and t.transaction_date<(m+interval '1 month')::date and t.transaction_date<=local_now::date),0))) from finance_whatsapp_budgets q where q.finance_user_id=u),'[]'::jsonb));
 elsif p_action in ('weekly','budget','disable_budget') then
 if p_user_id is null then return jsonb_build_object('ok',false);end if;
 if p_action='weekly' then
 insert into finance_whatsapp_insight_settings values(u,(p_values->>'enabled')::boolean,now()) on conflict(finance_user_id) do update set weekly_enabled=excluded.weekly_enabled,updated_at=now();
 if not (p_values->>'enabled')::boolean then update finance_whatsapp_insight_deliveries set status='cancelled' where finance_user_id=u and kind='weekly' and status='pending';end if;
 else
 category_name:=trim(p_values->>'category');
 if category_name is null or length(category_name) not between 1 and 80 then return jsonb_build_object('ok',false);end if;
 select category into category_name from (select category from finance_whatsapp_budgets where finance_user_id=u union select category from finance_transactions where user_id=u union select unnest(array['Alimentação','Transporte','Moradia','Saúde','Educação','Lazer','Assinaturas','Casamento','Viagem','Outros'])) c where lower(c.category)=lower(trim(p_values->>'category')) limit 1;
 if category_name is null then return jsonb_build_object('ok',false,'reason','unknown_category');end if;
 if p_action='budget' then
 lim:=(p_values->>'monthly_limit')::numeric;if lim is null or lim<=0 or lim>100000000 then return jsonb_build_object('ok',false);end if;
 insert into finance_whatsapp_budgets values(u,category_name,lim,true,now()) on conflict(finance_user_id,category) do update set monthly_limit=excluded.monthly_limit,enabled=true,updated_at=now();
 else update finance_whatsapp_budgets set enabled=false,updated_at=now() where finance_user_id=u and category=category_name;end if;
 update finance_whatsapp_insight_deliveries set status='cancelled' where finance_user_id=u and kind='budget' and category=category_name and status='pending';
 end if;return jsonb_build_object('ok',true);
 elsif p_action='claim' then
 if exists(select 1 from finance_whatsapp_insight_settings where finance_user_id=u and weekly_enabled) and local_now>=date_trunc('week',local_now)+interval '9 hours' then
 select coalesce(sum(amount) filter(where transaction_type='receita'),0),coalesce(sum(amount) filter(where transaction_type='despesa'),0),count(*) into income,expense,n from finance_transactions where user_id=u and deleted_at is null and transaction_date>=w and transaction_date<w+7;
 select string_agg(category||': R$ '||replace(round(s,2)::text,'.',','),E'\n' order by s desc) into categories from(select category,sum(amount) s from finance_transactions where user_id=u and deleted_at is null and transaction_type='despesa' and transaction_date>=w and transaction_date<w+7 group by category) c;
 b:='Ní e Ionara, nossa semana em números 📊'||E'\n'||to_char(w,'DD/MM')||' a '||to_char(w+6,'DD/MM/YYYY')||E'\nReceitas: R$ '||replace(to_char(income,'FM999999999990.00'),'.',',')||E'\nDespesas: R$ '||replace(to_char(expense,'FM999999999990.00'),'.',',')||E'\nResultado dos lançamentos: R$ '||replace(to_char((income-expense),'FM999999999990.00'),'.',',')||E'\n'||n||' lançamentos.'||case when categories is null then E'\nSem despesas registradas nessa semana.' else E'\n\nPor categoria:\n'||categories end||E'\n\nBora cuidar dos planos de vocês, um gasto de cada vez 😊';
 insert into finance_whatsapp_insight_deliveries(finance_user_id,event_key,kind,period_start,body) values(u,'weekly:'||w,'weekly',w,b) on conflict do nothing;
 end if;
 -- Budget notifications are sent only between 09:00 and 20:59 local time.
 if extract(hour from local_now) between 9 and 20 then
 for r in select q.*,coalesce((select sum(amount) from finance_transactions t where t.user_id=u and t.deleted_at is null and t.transaction_type='despesa' and t.category=q.category and t.transaction_date>=m and t.transaction_date<(m+interval '1 month')::date and t.transaction_date<=local_now::date),0) spent from finance_whatsapp_budgets q where q.finance_user_id=u and q.enabled loop
 ratio:=r.spent/r.monthly_limit;level:=case when ratio>=1 then 100 when ratio>=0.8 then 80 else 0 end;
 if level>0 and not exists(select 1 from finance_whatsapp_insight_deliveries where finance_user_id=u and kind='budget' and category=r.category and period_start=m and threshold>=level) then
 b:='Ní e Ionara, atenção ao combinado de '||r.category||' 👀'||E'\nGastos do mês: R$ '||replace(to_char(r.spent,'FM999999999990.00'),'.',',')||' de R$ '||replace(to_char(r.monthly_limit,'FM999999999990.00'),'.',',')||' ('||round(ratio*100)||'%).'||case when level=100 then E'\nO limite foi atingido. Vale conferir os próximos gastos juntos.' else E'\nVocês chegaram a 80% do limite. Ainda dá para ajustar o ritmo 😊' end;
 update finance_whatsapp_insight_deliveries set status='cancelled' where finance_user_id=u and kind='budget' and category=r.category and period_start=m and status='pending' and threshold<level;
 insert into finance_whatsapp_insight_deliveries(finance_user_id,event_key,kind,category,period_start,threshold,body) values(u,'budget:'||m||':'||r.category||':'||level,'budget',r.category,m,level,b) on conflict do nothing;
 end if;end loop;end if;
 with candidates as(select id from finance_whatsapp_insight_deliveries where finance_user_id=u and status='pending' order by created_at limit 10 for update skip locked), claimed as(update finance_whatsapp_insight_deliveries d set status='sending',lease_token=gen_random_uuid() from candidates c where d.id=c.id returning d.*) select coalesce(jsonb_agg(to_jsonb(claimed)),'[]') into result from claimed;
 return jsonb_build_object('deliveries',result);
 elsif p_action='check' then
 return jsonb_build_object('ok',exists(select 1 from finance_whatsapp_insight_deliveries d where d.finance_user_id=u and d.id=(p_values->>'id')::uuid and d.lease_token=(p_values->>'lease_token')::uuid and d.status='sending' and ((d.kind='weekly' and d.period_start=w and exists(select 1 from finance_whatsapp_insight_settings s where s.finance_user_id=u and s.weekly_enabled)) or(d.kind='budget' and exists(select 1 from finance_whatsapp_budgets q where q.finance_user_id=u and q.category=d.category and q.enabled and q.updated_at<=d.created_at and d.period_start=m and coalesce((select sum(amount) from finance_transactions t where t.user_id=u and t.deleted_at is null and t.transaction_type='despesa' and t.category=q.category and t.transaction_date>=d.period_start and t.transaction_date<(d.period_start+interval '1 month')::date and t.transaction_date<=local_now::date),0)>=q.monthly_limit*d.threshold/100)))));
 elsif p_action='ack' then
 update finance_whatsapp_insight_deliveries set status=case when (p_values->>'success')::boolean then 'sent' else 'failed' end,sent_at=case when (p_values->>'success')::boolean then now() end where finance_user_id=u and id=(p_values->>'id')::uuid and lease_token=(p_values->>'lease_token')::uuid and status='sending';return jsonb_build_object('ok',found);
 end if;return jsonb_build_object('ok',false);
end $$;
revoke all on function public.finance_whatsapp_insights(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.finance_whatsapp_insights(text,uuid,jsonb) to service_role;

