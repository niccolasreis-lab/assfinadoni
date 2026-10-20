-- Applied as finance_categories_and_transaction_images.
-- This file is kept in git so local Supabase deployments reproduce the production schema.
create table if not exists public.finance_categories (
  id uuid primary key default gen_random_uuid(),
  finance_user_id uuid not null references public.finance_users(id) on delete cascade,
  name text not null check (length(btrim(name)) between 2 and 60),
  created_at timestamptz not null default now()
);
create unique index if not exists finance_categories_user_name_unique
  on public.finance_categories (finance_user_id, lower(btrim(name)));
alter table public.finance_categories enable row level security;
insert into public.finance_categories (finance_user_id, name)
select u.id, c.name from public.finance_users u
cross join (values ('Alimentação'), ('Transporte'), ('Moradia'), ('Saúde'), ('Educação'), ('Lazer'), ('Assinaturas'), ('Outros')) c(name)
on conflict do nothing;
alter table public.finance_transactions drop constraint if exists finance_transactions_category_check;
create table if not exists public.finance_transaction_attachments (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.finance_transactions(id) on delete cascade,
  finance_user_id uuid not null references public.finance_users(id) on delete cascade,
  filename text not null check (length(btrim(filename)) between 1 and 180),
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp')),
  data_url text not null check (length(data_url) <= 1400000 and data_url ~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$'),
  created_at timestamptz not null default now()
);
create index if not exists finance_transaction_attachments_transaction_idx on public.finance_transaction_attachments (transaction_id, created_at desc);
alter table public.finance_transaction_attachments enable row level security;
