# Storefront embed: end-to-end audit

Date: 2026-10-20. Scope: the embed a seller pastes on their own site
(`public/widget.js`, the frame at `/e/[key]/[site]`, now `/e/[key]/[...sites]`, the settings page), checked
for security, navigability and responsiveness. Stripe is not connected, so
checkout is out of scope (the embed only links to the product page).

## How it was tested

- **Browser, two origins.** A real Chromium drove a stand-in seller site
  (`shop.localhost`, served by a small local server) framing the app
  (`localhost:3100`), against the e2e stack with its own database. One shop was
  seeded with HOSTILE content: markup and script in the storefront name, header,
  text block, product title and seller name, a 110-character unbroken product
  title, a stock count to look for, and five background colours.
- **Server probes.** 17 frame addresses (casing, encodings, ports, lookalikes),
  the JSON route, the loader file, POST, and direct visits.
- **Production, read-only.** `curl` against `embed.squareshare.eu` and
  `dashboard.squareshare.eu`.
- **Settings page** at five widths, with axe, and from the keyboard.
- 110 checks in all. After the patches below: **97 pass, 2 "fail" that are
  artefacts of the harness (see the end), 11 informational.**

## Result at a glance

| Area | Checks | Pass | Fail | Info |
|---|---|---|---|---|
| Security | 68 | 58 | 2 (artefact) | 8 |
| Navigability | 18 | 17 | 0 | 1 |
| Responsiveness | 14 | 14 | 0 | 0 |
| Settings page | 9 | 8 | 0 | 1 |

Four real problems were found and fixed. Nothing was found that lets a site
frame a storefront it is not allowed to, runs seller text as markup, or leaks
private data.

## Problems found, and what was done

| # | Area | Problem | Severity | Fix |
|---|---|---|---|---|
| 1 | Navigability | A slot added after the page loaded (a site builder or single-page app draws the page late) never got a frame, because the loader scanned once. | Medium: the embed silently does nothing on those sites | Loader now watches for new slots (one cheap pass per burst of changes, never re-frames a slot). Unit tests. |
| 2 | Responsive | One unbroken word wider than the column (a long business name, a pasted link) pushed the footer past the frame at 320px, and the frame clips, so the text was cut off. Found at 320px and in a 300px column. | Low to medium | `wrap-anywhere` on the shared board surface, as the product page already does. Fixes the hosted storefront page too. Browser test at 320px. |
| 3 | Navigability | The keyboard focus ring on a product tile was the dashboard's grey: about 2.3:1 on a cream background, short of the 3:1 a focus indicator needs. | Medium (accessibility) | The ring now uses the board's own ink, which is chosen to read on the seller's background. Browser test. |
| 4 | Security (dev only) | A port above 65535 (`:99999`) was accepted as a site in development. Production never accepts a port. | Low | Port range check. Unit test. |

## Security: what was verified

**Framing**
- The frame carries `frame-ancestors <the claimed site>` with `base-uri`,
  `form-action` and `object-src` set to `none`, plus `Referrer-Policy:
  no-referrer`, `X-Robots-Tag: noindex`, `nosniff`, and a Permissions-Policy that
  turns off passkeys, camera, microphone, location and payment.
- The dashboard, the product page and everything else still send
  `X-Frame-Options: DENY` with no `frame-ancestors`.
- A page that claims to be the allowed site while being another is served the
  frame and its own browser refuses to draw it (Chromium).
- A direct visit to the frame address is a 404.

**Allowlist (16 variants).** Listed site and its `www.` twin are served.
Subdomain, lookalike (`evil-shop`, `shop.localhost.evil.com`), uppercase,
trailing dot, double-encoded, encoded dot, NUL byte, 300-character host, extra
path and a bad port are all refused. Only a clean host is ever written into a
header.

**Seller text.** Markup and script in the storefront name, header, text block,
product title and seller name appear as literal text and never execute in the
frame or on the host page. The frame title the loader sets is plain text.

**Private data.** The seeded stock count and the seller's id are absent from the
frame's HTML. The JSON route, probed with and without an allowed origin, leaks no
stock, owner id, embed settings or contact email.

**Frame behaviour.** The frame cannot navigate the host, read the host's
cookies or storage (blocked by the sandbox). Every link is a new tab with
`noopener noreferrer`, and none uses a `javascript:` or `data:` address. The
frame sends the host one message with three fields, to one origin; a forged
message from the host itself is ignored.

**Privacy claim.** The frame sets no cookie and writes no local or session
storage. The rate limit engages (around 560 requests an hour from one address,
budget 600).

**Production, read-only.** The deployed Worker substitutes the claimed site into
the header (`frame-ancestors example.com`), writes nothing for hostile
addresses, and answers 522 for every path other than `/widget.js` and `/e/*` on
the embed host (login, dashboard, settings, product pages, the JSON route). So
the embed host cannot be used to reach the app.

## Navigability and responsiveness: what was verified

- Tab order runs through every tile, then Powered by, Privacy and Report. Enter
  on a tile opens its page in a new tab and the seller's page stays put. Each
  link has a name (product and price). The frame has a meaningful title, uses
  `h2` only, and has no landmarks of its own, so it does not duplicate the
  seller's page structure.
- Text contrast passes on five backgrounds, including a mid-grey, a light grey,
  near-black, brand green and a gradient.
- Frame height equals content height at 320, 390, 768, 1024 and 1440px, and in a
  300px column on a wide page. It follows the page when it narrows to 360px and
  returns on widening. No horizontal overflow at any of them. A 110-character
  unbroken product title stays inside its tile.
- A slot far down the page is not framed until it nears the screen. Two slots on
  one page both work. A bad key makes no frame. An empty storefront still
  draws something.
- Settings page: no overflow and no serious accessibility findings at all five
  widths. The switch works from the keyboard (Space saves it, locks Copy, and
  unlocks it again).

## Open items (not patched)

1. **Safari and Firefox are untested.** The frame sends both `X-Frame-Options:
   DENY` and `frame-ancestors`. Chromium applies `frame-ancestors`, as the spec
   says. Other engines should too, but nobody has checked. Test one real site in
   Safari before announcing.
2. **No real storefront is embedded in production yet.** The production checks
   covered headers and routing, not a board rendering. Needs one storefront with
   embedding switched on.
3. **A refused frame still costs about 115 KB** (the app's 404 document, with
   its scripts). A seller who lists the wrong domain makes every visitor to
   their page download it for nothing. It is invisible and harmless but wasteful.
   The console hint tells the seller why. Avoiding it would need a separate tiny
   Worker for the embed host.
4. **A rate-limited visitor sees an empty frame**, the same as a refused one. A
   shared office address could hit the 600 an hour budget; nothing tells the
   seller.
5. **The "Report this storefront" link opens the hosted page**, which is not
   framed, so it works, but it leaves the seller's site.
6. **The frame touches Cloudflare R2** for product photos (signed URLs on
   `*.r2.cloudflarestorage.com`). The privacy text says the visitor's IP goes to
   Squareshare; the policy should name Cloudflare as the processor. For legal
   review.
7. **Browser zoom and OS text scaling were not tested.**
8. **With JavaScript off, nothing shows.** A `noscript` link to the hosted
   storefront would be a cheap fallback if wanted.
9. **The JSON route `/api/embed/[key]` is still public** and has no consumer
   now. It passed every probe, but it is unneeded surface; retire it.
10. **Real site builders (WordPress, Squarespace, Webflow, Wix) are untested.**
    Wix and Google Sites will not work (their custom HTML sits in their own
    frame). **Addressed 2026-10-21**, see below.

## Update 2026-10-21: website builders

**What builders do to pasted code.** Most put it on the page itself (WordPress
Custom HTML, Webflow Code Embed, Squarespace Code block, Shopify Custom
Liquid, Carrd Embed), and the embed already worked there. Two put it in a frame
of their own, on a host of their own, and the browser then checks that host
too:

- **Wix** serves an HTML element from `<site host, dots as dashes>.filesusr.com`,
  sandboxed with `allow-same-origin allow-forms allow-popups allow-scripts
  allow-pointer-lock` (support.wix.com, "Adding an HTML iFrame Element"). No
  `allow-popups-to-escape-sandbox`, so anything it opens stays sandboxed.
- **Google Sites** serves embed code from a per-embed
  `*-atari-embeds.googleusercontent.com` host, one or two frames deep.

**What changed.**

| Change | Why |
|---|---|
| The loader names its own page's host and every page above it (`location.ancestorOrigins`, or the referrer in an older browser that is framed), up to 4. The frame address is `/e/<key>/<site>/<site>...` | `frame-ancestors` must list every page above the frame |
| next.config.ts writes one header rule per number of sites (1 to 4), each `frame-ancestors :s1 :s2 ...` | The production matcher cannot fill in an optional param; the test now loads the real rules and runs them through both matchers |
| The server accepts a list only if every host is a listed site (or its www twin) or a builder frame for one, and at least one is listed. Wix's frame host is derived from the seller's own domain; any Google atari host is accepted | A page cannot name its way onto someone else's storefront: the top page is always in the list, and it must be the seller's |
| `allow-forms` added to the frame's sandbox | Inside Wix, the product page opens with what both sandboxes allow; without it the buy form could not submit. The frame itself has no form and is served `form-action 'none'` |
| The frame reports its height to `"*"` | It cannot know which of several allowed sites holds it; only an allowed page can, and the message is a height and a public title |
| A plain-iframe snippet ("Iframe only" tab), fixed at 640px and scrolling inside | For builders that strip scripts, or load pages without running them (Squarespace's Ajax loading) |
| A "Your site builder" picker with one paste instruction for each of WordPress, Squarespace, Wix, Webflow, Shopify, Google Sites, Framer, Carrd, or another site. The "not showing" tip now says code shows on the published site, and to list a preview address (`yoursite.webflow.io`) to see it there | Sellers stuck in a builder's editor see nothing and blame the embed |

**Accepted risk.** Anyone can make a Google Site, so anyone can open their own
atari-embeds page directly and show a seller's board on it. They gain nothing a
visitor to the seller's site does not see (the board is public, a click opens
the product page in a new tab), and they cannot put it on a site of their own.

**Tested.** Unit: header rules for 1 to 4 sites in both matchers, hostile
segments in every position, too many sites; the allowlist for Wix, Google and
look-alikes; the loader's ancestor list (dedupe, opaque "null" ancestors,
referrer ignored at the top, too deep). Browser (spec 97, with the builders'
hostnames resolved to this machine): Wix's sandboxed frame, including a product
tab that stays sandboxed but can still submit a form; Google's two frames; a
srcdoc frame; the plain iframe at its pasted height; another site wearing the
seller's Wix frame (refused); a Wix frame lying about the page above it
(refused by the browser); builder frames with no listed site (refused).

**Still not verified.** Real Wix, Google Sites, Framer and GoDaddy pages (the
wrapper hosts come from vendor documentation and third-party reports, not from
a site of ours). Framer's HTML embed: if it is a sandboxed srcdoc frame without
`allow-same-origin`, its origin is opaque and no `frame-ancestors` can match
it; pasting the frame's address (the src of the iframe snippet) into Framer's URL mode is the way round. GoDaddy's HTML
section is not handled.

## The two "failing" checks

`refusals-uniform-status` and `refusals-body-size` failed only in the combined
run. The embed spec's key-rotation test sets one storefront's key to a fixed
value, and the audit's "wrong key" probe used the same value, so it hit a real
storefront. In the separate first run both refusals were 404 with bodies within
27 bytes of each other. Not a defect.
