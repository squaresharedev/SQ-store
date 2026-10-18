-- Seller payment accounts: the seller's own connected Stripe account.
--
-- WHY. Buyers pay SELLERS, not Square Share: a sale is a charge on the
-- seller's own Stripe account (Stripe Connect, a direct charge), with our cut
-- taken as an application fee. That is what keeps the seller the merchant of
-- record. Nothing recorded which Stripe account belongs to which seller, so no
-- charge could be made and no event from Stripe could be matched to a store.
--
-- WHAT THIS ADDS. One table, seller_payment_accounts: one row per seller who
-- has started connecting, with the account's id and the three facts Stripe
-- reports about it. `charges_enabled` is the one checkout reads: until it is
-- true, the seller's products have no Pay button.
--
-- NOT TO BE CONFUSED WITH seller_billing (20260930_seller_plans), which is the
-- seller as OUR customer (the plan they pay us for) on the platform account.
-- This is the seller as a merchant, on their own.
--
-- TRUST. The account id is what an incoming Stripe event is matched against
-- (event.account), so it decides whose order a payment confirms. It is written
-- ONLY by this server, from Stripe's own answer when the account is created
-- (src/lib/payments/connect/account.ts): service role only, RLS on with no
-- policies, no grant to the API roles. A seller never reads the row directly;
-- the Payments page reads it for them on the server.
--
-- Deleted with the account (on delete cascade). The Stripe account itself
-- lives on, as Stripe's record of the seller's past payments.
--
-- DEPLOY ORDER: this migration first, then the app. Additive; the released
-- app does not know the table exists.
--
-- Apply via the Management API query endpoint or the SQL editor.

create table if not exists public.seller_payment_accounts (
  owner_id           uuid primary key references public.profiles (id) on delete cascade,
  stripe_account_id  text not null unique,
  -- Stripe's own three answers about the account, refreshed from Stripe (the
  -- account.updated event, and whenever the seller returns from onboarding).
  charges_enabled    boolean not null default false,
  payouts_enabled    boolean not null default false,
  details_submitted  boolean not null default false,
  -- Whether it is a live-mode account. A live deployment never charges a
  -- test-mode account, and the other way round.
  livemode           boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint seller_payment_accounts_id_shape
    check (stripe_account_id ~ '^acct_[A-Za-z0-9]{6,250}$')
);

comment on table public.seller_payment_accounts is
  'A seller''s connected Stripe account (Stripe Connect) and what Stripe says it may do. Written by the server from Stripe''s answers; matched against event.account by the payments webhook. Service role only.';
comment on column public.seller_payment_accounts.charges_enabled is
  'Stripe will take payments on this account. Checkout is offered for the seller''s products only while this is true.';

drop trigger if exists seller_payment_accounts_set_updated_at on public.seller_payment_accounts;
create trigger seller_payment_accounts_set_updated_at
  before update on public.seller_payment_accounts
  for each row execute function public.set_updated_at();

alter table public.seller_payment_accounts enable row level security;
revoke all on table public.seller_payment_accounts from public, anon, authenticated;
grant all on table public.seller_payment_accounts to service_role;

-- A refund or a dispute arrives naming the PAYMENT, not our order.
create index if not exists orders_payment_ref_idx
  on public.orders (payment_ref)
  where payment_ref is not null;

-- Restated: while an order waits to be paid, the column holds the id of the
-- provider's payment PAGE instead, which is what a cancelled checkout closes.
comment on column public.orders.payment_ref is
  'The payment provider''s id for the payment (a Stripe PaymentIntent id, pi_...), which is what a refund names. While the order is still pending: the id of the provider''s checkout session (cs_...). Null for orders no provider charged.';

notify pgrst, 'reload schema';
