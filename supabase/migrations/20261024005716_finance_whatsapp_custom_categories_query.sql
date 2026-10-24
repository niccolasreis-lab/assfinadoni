-- Categories are labels only; neither RPC creates paid expenses or schedules.
-- Make the service-only path reproducible without relying on hosted default grants.
grant select,insert on public.finance_categories to service_role;

create or replace function public.finance_category_key(p_name text) returns text
language sql immutable strict security invoker set search_path=public,pg_temp as $$
 select lower(translate(normalize(regexp_replace(btrim(p_name),'[[:space:]]+',' ','g'),NFC),
 'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñ',
 'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn'));
$$;

create or replace function public.finance_category_valid_name(p_name text) returns boolean
language sql immutable security invoker set search_path=public,pg_temp as $$
 select coalesce(length(p_name) between 2 and 60 and p_name ~ '^[[:alnum:]][[:alnum:] &''’()./-]{1,59}$',false);
$$;

create or replace function public.finance_category_catalog(p_user_id uuid)
returns table(id uuid,name text) language sql stable security invoker set search_path=public,pg_temp as $$
 with candidates as (
  select c.id,c.name,0 priority,c.created_at from finance_categories c where c.finance_user_id=p_user_id
  union all
  select null::uuid,d.name,1,null::timestamptz from (values
   ('Alimentação'),('Transporte'),('Moradia'),('Saúde'),('Educação'),('Lazer'),('Assinaturas'),('Casamento'),('Viagem'),('Outros')
  )d(name)
  union all
  select null::uuid,t.category,2,null::timestamptz from finance_transactions t where t.user_id=p_user_id
 ), canonical as (
  select distinct on (finance_category_key(c.name)) c.id,c.name
  from candidates c where finance_category_valid_name(c.name)
  order by finance_category_key(c.name),c.priority,c.created_at nulls last,c.id nulls last,c.name
 ) select c.id,c.name from canonical c order by c.name;
$$;

create or replace function public.finance_whatsapp_categories(
 p_user_id uuid,p_action text default 'list',p_values jsonb default '{}'
) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare n text;k text;existing record;created_row finance_categories%rowtype;catalog jsonb;created boolean:=false;
begin
 if p_user_id is null or not exists(select 1 from finance_users where id=p_user_id) then return jsonb_build_object('ok',false,'reason','wallet_unavailable');end if;
 if p_values is null or jsonb_typeof(p_values)<>'object' or p_action not in('list','create') or p_action is null then return jsonb_build_object('ok',false,'reason','invalid_request');end if;
 if exists(select 1 from jsonb_object_keys(p_values)field where field<> 'name') or (p_action='list' and p_values<>'{}'::jsonb) then return jsonb_build_object('ok',false,'reason','unsupported_fields');end if;
 if p_action='create' then
  if jsonb_typeof(p_values->'name') is distinct from 'string' then return jsonb_build_object('ok',false,'reason','invalid_name');end if;
  n:=normalize(regexp_replace(btrim(p_values->>'name'),'[[:space:]]+',' ','g'),NFC);
  if not finance_category_valid_name(n) then return jsonb_build_object('ok',false,'reason','invalid_name');end if;
  k:=finance_category_key(n);
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text||':'||k,0));
  if (select count(*) from finance_categories c where c.finance_user_id=p_user_id and finance_category_key(c.name)=k)>1 then
   return jsonb_build_object('ok',false,'reason','ambiguous_category');
  end if;
  select c.id,c.name into existing from finance_category_catalog(p_user_id)c where finance_category_key(c.name)=k;
  -- Explicit creation persists legacy-only labels so the dashboard sees them too.
  -- Defaults already offered by the dashboard need no synthetic registry row.
  if not found or (existing.id is null and k not in('alimentacao','transporte','moradia','saude','educacao','lazer','assinaturas','casamento','viagem','outros')) then
   insert into finance_categories(finance_user_id,name) values(p_user_id,coalesce(existing.name,n)) returning * into created_row;
   created:=true;
   perform finance_audit_write(p_user_id,'API','CREATE','category',created_row.id,null,null,null,to_jsonb(created_row),jsonb_build_object('channel','whatsapp','label_only',true));
  end if;
 end if;
 select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id',c.id,'name',c.name))order by c.name),'[]'::jsonb) into catalog from finance_category_catalog(p_user_id)c;
 if p_action='create' then return jsonb_build_object('ok',true,'categories',catalog,'created',created,'category',jsonb_strip_nulls(jsonb_build_object('id',coalesce(created_row.id,existing.id),'name',coalesce(created_row.name,existing.name))));end if;
 return jsonb_build_object('ok',true,'categories',catalog);
end $$;

create or replace function public.finance_whatsapp_query(p_user_id uuid,p_values jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare mode text;from_date date;to_date date;category_name text;category_key text;kind text;search_text text;take integer:=50;result jsonb;
begin
 if p_user_id is null or not exists(select 1 from finance_users where id=p_user_id) then return jsonb_build_object('ok',false,'reason','wallet_unavailable');end if;
 if p_values is null or jsonb_typeof(p_values)<>'object' then return jsonb_build_object('ok',false,'reason','invalid_filters');end if;
 if exists(select 1 from jsonb_object_keys(p_values)field where field not in('action','date_from','date_to','category','type','search','limit')) then return jsonb_build_object('ok',false,'reason','unsupported_fields');end if;
 mode:=coalesce(p_values->>'action','list');
 if mode not in('list','total','breakdown') then return jsonb_build_object('ok',false,'reason','invalid_action');end if;
 if exists(select 1 from jsonb_each(p_values)e where e.key in('action','date_from','date_to','category','type','search')and jsonb_typeof(e.value) not in('string','null')) then return jsonb_build_object('ok',false,'reason','invalid_filters');end if;
 begin
  if p_values->>'date_from' is not null then
   if (p_values->>'date_from')!~'^\d{4}-\d{2}-\d{2}$' then return jsonb_build_object('ok',false,'reason','invalid_date');end if;
   from_date:=(p_values->>'date_from')::date;
  end if;
  if p_values->>'date_to' is not null then
   if (p_values->>'date_to')!~'^\d{4}-\d{2}-\d{2}$' then return jsonb_build_object('ok',false,'reason','invalid_date');end if;
   to_date:=(p_values->>'date_to')::date;
  end if;
 exception when datetime_field_overflow or invalid_datetime_format then return jsonb_build_object('ok',false,'reason','invalid_date');end;
 if from_date is not null and to_date is not null and from_date>to_date then return jsonb_build_object('ok',false,'reason','invalid_date_range');end if;
 kind:=p_values->>'type';
 if kind is not null and kind not in('receita','despesa') then return jsonb_build_object('ok',false,'reason','invalid_type');end if;
 search_text:=nullif(btrim(p_values->>'search'),'');
 if search_text is not null and (length(search_text)>120 or search_text~'[[:cntrl:]]') then return jsonb_build_object('ok',false,'reason','invalid_search');end if;
 if p_values?'limit' then
  if jsonb_typeof(p_values->'limit') is distinct from 'number' or (p_values->>'limit')!~'^(?:[1-9]|[1-4][0-9]|50)$' then return jsonb_build_object('ok',false,'reason','invalid_limit');end if;
  take:=(p_values->>'limit')::integer;
 end if;
 if p_values->>'category' is not null then
  category_key:=finance_category_key(p_values->>'category');
  if not finance_category_valid_name(normalize(regexp_replace(btrim(p_values->>'category'),'[[:space:]]+',' ','g'),NFC)) then return jsonb_build_object('ok',false,'reason','invalid_category');end if;
  if (select count(*) from finance_categories c where c.finance_user_id=p_user_id and finance_category_key(c.name)=category_key)>1 then return jsonb_build_object('ok',false,'reason','ambiguous_category');end if;
  select c.name into category_name from finance_category_catalog(p_user_id)c where finance_category_key(c.name)=category_key;
  if not found then return jsonb_build_object('ok',false,'reason','unknown_category');end if;
 end if;
 with category_names as materialized(select c.name,finance_category_key(c.name) category_key from finance_category_catalog(p_user_id)c), filtered as materialized (
  select t.id,t.transaction_type,t.amount,t.category,t.description,t.transaction_date,t.created_at
  from finance_transactions t where t.user_id=p_user_id and t.deleted_at is null
   and(from_date is null or t.transaction_date>=from_date)and(to_date is null or t.transaction_date<=to_date)
   and(kind is null or t.transaction_type=kind)
   and(category_key is null or finance_category_key(t.category)=category_key)
   and(search_text is null or strpos(finance_category_key(coalesce(t.description,'')||' '||t.category),finance_category_key(search_text))>0)
 ), shown as (
  select * from filtered order by transaction_date desc,created_at desc,id desc limit take
 ), grouped as (
  select coalesce(c.name,f.category) category,f.transaction_type,count(*) matched_count,sum(f.amount) total
  from filtered f left join category_names c on c.category_key=finance_category_key(f.category)
  group by coalesce(c.name,f.category),f.transaction_type
 ) select jsonb_build_object(
  'ok',true,'filters',jsonb_build_object('date_from',from_date,'date_to',to_date,'category',category_name,'type',kind,'search',search_text),
  'coverage',jsonb_build_object('complete',true,'matchedCount',(select count(*)from filtered),'shownCount',(select count(*)from shown),'limit',take),
  'totals',jsonb_build_object('income',coalesce((select sum(amount)from filtered where transaction_type='receita'),0),'expense',coalesce((select sum(amount)from filtered where transaction_type='despesa'),0),'net',coalesce((select sum(case when transaction_type='receita'then amount else -amount end)from filtered),0)),
  'transactions',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'transaction_type',s.transaction_type,'amount',s.amount,'category',s.category,'description',s.description,'transaction_date',s.transaction_date)order by s.transaction_date desc,s.created_at desc,s.id desc)from shown s),'[]'::jsonb),
  'breakdown',case when mode='breakdown' then coalesce((select jsonb_agg(jsonb_build_object('category',g.category,'type',g.transaction_type,'count',g.matched_count,'total',g.total)order by g.category,g.transaction_type)from grouped g),'[]'::jsonb)else '[]'::jsonb end
 ) into result;
 return result;
end $$;

revoke all on function public.finance_category_key(text),public.finance_category_valid_name(text),public.finance_category_catalog(uuid),public.finance_whatsapp_categories(uuid,text,jsonb),public.finance_whatsapp_query(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.finance_category_key(text),public.finance_category_valid_name(text),public.finance_category_catalog(uuid),public.finance_whatsapp_categories(uuid,text,jsonb),public.finance_whatsapp_query(uuid,jsonb) to service_role;
