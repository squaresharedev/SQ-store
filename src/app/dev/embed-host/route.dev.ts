import { embedOrigin } from "@/lib/app-url";
import { escapeHtml } from "@/lib/format/html";
import { embedFramePath, parseEmbedSites } from "@/lib/storefront/embed-frame";
import { embedFrameSnippet, embedSnippet } from "@/lib/storefront/embed-snippet";
import { uuidField } from "@/lib/validation/inputs";

/**
 * GET /dev/embed-host?key=<embed key>: a stand-in for A SELLER'S OWN WEBSITE,
 * with the real snippet pasted into it.
 *
 * The embed only means anything across two origins, and a second server is a
 * lot of machinery for that. This is one bare page, so the SAME dev server can
 * play both parts: open it on another name for the same machine, for example
 *
 *   http://shop.localhost:3000/dev/embed-host?key=<embed key>
 *
 * and the page is one origin (shop.localhost) while the loader and the frame
 * it asks for are another (localhost). Browsers resolve every *.localhost name
 * to this machine. List `shop.localhost` in the storefront's allowed domains
 * and the storefront appears; open the page as `other.localhost` and it does
 * not. tests/e2e/89-embed-frame.spec.ts drives exactly that.
 *
 * `?claim=<site>,<site>` swaps the snippet for a hand-written frame that NAMES
 * those sites while the page stays where it is: a page pretending to be one
 * the seller allowed. The server serves it; the browser must refuse to draw it.
 *
 * `?iframe=1` pastes the plain-iframe snippet instead of the loader, naming
 * this page's own host.
 *
 * `?wrap=` puts the pasted code one or two frames down, the way a SITE
 * BUILDER does, on the builder's own host (the same page again, asked for
 * without `wrap`):
 *   - `wix`: one sandboxed frame on `<this host, dashed>.filesusr.com`, with
 *     Wix's sandbox; `&for=<host>` makes it another site's Wix frame.
 *   - `google`: two frames on a `*-atari-embeds.googleusercontent.com` host.
 *   - `srcdoc`: one srcdoc frame, which has no host of its own.
 * Builder hosts are real names on the internet: a test browser must be told to
 * resolve them to this machine (tests/e2e/97-embed-builders.spec.ts does).
 *
 * A route handler writing one document rather than a page, like /offline: a
 * seller's site has none of this app's markup, styles or scripts around the
 * snippet, and the stand-in should not either. Development only, and nothing
 * from the address is written out without being checked and escaped.
 */

/** The sandbox Wix puts its HTML element in (support.wix.com, "Adding an
 *  HTML iFrame Element"): no allow-popups-to-escape-sandbox. */
const WIX_SANDBOX = "allow-same-origin allow-forms allow-popups allow-scripts allow-pointer-lock";
/** A stand-in for Google Sites' per-embed host. */
const GOOGLE_FRAME_HOST = "0a1b2c3d-atari-embeds.googleusercontent.com";

const HOST_SHAPE = /^[a-z0-9.-]+$/;

export async function GET(request: Request) {
  if (process.env.NODE_ENV !== "development") return new Response("Not found.", { status: 404 });

  const url = new URL(request.url);
  const params = url.searchParams;
  const key = params.get("key") ?? "";
  if (!uuidField().safeParse(key).success) {
    return new Response("Pass ?key=<a storefront's embed key>.", { status: 400 });
  }
  const origin = embedOrigin();
  if (!origin) return new Response("No embed origin.", { status: 400 });
  // The page's own host as the browser asked for it, port included: the
  // router's own idea of the URL may not carry the name it was asked by.
  const here = request.headers.get("host") ?? url.host;
  const page = new URL(`${url.protocol}//${here}`);

  let embed = embedSnippet(key);
  const claim = params.get("claim");
  if (claim !== null) {
    const sites = parseEmbedSites(claim.split(","), { allowPort: true });
    if (!sites) return new Response("Bad ?claim.", { status: 400 });
    embed = `<iframe data-claimed-frame title="Shop" style="display:block;width:100%;height:400px;border:0" src="${escapeHtml(origin + embedFramePath(key, sites.map((site) => site.site)))}"></iframe>`;
  } else if (params.get("iframe") === "1") {
    embed = embedFrameSnippet(key, [here]);
  }

  const wrap = params.get("wrap");
  if (wrap !== null) {
    const inner = new URLSearchParams(params);
    inner.delete("wrap");
    inner.delete("for");
    const port = page.port ? `:${page.port}` : "";
    const frame = (host: string, sandbox?: string) => {
      const src = `${url.protocol}//${host}${port}${url.pathname}?${inner}`;
      const sandboxAttribute = sandbox ? ` sandbox="${sandbox}"` : "";
      return `<iframe data-builder-frame="${escapeHtml(wrap)}" title="Custom code"${sandboxAttribute} style="display:block;width:100%;height:900px;border:0" src="${escapeHtml(src)}"></iframe>`;
    };
    if (wrap === "wix") {
      const site = params.get("for") ?? page.hostname;
      if (!HOST_SHAPE.test(site)) return new Response("Bad ?for.", { status: 400 });
      embed = frame(`${site.replaceAll(".", "-")}.filesusr.com`, WIX_SANDBOX);
    } else if (wrap === "google") {
      // Google's outer frame holds an inner one on the same host.
      inner.set("wrap", "google-inner");
      embed = frame(GOOGLE_FRAME_HOST);
    } else if (wrap === "google-inner") {
      embed = frame(GOOGLE_FRAME_HOST);
    } else if (wrap === "srcdoc") {
      embed = `<iframe data-builder-frame="srcdoc" title="Custom code" style="display:block;width:100%;height:900px;border:0" srcdoc="${escapeHtml(`<div data-embed-slot>${embed}</div>`)}"></iframe>`;
    } else {
      return new Response("Bad ?wrap.", { status: 400 });
    }
  }

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>A seller's own website</title>
<style>
body{margin:0;font:16px/1.5 Georgia,serif;color:#222;background:#faf7f2}
main{max-width:60rem;margin:0 auto;padding:2rem 1rem}
h1{font-size:1.75rem;margin:0 0 .5rem}
</style>
</head>
<body>
<main>
<h1>A seller's own website</h1>
<p>Everything on this page is theirs, apart from what the snippet below puts here.</p>
<div data-embed-slot>
${embed}
</div>
<p data-after-embed>The rest of their page carries on underneath.</p>
</main>
</body>
</html>`;

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      // Framable, as a builder's own frame is: this same page plays Wix's and
      // Google's wrappers (`?wrap=`). The app sends X-Frame-Options: DENY on
      // everything, and an enforced frame-ancestors is what a browser obeys
      // instead, the same way the embed frame's own header lifts it.
      "Content-Security-Policy": "frame-ancestors *",
    },
  });
}
