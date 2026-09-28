import { getLocale, getTranslations } from "next-intl/server";
import {
  BRAND_INK,
  BRAND_MARK,
  BRAND_SURFACE,
  BRAND_TITLE_TEMPLATE,
} from "@/lib/brand";
import { escapeHtml } from "@/lib/format/html";

/**
 * GET /offline: the page the service worker (public/sw.js) shows instead of
 * the browser's own error screen when a page can't load because the device is
 * offline.
 *
 * SELF-CONTAINED ON PURPOSE. The worker fetches it once, keeps it, and replays
 * it later with no network at all, so it cannot lean on anything that would
 * need a second request: no stylesheet, no fonts, no /_next scripts. That is
 * why this is a route handler writing one document rather than a page (a
 * page's markup points at hashed CSS and JS chunks that would all fail
 * offline), and why it mirrors the palette by hand, like app/global-error.tsx.
 * Light only, like the dashboard it stands in for.
 *
 * "Try again" is a link to the empty URL: the worker serves this document in
 * place of the page that failed, so the empty URL IS that page. The one line
 * of script retries by itself the moment the connection comes back.
 *
 * In the request's language, and Content-Language says which, so the worker
 * can tell when the seller has since switched and fetch a fresh copy.
 */
export async function GET() {
  const locale = await getLocale();
  const t = await getTranslations("Dashboard.offline");
  const title = escapeHtml(t("title"));

  const html = `<!doctype html>
<html lang="${escapeHtml(locale)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="theme-color" content="${BRAND_SURFACE}">
<title>${BRAND_TITLE_TEMPLATE.replace("%s", title)}</title>
<style>
:root {
  color-scheme: light;
  --surface: ${BRAND_SURFACE}; /* --background */
  --ink: ${BRAND_INK}; /* --foreground */
  --muted: #737373; /* --muted-foreground */
  --cta-ink: #fafafa; /* --primary-foreground */
}
body {
  margin: 0;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 2.5rem 1.5rem;
  box-sizing: border-box;
  text-align: center;
  background: var(--surface);
  color: var(--ink);
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
}
svg { width: 3rem; height: auto; fill: var(--ink); }
h1 { margin: 1.5rem 0 0; font-size: 1.25rem; font-weight: 600; letter-spacing: -0.01em; }
p { margin: 0.75rem 0 0; max-width: 24rem; font-size: 0.875rem; line-height: 1.6; color: var(--muted); }
a {
  margin-top: 2rem;
  background: var(--ink);
  color: var(--cta-ink);
  padding: 0.625rem 1rem;
  font-size: 0.875rem;
  font-weight: 500;
  text-decoration: none;
}
</style>
</head>
<body>
<svg viewBox="0 0 ${BRAND_MARK.width} ${BRAND_MARK.height}" aria-hidden="true"><path d="${BRAND_MARK.path}"/></svg>
<h1>${title}</h1>
<p>${escapeHtml(t("description"))}</p>
<a href="">${escapeHtml(t("retry"))}</a>
<script>addEventListener("online", () => location.reload());</script>
</body>
</html>`;

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Language": locale,
      // Varies with the language cookie; the worker keeps its own copy anyway.
      "Cache-Control": "no-store",
    },
  });
}
