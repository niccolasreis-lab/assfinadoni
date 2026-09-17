create extension if not exists pg_cron with schema pg_catalog;

grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

-- pg_cron on Supabase uses UTC. 06:00 UTC is 03:00 in America/Sao_Paulo.
select cron.unschedule(jobid)
from cron.job
where jobname = 'finance_purge_deleted_transactions_30d';

select cron.schedule(
  'finance_purge_deleted_transactions_30d',
  '0 6 * * *',
  $job$
    delete from public.finance_transactions
    where deleted_at is not null
      and deleted_at < now() - interval '30 days';
  $job$
);
