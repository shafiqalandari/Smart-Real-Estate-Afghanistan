-- SafarPro legacy database compatibility repair
-- Safe to run repeatedly.

begin;

-- Older SafarPro databases may have the original subscriptions table
-- without the Stage 5 plan/payment columns used by the current API.
alter table if exists public.subscriptions
  add column if not exists plan_id uuid,
  add column if not exists payment_request_id uuid,
  add column if not exists payment_method_id uuid,
  add column if not exists amount numeric(14,2),
  add column if not exists currency text,
  add column if not exists is_lifetime boolean not null default false;

-- Lifetime subscriptions do not have an expiry date.
alter table if exists public.subscriptions
  alter column expires_at drop not null;

-- Add foreign keys only when the referenced tables exist and the constraints are absent.
do $$
begin
  if to_regclass('public.subscription_plans') is not null and not exists (
    select 1 from pg_constraint where conname = 'subscriptions_plan_id_fkey'
  ) then
    alter table public.subscriptions
      add constraint subscriptions_plan_id_fkey
      foreign key (plan_id) references public.subscription_plans(id) on delete set null;
  end if;

  if to_regclass('public.payment_requests') is not null and not exists (
    select 1 from pg_constraint where conname = 'subscriptions_payment_request_id_fkey'
  ) then
    alter table public.subscriptions
      add constraint subscriptions_payment_request_id_fkey
      foreign key (payment_request_id) references public.payment_requests(id) on delete set null;
  end if;

  if to_regclass('public.payment_methods') is not null and not exists (
    select 1 from pg_constraint where conname = 'subscriptions_payment_method_id_fkey'
  ) then
    alter table public.subscriptions
      add constraint subscriptions_payment_method_id_fkey
      foreign key (payment_method_id) references public.payment_methods(id) on delete set null;
  end if;
end $$;

create index if not exists idx_subscriptions_installation_status
  on public.subscriptions(installation_id, status, created_at desc);

create index if not exists idx_subscriptions_plan
  on public.subscriptions(plan_id);

create index if not exists idx_subscriptions_lifetime_status
  on public.subscriptions(installation_id, is_lifetime, status, created_at desc);

commit;
