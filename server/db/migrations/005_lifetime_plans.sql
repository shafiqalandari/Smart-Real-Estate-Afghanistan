-- SafarPro: true lifetime subscription support.
-- Safe to run more than once.

alter table public.subscription_plans
  drop constraint if exists subscription_plans_duration_unit_check;

alter table public.subscription_plans
  add constraint subscription_plans_duration_unit_check
  check (duration_unit in ('DAY','MONTH','YEAR','LIFETIME'));

alter table public.subscription_plans
  add column if not exists is_lifetime boolean not null default false;

update public.subscription_plans
set is_lifetime = true
where duration_unit = 'LIFETIME' and is_lifetime = false;

alter table public.installations
  add column if not exists lifetime_access boolean not null default false;

alter table public.subscriptions
  alter column expires_at drop not null;

alter table public.subscriptions
  add column if not exists is_lifetime boolean not null default false;

create index if not exists subscriptions_lifetime_idx
  on public.subscriptions(installation_id, is_lifetime, status, created_at desc);
