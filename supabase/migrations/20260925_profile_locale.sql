-- The account's chosen UI language.
--
-- WHAT IT IS. The durable record of the language a seller picked in the app
-- (src/i18n/actions.ts setLocale). The request-time source of truth is the
-- ss_locale cookie, not this column: reading a profile on every request would
-- put a database round trip in front of every page, including the public
-- product page. The column exists so the choice follows the seller to a new
-- browser: sign-in copies it into the cookie when the browser has none, and a
-- choice made on this browser before signing in is written back here.
--
-- NULL means "never chosen", and the app falls back to the browser's
-- Accept-Language, then English.
--
-- WHY THE CHECK IS A SHAPE AND NOT A LIST. The supported locales are a list in
-- src/i18n/locales.ts. Repeating that list here would be a second copy to keep
-- in step, and adding a language would then need a migration. The app narrows
-- every value to the TS list before writing and again after reading, so this
-- constraint is only the backstop against a direct or service-role write that
-- skipped it: a lowercase language, optionally with an uppercase region (the
-- app ships pt-PT, because plain pt is Brazilian to every Intl API), or nothing.

alter table public.profiles
  add column locale text;

alter table public.profiles
  add constraint profiles_locale_shape
    check (locale is null or locale ~ '^[a-z]{2}(-[A-Z]{2})?$');

comment on column public.profiles.locale is
  'UI language chosen by the account holder (BCP 47, e.g. cs or pt-PT). NULL = never chosen; the app then follows the browser. Narrowed to the supported list in src/i18n/locales.ts.';
