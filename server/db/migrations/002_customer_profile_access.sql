-- Customer onboarding/profile fields and suspended access state.
alter table public.service_customers add column if not exists whatsapp text;
alter table public.service_customers add column if not exists address text;
alter table public.service_customers add column if not exists business_type text;
alter table public.service_customers add column if not exists license_number text;

alter table public.installations drop constraint if exists installations_status_check;
alter table public.installations
  add constraint installations_status_check
  check (status in ('ACTIVE','BLOCKED','SUSPENDED'));
