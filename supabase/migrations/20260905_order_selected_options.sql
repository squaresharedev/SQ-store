-- What version the buyer bought, on the order.
--
-- WHY. Products are sold in versions (option_groups: a size, a colour, a power
-- output), and an order recorded none of it. A seller looking at "Oak dining
-- table, 899.00, alex@example.com" had no way to know whether to pack the four
-- seater or the six, which is the one fact fulfilment cannot proceed without.
--
--   selected_options: [{ "label": "Size", "value": "Six seater" }, ...]
--
-- WORDS, NOT IDS, and this is the load-bearing decision. The orders table
-- already snapshots product_title and product_price_cents so a later edit or
-- delete cannot rewrite history (see 20260706081743). An option id would break
-- exactly that: rename "Six seater" and every past order quietly means
-- something else; delete it and they mean nothing at all. What goes in the box
-- is the words, so the words are what is stored.
--
-- LABEL/VALUE, not a column per axis, because the axes are the seller's own
-- (this is the same reason option_groups is data rather than a `colour`
-- column). The shape also already fits what a buyer types rather than picks (an
-- engraving, a gift note) whenever that ships, with no second migration and no
-- new shape for readers to learn.
--
-- Written server-side only, like every other column here: there is no public
-- insert policy on orders, and the reader (lib/orders/selection.ts) trims,
-- caps and truncates whatever it finds rather than trusting the blob.
--
-- The demo simulator (20260801_demo_sales_sim) is left alone: it is disabled by
-- default and scoped to one demo seller, so its orders simply carry the empty
-- default until someone wants versioned demo data.

alter table public.orders
  add column selected_options jsonb not null default '[]'::jsonb;

alter table public.orders
  add constraint orders_selected_options_is_array
    check (jsonb_typeof(selected_options) = 'array'),
  -- 2 KB holds the reader's worst case (8 entries at a 40-char label and a
  -- 120-char value) several times over. Orders are the highest-volume table in
  -- the product, so this column is deliberately the tightest of the jsonb caps.
  add constraint orders_selected_options_size
    check (pg_column_size(selected_options) <= 2048);

comment on column public.orders.selected_options is
  'What the buyer picked, snapshotted as [{label, value}] in the seller''s own words ("Size": "Six seater") - never option ids, so renaming or deleting an option cannot rewrite what a past order says was sold. Empty for a product sold in one version.';
