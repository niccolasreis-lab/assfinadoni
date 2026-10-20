-- Legacy schema prerequisite, captured without data or credentials.
-- Run ONLY for a fresh Supabase database before migrations; never import production rows.
create schema if not exists extensions;

create table if not exists public.finance_users (
  id uuid default gen_random_uuid() not null,
  telegram_chat_id bigint,
  telegram_username text,
  first_name text,
  name text,
  onboarding_state text default 'awaiting_name'::text not null,
  currency character(3) default 'BRL'::bpchar not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint finance_users_currency_check CHECK ((currency = 'BRL'::bpchar)),
  constraint finance_users_onboarding_state_check CHECK ((onboarding_state = ANY (ARRAY['awaiting_name'::text, 'active'::text]))),
  constraint finance_users_pkey PRIMARY KEY (id),
  constraint finance_users_telegram_chat_id_key UNIQUE (telegram_chat_id)
);
alter table public.finance_users enable row level security;
revoke all on public.finance_users from public,anon,authenticated;
grant select,insert,update,delete on public.finance_users to service_role;

create table if not exists public.finance_transactions (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  telegram_message_id bigint not null,
  transaction_type text not null,
  amount numeric(12,2) not null,
  category text not null,
  description text,
  transaction_date date default (timezone('America/Sao_Paulo'::text, now()))::date not null,
  created_at timestamp with time zone default now() not null,
  constraint finance_transactions_amount_check CHECK ((amount > (0)::numeric)),
  constraint finance_transactions_pkey PRIMARY KEY (id),
  constraint finance_transactions_transaction_type_check CHECK ((transaction_type = ANY (ARRAY['receita'::text, 'despesa'::text]))),
  constraint finance_transactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES finance_users(id) ON DELETE CASCADE,
  constraint finance_transactions_user_id_telegram_message_id_key UNIQUE (user_id, telegram_message_id)
);
alter table public.finance_transactions enable row level security;
revoke all on public.finance_transactions from public,anon,authenticated;
grant select,insert,update,delete on public.finance_transactions to service_role;
