import { cookies } from "next/headers";
import {
  AUTH_COOKIE_DOMAIN,
  AUTH_COOKIE_SECURE,
} from "@/lib/supabase/cookie-options";
import { parseLocale, type Locale } from "./locales";

/**
 * The browser's chosen UI language. Set ONLY by an explicit choice (the
 * language switcher, or sign-in copying the account's saved choice onto a new
 * browser). Accept-Language never writes it, so "no cookie" keeps meaning
 * "this browser has not chosen", which sign-in relies on.
 *
 * HttpOnly although nothing in it is secret: the request config reads it
 * server-side, no client code needs it, and this app hands `document.cookie`
 * nothing it does not need. Parent-domain scoped like the auth cookies, so the
 * choice carries to the marketplace subdomains.
 *
 * Server-only (reads `next/headers`). Do not import from Client Components.
 */
export const LOCALE_COOKIE = {
  name: "ss_locale",
  options: {
    domain: AUTH_COOKIE_DOMAIN,
    path: "/",
    sameSite: "lax",
    secure: AUTH_COOKIE_SECURE,
    httpOnly: true,
    // A year: a language choice is not something anyone expects to redo.
    maxAge: 60 * 60 * 24 * 365,
  },
} as const;

/** This browser's chosen locale, or null when it has not chosen one. */
export async function readLocaleCookie(): Promise<Locale | null> {
  return parseLocale(await readLocaleCookieValue());
}

/** The raw, UNVALIDATED cookie value, for callers that narrow it themselves. */
export async function readLocaleCookieValue(): Promise<string | undefined> {
  const store = await cookies();
  return store.get(LOCALE_COOKIE.name)?.value;
}

/** Record this browser's choice. Callable from Server Actions only. */
export async function writeLocaleCookie(locale: Locale): Promise<void> {
  const store = await cookies();
  store.set(LOCALE_COOKIE.name, locale, LOCALE_COOKIE.options);
}
