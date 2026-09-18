-- Profile photos are compact JPEG thumbnails, private to the signed-in account.
alter table public.dashboard_accounts
  add column if not exists avatar_data_url text;
alter table public.dashboard_accounts
  add constraint dashboard_accounts_avatar_size check (
    avatar_data_url is null or (length(avatar_data_url) <= 140000 and avatar_data_url ~ '^data:image/jpeg;base64,[A-Za-z0-9+/]+={0,2}$')
  );
