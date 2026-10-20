-- SafarPro admin compatibility migration
-- Safe to run more than once.

begin;

alter table if exists public.installations
  add column if not exists approval_status text not null default 'APPROVED',
  add column if not exists access_version bigint not null default 1,
  add column if not exists last_license_check_at timestamptz,
  add column if not exists merged_into_installation_id uuid,
  add column if not exists lifetime_access boolean not null default false;

alter table if exists public.subscription_plans
  add column if not exists device_limit integer not null default 1,
  add column if not exists is_popular boolean not null default false,
  add column if not exists referral_reward_afn numeric(14,2) not null default 0,
  add column if not exists is_lifetime boolean not null default false;

alter table if exists public.subscriptions
  add column if not exists is_lifetime boolean not null default false;

-- Normalize values used by the API.
update public.installations
set approval_status = 'APPROVED'
where approval_status is null or approval_status not in ('APPROVED','PENDING','REJECTED');

update public.subscription_plans
set device_limit = 1
where device_limit is null or device_limit < 1;

update public.subscription_plans
set is_lifetime = true
where upper(coalesce(duration_unit,'')) = 'LIFETIME';

-- Add checks only when absent.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'installations_approval_status_check'
  ) then
    alter table public.installations
      add constraint installations_approval_status_check
      check (approval_status in ('APPROVED','PENDING','REJECTED'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'subscription_plans_device_limit_check'
  ) then
    alter table public.subscription_plans
      add constraint subscription_plans_device_limit_check
      check (device_limit between 1 and 100);
  end if;
end $$;

create index if not exists idx_installations_customer_approval
  on public.installations(customer_id, approval_status);

create index if not exists idx_subscriptions_installation_lifetime
  on public.subscriptions(installation_id, is_lifetime, status);

commit;
