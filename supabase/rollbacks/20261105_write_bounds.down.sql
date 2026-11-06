-- Undo 20261105_write_bounds. That reopens docs/security-audit-2026-11.md
-- 1.10 and 1.11 (unbounded direct writes, anonymous inserts without a cap,
-- avatar_url as free text).

drop trigger if exists profiles_guard_avatar_url on public.profiles;
drop function if exists public.guard_avatar_url();

drop trigger if exists consent_logs_insert_rate on public.consent_logs;
drop trigger if exists waitlist_signups_insert_rate on public.waitlist_signups;
drop function if exists public.guard_anonymous_insert_rate();
drop index if exists public.consent_logs_received_at_idx;
drop index if exists public.waitlist_signups_created_at_idx;

drop trigger if exists products_account_ceiling on public.products;
drop trigger if exists storefronts_account_ceiling on public.storefronts;
drop function if exists public.guard_account_ceiling();

alter table public.rate_limits drop constraint if exists rate_limits_action_length;
alter table public.profiles drop constraint if exists profiles_avatar_url_length;
alter table public.storefronts drop constraint if exists storefronts_brief_size;
alter table public.storefronts drop constraint if exists storefronts_config_size;
alter table public.products drop constraint if exists products_description_length;
alter table public.products drop constraint if exists products_title_length;

notify pgrst, 'reload schema';
