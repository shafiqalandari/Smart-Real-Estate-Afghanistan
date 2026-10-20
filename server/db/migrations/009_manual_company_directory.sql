-- Smart Pharma - manual company directory support
-- Allows provider admins to add verified company listings without linking a customer device.
-- Safe to run more than once.

begin;

alter table if exists public.company_registration_requests
  alter column installation_id drop not null;

alter table if exists public.company_registration_requests
  add column if not exists first_name text,
  add column if not exists last_name text,
  add column if not exists job_title text,
  add column if not exists employee_count integer,
  add column if not exists registration_source text;

update public.company_registration_requests
set registration_source = 'DYNAMIC'
where registration_source is null or btrim(registration_source) = '';

create index if not exists company_registration_requests_source_idx
  on public.company_registration_requests (registration_source, status, submitted_at desc);

commit;

notify pgrst, 'reload schema';
