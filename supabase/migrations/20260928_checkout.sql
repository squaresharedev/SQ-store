-- Checkout: what an order needs once buyers pay on Square Share itself.
--
-- WHY. Until now an order could only be written by the dev sale simulator, and
-- every row carried a channel of 'embed' or 'marketplace'. Hosted checkout is a
-- third place a sale can come from, and the order it writes owes the buyer
-- three things the row could not hold: the gift message they typed, a record
-- of the withdrawal they asked for, and the file they paid to download.
--
-- COLUMNS
--   channel                  Gains 'direct': a sale made on the seller's hosted
--                            pages (product page, then checkout). The same word
--                            storefront_signals already uses for those pages.
--   gift_message             What the buyer asked the seller to put in the
--                            parcel. Plain text, at most 200 characters,
--                            physical orders only (the writer drops it for a
--                            download). Null when none was written.
--   withdrawal_requested_at  When the buyer used the withdrawal function on the
--                            order page (Consumer Rights Directive art. 11a).
--                            A timestamp rather than a status: the contract is
--                            between buyer and seller, and what the seller does
--                            next (refund, collect the parcel) is theirs to
--                            record. Set once; asking again changes nothing.
--   supply_consent_at        When a buyer of a download agreed, at checkout, to
--                            receive it straight away and so lose the right of
--                            withdrawal (CRD art. 16(m)). The evidence for why
--                            no withdrawal function is offered on that order.
--   digital_file_key         The file this order paid for, SNAPSHOTTED. A
--                            product's file can be replaced or the product
--                            deleted (orders.product_id is ON DELETE SET NULL);
--                            the buyer's download must survive both, so the
--                            order keeps its own key and product writes stop
--                            evicting a file an order still points at.
--
-- SIGNALS. 'checkout_view': a view of the hosted checkout, recorded by the page
-- itself the way 'product_view' is. THIS LIST IS MIRRORED in
-- src/lib/analytics/signals.ts; edit both together.
--
-- WRITES. Unchanged: orders are written by the service role through the one
-- order writer (src/lib/orders/record.ts), and the withdrawal timestamp by the
-- service-role withdrawal route. No policy, grant or function is added.
--
-- Apply via the Management API query endpoint or the SQL editor.

-- ---- 1. Channel ----------------------------------------------------------------

alter table public.orders
  drop constraint if exists orders_channel_check;
alter table public.orders
  add constraint orders_channel_check
    check (channel in ('embed', 'marketplace', 'direct'));

-- ---- 2. Columns ----------------------------------------------------------------

alter table public.orders
  add column if not exists gift_message text,
  add column if not exists withdrawal_requested_at timestamptz,
  add column if not exists supply_consent_at timestamptz,
  add column if not exists digital_file_key text;

alter table public.orders
  add constraint orders_gift_message_length
    check (gift_message is null or char_length(gift_message) between 1 and 200),
  -- The same prefix and owner-scoped shape every uploaded download has; a key
  -- is copied from the product row by the writer, never accepted from a buyer.
  add constraint orders_digital_file_key_shape
    check (digital_file_key is null or (digital_file_key ~ '^files/' and char_length(digital_file_key) <= 512));

-- Product writes ask "does any order still need this file?" before evicting it.
create index if not exists orders_digital_file_key_idx
  on public.orders (digital_file_key)
  where digital_file_key is not null;

comment on column public.orders.gift_message is
  'The buyer''s gift message for the parcel, plain text, 1..200 characters. Physical orders only.';
comment on column public.orders.withdrawal_requested_at is
  'When the buyer used the withdrawal function on their order page (CRD art. 11a). Set once.';
comment on column public.orders.supply_consent_at is
  'When a download buyer consented at checkout to immediate supply and the loss of the withdrawal right (CRD art. 16(m)).';
comment on column public.orders.digital_file_key is
  'R2 key of the file this order paid for, snapshotted from the product at sale time. Never shown; the order page hands out short-lived signed links.';

-- ---- 3. Signal kind ------------------------------------------------------------

alter table public.storefront_signals
  drop constraint storefront_signals_kind_check;
alter table public.storefront_signals
  add constraint storefront_signals_kind_check
    check (kind in ('storefront_view','product_click','email_signup','booking','product_view','checkout_view'));
