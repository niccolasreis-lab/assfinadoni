-- PDF support reuses private, authenticated attachment access. No new grants.
alter table public.finance_transaction_attachments
  drop constraint finance_transaction_attachments_content_type_check,
  drop constraint finance_transaction_attachments_data_url_check;
alter table public.finance_transaction_attachments
  add constraint finance_transaction_attachments_content_type_check
    check (content_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  add constraint finance_transaction_attachments_data_url_check
    check (length(data_url) <= 1400000
      and data_url ~ '^data:(image/(jpeg|png|webp)|application/pdf);base64,[A-Za-z0-9+/]+={0,2}$'
      and split_part(split_part(data_url, ';', 1), ':', 2) = content_type);
