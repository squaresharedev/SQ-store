-- =============================================================================
-- DATABASE HYGIENE from the 2026-08-07 security review.
--
-- Four unrelated small things, each fail-closed and none changing an existing
-- application code path. Grouped because they arrived from one audit; they can
-- be applied independently if any one of them gives trouble.
-- =============================================================================

-- ---- 1. RLS on demo.sales_sim -------------------------------------------------
-- The one table in the database without row level security.
--
-- It is already unreachable: `demo` is not in Supabase's exposed schema list,
-- so PostgREST will not serve it, and every privilege is revoked from anon and
-- authenticated. Enabling RLS changes nothing today. It is worth doing anyway
-- because the current safety rests on a PROJECT SETTING (which schemas are
-- exposed) rather than on the table, and "every table in this database has RLS"
-- is a property worth being able to assert without an asterisk — the RLS
-- coverage test in tests/integration asserts exactly that.
--
-- No policy is added: service_role bypasses RLS, and service_role is the only
-- thing that should ever read this. RLS with no policy is deny-all.
alter table demo.sales_sim enable row level security;

comment on table demo.sales_sim is
  'Demo sales simulator config. RLS enabled with NO policies (deny-all); reached only by service_role and the pg_cron job. Not exposed via PostgREST.';

-- ---- 2. Bound the anonymous waitlist insert -----------------------------------
-- `waitlist_signups` carries `for insert to anon, authenticated with check
-- (true)` — the only unbounded anonymous write in the database. It is reachable
-- directly through PostgREST with the publishable anon key, which ships in
-- every browser bundle.
--
-- NOT DROPPED, deliberately: the marketing site (squareshare.eu) inserts here
-- from the browser, so removing the policy would break the live waitlist form.
-- What the form actually sends is an email and a source; it never sets owner_id
-- or list_id. Pinning those to null closes the mass-assignment shape without
-- touching the working path, and the length bound stops a single request from
-- writing an unbounded string.
--
-- This is not a rate limit. Volume has to be bounded at the edge (a Cloudflare
-- rate-limit rule on the marketing origin) because RLS cannot count requests
-- and rl_take_key is service_role-only by design.
drop policy if exists "public can join waitlist" on public.waitlist_signups;

create policy "public can join waitlist"
  on public.waitlist_signups
  for insert
  to anon, authenticated
  with check (
    owner_id is null
    and list_id is null
    and char_length(email) <= 254
    and char_length(coalesce(source, '')) <= 64
  );

-- ---- 3. Schedule the rate-limit key GC ----------------------------------------
-- rl_gc_keys() has existed since the sliding-window limiter landed and has
-- never been scheduled, so rate_limit_keys grows forever: one row per distinct
-- (hashed key, action) pair, and the anonymous surfaces key on IP.
--
-- pg_cron is already installed and already running demo-sales-sim, so this adds
-- no new infrastructure. Hourly is far more often than needed to keep a table
-- whose rows expire after a day from growing without bound, and the function is
-- a single indexed delete.
select cron.unschedule('rate-limit-gc')
  where exists (select 1 from cron.job where jobname = 'rate-limit-gc');

select cron.schedule('rate-limit-gc', '17 * * * *', $cron$select public.rl_gc_keys()$cron$);

-- ---- 4. public_profiles stays SECURITY DEFINER --------------------------------
-- Supabase's database linter flags this view at ERROR level
-- (0010_security_definer_view) and the obvious remedy is to switch it to
-- security_invoker. DO NOT. It was checked and the lint is wrong for this view.
--
-- security_invoker would make the view run as the caller, and `profiles` has no
-- anon select policy, so the view would return nothing to the anonymous readers
-- it exists to serve. Making it work again would mean adding a public select
-- policy on `profiles` itself — and that table holds tax_vat_id,
-- tax_business_name, tax_country and deletion_requested_at. The "fix" would
-- expose a creator's VAT number to the internet in order to satisfy a linter.
--
-- The view as it stands selects exactly three columns (id, username,
-- avatar_url), filters to `is_public = true and username is not null`, and is
-- granted SELECT only. That is a narrower, safer interface than any table-level
-- policy could express, which is precisely what a definer view is for.
comment on view public.public_profiles is
  'Opt-in public directory: id, username, avatar_url for is_public profiles. SECURITY DEFINER ON PURPOSE — profiles holds tax data and must never carry an anon select policy, so this view is the only public surface. Supabase lint 0010 is a known, accepted false positive here.';
