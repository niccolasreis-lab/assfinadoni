alter table public.finance_transactions
  add column if not exists payment_details jsonb not null default '{}'::jsonb;

create or replace function public.finance_dashboard_create_transaction(
  p_account_id uuid,
  p_transaction_type text,
  p_amount numeric,
  p_category text,
  p_description text,
  p_transaction_date date,
  p_payment_details jsonb default '{}'::jsonb
)
returns public.finance_transactions
language plpgsql
security definer
set search_path = public
as $$
declare result public.finance_transactions;
begin
  insert into public.finance_transactions (user_id, transaction_type, amount, category, description, transaction_date, payment_details)
  values (p_account_id, p_transaction_type, p_amount, p_category, p_description, p_transaction_date, coalesce(p_payment_details, '{}'::jsonb))
  returning * into result;
  return result;
end;
$$;

create or replace function public.finance_dashboard_update_transaction(
  p_account_id uuid,
  p_transaction_id uuid,
  p_transaction_type text,
  p_amount numeric,
  p_category text,
  p_description text,
  p_transaction_date date,
  p_payment_details jsonb default '{}'::jsonb
)
returns public.finance_transactions
language plpgsql
security definer
set search_path = public
as $$
declare result public.finance_transactions;
begin
  update public.finance_transactions
  set transaction_type = p_transaction_type,
      amount = p_amount,
      category = p_category,
      description = p_description,
      transaction_date = p_transaction_date,
      payment_details = coalesce(p_payment_details, '{}'::jsonb)
  where id = p_transaction_id and user_id = p_account_id
  returning * into result;
  if result.id is null then raise exception 'Lançamento não encontrado.'; end if;
  return result;
end;
$$;

