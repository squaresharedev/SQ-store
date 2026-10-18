import { embedOrigin } from "@/lib/app-url";
import { escapeHtml } from "@/lib/format/html";
import { embedFramePath, parseEmbedSite } from "@/lib/storefront/embed-frame";
import { embedSnippet } from "@/lib/storefront/embed-snippet";
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
 * `?claim=<site>` swaps the snippet for a hand-written frame that NAMES that
 * site while the page stays where it is: a page pretending to be one the
 * seller allowed. The server serves it; the browser must refuse to draw it.
 *
 * A route handler writing one document rather than a page, like /offline: a
 * seller's site has none of this app's markup, styles or scripts around the
 * snippet, and the stand-in should not either. Development only, and nothing
 * from the address is written out without being checked and escaped.
 */
export async function GET(request: Request) {
  if (process.env.NODE_ENV !== "development") return new Response("Not found.", { status: 404 });

  const params = new URL(request.url).searchParams;
  const key = params.get("key") ?? "";
  if (!uuidField().safeParse(key).success) {
    return new Response("Pass ?key=<a storefront's embed key>.", { status: 400 });
  }

  let embed = embedSnippet(key);
  const claim = params.get("claim");
  if (claim !== null) {
    const site = parseEmbedSite(claim, { allowPort: true });
    const origin = embedOrigin();
    if (!site || !origin) return new Response("Bad ?claim.", { status: 400 });
    embed = `<iframe data-claimed-frame title="Shop" style="display:block;width:100%;height:400px;border:0" src="${escapeHtml(origin + embedFramePath(key, site.site))}"></iframe>`;
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
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}
