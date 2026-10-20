-- SafarPro production hardening
-- Safe to run more than once.

create extension if not exists pgcrypto;

-- Customer-level entitlement anchor: one company/customer gets one initial trial window.
alter table public.service_customers add column if not exists trial_started_at timestamptz;
alter table public.service_customers add column if not exists trial_ends_at timestamptz;
alter table public.service_customers add column if not exists updated_at timestamptz not null default now();
alter table public.service_customers add column if not exists account_status text not null default 'ACTIVE';
alter table public.service_customers drop constraint if exists service_customers_account_status_check;
alter table public.service_customers add constraint service_customers_account_status_check check (account_status in ('ACTIVE','BLOCKED','SUSPENDED'));
create index if not exists service_customers_email_lower_idx on public.service_customers (lower(email));

-- Backfill customer trial from the earliest installation so existing customers keep their original entitlement.
update public.service_customers c
set trial_started_at = coalesce(c.trial_started_at, x.trial_started_at),
    trial_ends_at = coalesce(c.trial_ends_at, x.trial_ends_at),
    updated_at = now()
from (
  select customer_id, min(trial_started_at) as trial_started_at, min(trial_ends_at) as trial_ends_at
  from public.installations
  group by customer_id
) x
where x.customer_id = c.id
  and (c.trial_started_at is null or c.trial_ends_at is null);

-- Device approval is intentionally separate from account/customer identity.
-- Existing devices remain approved; only newly-linked secondary devices start pending.
alter table public.installations add column if not exists approval_status text not null default 'APPROVED';
alter table public.installations drop constraint if exists installations_approval_status_check;
alter table public.installations add constraint installations_approval_status_check
  check (approval_status in ('APPROVED','PENDING','REJECTED'));

-- Ensure status supports the production states used by the API.
alter table public.installations drop constraint if exists installations_status_check;
alter table public.installations add constraint installations_status_check
  check (status in ('ACTIVE','BLOCKED','SUSPENDED','PENDING'));

create index if not exists installations_customer_approval_idx
  on public.installations(customer_id, approval_status, created_at desc);

-- Per-plan device allowance. Trial/default allowance is one approved device.
alter table public.subscription_plans add column if not exists device_limit integer not null default 1;
alter table public.subscription_plans drop constraint if exists subscription_plans_device_limit_check;
alter table public.subscription_plans add constraint subscription_plans_device_limit_check check (device_limit between 1 and 100);

-- Provider support attachments (older VPS schemas may not yet have these columns).
alter table public.provider_messages add column if not exists attachment_path text;
alter table public.provider_messages add column if not exists attachment_name text;
alter table public.provider_messages add column if not exists attachment_type text;
alter table public.provider_messages add column if not exists attachment_size bigint;

-- First-run company registration is created automatically from the customer profile.
-- Keep one request per installation for backward compatibility while allowing linkage to the customer identity.
alter table public.company_registration_requests add column if not exists service_customer_id uuid references public.service_customers(id) on delete set null;
alter table public.company_registration_requests add column if not exists country text;
alter table public.company_registration_requests add column if not exists city text;
alter table public.company_registration_requests add column if not exists address text;
alter table public.company_registration_requests add column if not exists business_type text;
create index if not exists company_registration_requests_customer_idx
  on public.company_registration_requests(service_customer_id, submitted_at desc);

update public.company_registration_requests r
set service_customer_id = i.customer_id
from public.installations i
where r.installation_id = i.id
  and r.service_customer_id is null;

notify pgrst, 'reload schema';
