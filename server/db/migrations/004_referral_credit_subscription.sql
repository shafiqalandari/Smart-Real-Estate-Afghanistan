-- SafarPro referral, non-cash credit and subscription enhancements.
-- Safe to run repeatedly. Credit is AFN-denominated, non-withdrawable, no-expiry.
create extension if not exists pgcrypto;

alter table public.service_customers add column if not exists smart_office_id text;
update public.service_customers
set smart_office_id = 'SP-' || upper(substr(replace(id::text, '-', ''), 1, 8))
where smart_office_id is null or btrim(smart_office_id) = '';
create unique index if not exists service_customers_smart_office_id_uq
  on public.service_customers (upper(smart_office_id)) where smart_office_id is not null;

alter table public.subscription_plans add column if not exists referral_reward_afn numeric(14,2) not null default 0;
alter table public.subscription_plans drop constraint if exists subscription_plans_referral_reward_nonnegative;
alter table public.subscription_plans add constraint subscription_plans_referral_reward_nonnegative check (referral_reward_afn >= 0);

alter table public.payment_requests add column if not exists requested_credit_afn numeric(14,2) not null default 0;
alter table public.payment_requests add column if not exists credit_applied_afn numeric(14,2) not null default 0;
alter table public.payment_requests drop constraint if exists payment_requests_requested_credit_nonnegative;
alter table public.payment_requests add constraint payment_requests_requested_credit_nonnegative check (requested_credit_afn >= 0);
alter table public.payment_requests drop constraint if exists payment_requests_credit_applied_nonnegative;
alter table public.payment_requests add constraint payment_requests_credit_applied_nonnegative check (credit_applied_afn >= 0);

create table if not exists public.referral_relationships (
  id uuid primary key default gen_random_uuid(),
  referrer_customer_id uuid not null references public.service_customers(id) on delete cascade,
  referred_customer_id uuid not null references public.service_customers(id) on delete cascade,
  referral_code text not null,
  registered_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint referral_relationships_no_self_referral check (referrer_customer_id <> referred_customer_id),
  constraint referral_relationships_one_referrer_uq unique (referred_customer_id)
);
create index if not exists referral_relationships_referrer_idx on public.referral_relationships(referrer_customer_id, created_at desc);

create table if not exists public.credit_accounts (
  customer_id uuid primary key references public.service_customers(id) on delete cascade,
  balance numeric(14,2) not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now()
);
insert into public.credit_accounts(customer_id,balance)
select id,0 from public.service_customers
on conflict(customer_id) do nothing;

create table if not exists public.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null default gen_random_uuid(),
  customer_id uuid not null references public.service_customers(id) on delete cascade,
  entry_type text not null,
  direction text not null check (direction in ('credit','debit')),
  amount numeric(14,2) not null check (amount > 0),
  balance_after numeric(14,2) not null check (balance_after >= 0),
  related_customer_id uuid references public.service_customers(id) on delete set null,
  related_plan_id uuid references public.subscription_plans(id) on delete set null,
  related_subscription_id uuid references public.subscriptions(id) on delete set null,
  related_payment_request_id uuid references public.payment_requests(id) on delete set null,
  idempotency_key text,
  note text,
  actor_admin_id text,
  created_at timestamptz not null default now()
);
create unique index if not exists credit_ledger_idempotency_uq on public.credit_ledger(idempotency_key) where idempotency_key is not null;
create index if not exists credit_ledger_customer_idx on public.credit_ledger(customer_id, created_at desc);

create table if not exists public.credit_transfers (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null unique,
  sender_customer_id uuid not null references public.service_customers(id) on delete cascade,
  recipient_customer_id uuid not null references public.service_customers(id) on delete cascade,
  amount numeric(14,2) not null check (amount > 0),
  sender_ledger_id uuid references public.credit_ledger(id) on delete set null,
  recipient_ledger_id uuid references public.credit_ledger(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint credit_transfers_no_self_transfer check (sender_customer_id <> recipient_customer_id)
);
create index if not exists credit_transfers_sender_idx on public.credit_transfers(sender_customer_id, created_at desc);
create index if not exists credit_transfers_recipient_idx on public.credit_transfers(recipient_customer_id, created_at desc);

alter table public.referral_relationships enable row level security;
alter table public.credit_accounts enable row level security;
alter table public.credit_ledger enable row level security;
alter table public.credit_transfers enable row level security;

notify pgrst, 'reload schema';
