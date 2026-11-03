/**
 * THE STOREFRONT PREVIEW VIEW: an MCP Apps view (the `ui://` resource that
 * preview_storefront names in `_meta.ui.resourceUri`), spec 2026-01-26.
 *
 * It shows THE STOREFRONT ITSELF, live: it reads the preview page from this app
 * (`structuredContent.live.url`, a short-lived token, `vp=mobile` for the phone
 * board), takes the storefront out of it, and draws that markup with this
 * app's own stylesheets, fonts and photos. A nested iframe would be simpler,
 * but Claude restricts `frameDomains` pending its own security review, so the
 * page is drawn here instead, its scripts left behind. Hover reveals, fonts,
 * gradients and photos are the real ones; a desktop board is drawn at 1280px
 * and scaled to fit, a phone board at 390px.
 *
 * What it may reach is declared in its resource's `_meta.ui.csp`: this app for
 * the page (connect) and its assets, and R2 for the photos (resources). Nothing
 * else. When the page cannot be read (an old link, a host that refuses the
 * connection), it shows the screenshots the result carries as `image` blocks.
 *
 * It speaks the protocol by hand: `ui/initialize`, then the host's
 * `ui/notifications/tool-result`. A click on a product tile is caught (nothing
 * navigates), tells the model which tile with `ui/update-model-context`, and
 * offers `ui/open-link` to the product page or the designer; the host may ask
 * the person about either.
 *
 * Seller words reach this document only inside the storefront markup this app
 * rendered (React escaped them there) and through textContent. It never parses
 * markup into itself with innerHTML: the page is parsed by DOMParser and its
 * storefront imported node by node, scripts removed.
 */

export const MCP_APP_MIME_TYPE = "text/html;profile=mcp-app";

/** The protocol revision this view speaks. */
const PROTOCOL_VERSION = "2026-01-26";

const STYLE = `
:root {
  color-scheme: light dark;
  --pv-bg: var(--color-background-primary, light-dark(#ffffff, #171717));
  --pv-bg-2: var(--color-background-secondary, light-dark(#f5f5f5, #262626));
  --pv-ink: var(--color-text-primary, light-dark(#171717, #fafafa));
  --pv-ink-2: var(--color-text-secondary, light-dark(#525252, #a3a3a3));
  --pv-line: var(--color-border-primary, light-dark(#e5e5e5, #404040));
  --pv-accent: var(--color-background-inverse, light-dark(#171717, #fafafa));
  --pv-accent-ink: var(--color-text-inverse, light-dark(#ffffff, #171717));
  --pv-font: var(--font-sans, ui-sans-serif, system-ui, sans-serif);
}
* { box-sizing: border-box; }
html, body { margin: 0; background: var(--pv-bg); color: var(--pv-ink); font: 14px/1.4 var(--pv-font); }
.bar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 12px; }
.name { font-weight: 600; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.switch { display: inline-flex; border: 1px solid var(--pv-line); }
.switch button, .action { font: inherit; font-size: 13px; padding: 6px 12px; border: 0; background: transparent; color: var(--pv-ink); cursor: pointer; }
.switch button[aria-pressed="true"] { background: var(--pv-accent); color: var(--pv-accent-ink); }
.notes { padding: 0 12px 8px; color: var(--pv-ink-2); font-size: 12px; }
.stage { padding: 0 12px 12px; display: flex; justify-content: center; }
.frame { position: relative; width: 100%; border: 1px solid var(--pv-line); background: var(--pv-bg-2); }
.frame.phone { max-width: 390px; }
.frame img { display: block; width: 100%; height: auto; }
.hot { position: absolute; border: 0; padding: 0; background: transparent; cursor: pointer; }
.hot:hover, .hot:focus-visible, .hot[aria-pressed="true"] { outline: 2px solid var(--pv-accent); outline-offset: -2px; }
.live { position: relative; width: 100%; overflow: hidden; border: 1px solid var(--pv-line); }
.live.phone { max-width: 390px; }
.live-inner { position: absolute; top: 0; left: 0; transform-origin: 0 0; }
.live-inner [data-storefront-page] { min-height: 0 !important; }
.live-inner a { cursor: pointer; }
.live-inner a[data-picked] { outline: 3px solid var(--pv-accent); outline-offset: -3px; }
.panel { margin: 0 12px 12px; padding: 10px 12px; border: 1px solid var(--pv-line); display: grid; gap: 6px; }
.panel[hidden] { display: none; }
.panel .title { font-weight: 600; }
.panel .meta { color: var(--pv-ink-2); font-size: 12px; word-break: break-all; }
.panel .row { display: flex; flex-wrap: wrap; gap: 6px; }
.action { border: 1px solid var(--pv-line); }
.action.primary { background: var(--pv-accent); color: var(--pv-accent-ink); border-color: var(--pv-accent); }
.empty { padding: 24px 12px; color: var(--pv-ink-2); text-align: center; }
`;

const SCRIPT = `
(() => {
  const PROTOCOL = ${JSON.stringify(PROTOCOL_VERSION)};
  /** The widths a board is drawn at: a laptop's, and a phone's. */
  const WIDTHS = { desktop: 1280, mobile: 390 };
  const pending = new Map();
  let nextId = 1;
  let state = { loading: "Taking the pictures…" };
  let live = { stages: {}, status: {} };
  const adopted = new Set();

  const send = (message) => window.parent.postMessage(message, "*");
  const notify = (method, params) => send({ jsonrpc: "2.0", method, params });
  const request = (method, params) => {
    const id = nextId++;
    send({ jsonrpc: "2.0", id, method, params });
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      setTimeout(() => { if (pending.delete(id)) reject(new Error("timeout")); }, 30000);
    });
  };

  const el = (tag, props, children) => {
    const node = document.createElement(tag);
    Object.assign(node, props || {});
    for (const child of children || []) node.append(child);
    return node;
  };
  const root = document.getElementById("app");

  function findTile(productId) {
    for (const viewport of Object.values(state.viewports || {})) {
      const tile = (viewport.tiles || []).find((candidate) => candidate.productId === productId);
      if (tile) return tile;
    }
    return null;
  }

  function markPicked() {
    for (const stage of Object.values(live.stages)) {
      for (const anchor of stage.querySelectorAll("a[data-picked]")) anchor.removeAttribute("data-picked");
      if (!state.selected) continue;
      for (const anchor of stage.querySelectorAll("a[data-href]")) {
        if (productOf(anchor.getAttribute("data-href")) === state.selected.productId) anchor.setAttribute("data-picked", "");
      }
    }
  }

  function selectTile(tile) {
    state.selected = tile;
    draw();
    if (tile) {
      // The person's attention, for the model's next turn. The host may ignore it.
      request("ui/update-model-context", {
        content: [{ type: "text", text: "In the storefront preview (" + state.viewport + "), the seller selected the tile for product \\"" + tile.title + "\\" (productId " + tile.productId + ", status " + tile.status + ")." }],
      }).catch(() => {});
    }
  }

  function openLink(url) {
    if (url) request("ui/open-link", { url }).catch(() => {});
  }

  /** A product page path's product id, or null. */
  function productOf(href) {
    const match = /\\/p\\/([^/?#]+)/.exec(href || "");
    return match ? decodeURIComponent(match[1]) : null;
  }

  /** This app's stylesheets and font faces, once each, so its markup looks as it does there. */
  function adoptStyle(node, base) {
    if (node.tagName === "LINK") {
      const href = new URL(node.getAttribute("href"), base).href;
      if (adopted.has(href)) return;
      adopted.add(href);
      document.head.append(el("link", { rel: "stylesheet", href }));
    } else {
      // A font face's address is relative to the page it came from.
      const text = (node.textContent || "").replace(/url\\((['"]?)\\/(?!\\/)/g, "url($1" + base.origin + "/");
      if (adopted.has(text)) return;
      adopted.add(text);
      document.head.append(el("style", { textContent: text }));
    }
  }

  /** Addresses in the imported markup point back at this app, not at the view. */
  function absolutize(page, base) {
    for (const node of page.querySelectorAll("[src],[href],[srcset],[poster]")) {
      for (const name of ["src", "href", "poster"]) {
        const value = node.getAttribute(name);
        if (!value || /^(data:|blob:|#)/.test(value)) continue;
        if (name === "href") node.setAttribute("data-href", value);
        node.setAttribute(name, new URL(value, base).href);
      }
      const set = node.getAttribute("srcset");
      if (set) {
        node.setAttribute("srcset", set.split(",").map((part) => {
          const [address, size] = part.trim().split(/\\s+/, 2);
          return new URL(address, base).href + (size ? " " + size : "");
        }).join(", "));
      }
    }
  }

  async function loadPage(viewport) {
    const url = new URL(state.live.url);
    if (viewport === "mobile") url.searchParams.set("vp", "mobile");
    const response = await fetch(url.href, { credentials: "omit", cache: "no-store" });
    if (!response.ok) throw new Error("preview page " + response.status);
    const doc = new DOMParser().parseFromString(await response.text(), "text/html");
    const source = doc.querySelector("[data-storefront-page]");
    if (!source) throw new Error("no storefront in the page");
    for (const node of doc.querySelectorAll('link[rel="stylesheet"][href], style')) adoptStyle(node, url);
    const page = document.importNode(source, true);
    for (const script of page.querySelectorAll("script")) script.remove();
    absolutize(page, url);
    // The page root carries the font variables (next/font) the storefront's
    // typefaces are named by; without them every face falls back.
    const fonts = (doc.documentElement.getAttribute("class") || "").split(/\\s+/).filter(Boolean);
    return { page, fonts };
  }

  /** The page at its own width, scaled down to the room there is. */
  function liveStage(viewport, { page, fonts }) {
    const width = WIDTHS[viewport];
    const inner = el("div", { className: "live-inner" }, [page]);
    inner.classList.add(...fonts);
    inner.style.width = width + "px";
    const stage = el("div", { className: "live" + (viewport === "mobile" ? " phone" : "") }, [inner]);
    const fit = () => {
      const scale = Math.min(1, (stage.clientWidth || width) / width);
      inner.style.transform = "scale(" + scale + ")";
      stage.style.height = Math.ceil(inner.scrollHeight * scale) + "px";
    };
    new ResizeObserver(fit).observe(stage);
    new ResizeObserver(fit).observe(inner);
    // Nothing in a preview navigates: a product tile is picked instead.
    inner.addEventListener("click", (event) => {
      const anchor = event.target.closest && event.target.closest("a");
      if (!anchor) return;
      event.preventDefault();
      const productId = productOf(anchor.getAttribute("data-href"));
      if (!productId) return;
      selectTile(findTile(productId) || { productId, title: (anchor.textContent || "").trim().slice(0, 120), status: "active" });
    });
    inner.addEventListener("submit", (event) => event.preventDefault());
    return stage;
  }

  function ensureLive(viewport) {
    if (live.status[viewport]) return;
    live.status[viewport] = "loading";
    loadPage(viewport)
      .then((page) => {
        live.stages[viewport] = liveStage(viewport, page);
        live.status[viewport] = "ready";
      })
      .catch(() => { live.status[viewport] = "failed"; })
      .finally(draw);
  }

  function drawPicture() {
    const image = state.images[state.viewport];
    if (!image) {
      const message = state.live
        ? "This preview has run out. Ask for a new one to see the storefront again."
        : "No picture of this storefront could be taken. The details are in the text of this result.";
      root.append(el("div", { className: "empty", textContent: message }));
      return;
    }
    const frame = el("div", { className: "frame" + (state.viewport === "mobile" ? " phone" : "") });
    frame.append(el("img", { src: image, alt: state.name + ", " + (state.viewport === "mobile" ? "on a phone" : "on a desktop") }));
    const measured = (state.viewports || {})[state.viewport];
    if (measured && measured.page && measured.page.width > 0 && measured.page.height > 0) {
      for (const tile of measured.tiles || []) {
        const hot = el("button", { type: "button", className: "hot", title: tile.title });
        hot.setAttribute("aria-label", tile.title);
        hot.setAttribute("aria-pressed", String(Boolean(state.selected && state.selected.productId === tile.productId)));
        hot.style.left = (100 * tile.x / measured.page.width) + "%";
        hot.style.top = (100 * tile.y / measured.page.height) + "%";
        hot.style.width = (100 * tile.w / measured.page.width) + "%";
        hot.style.height = (100 * tile.h / measured.page.height) + "%";
        hot.addEventListener("click", () => selectTile(tile));
        frame.append(hot);
      }
    }
    root.append(el("div", { className: "stage" }, [frame]));
  }

  function draw() {
    root.replaceChildren();
    if (state.loading) {
      root.append(el("div", { className: "empty", textContent: state.loading }));
      return;
    }
    const screens = state.live ? ["desktop", "mobile"] : Object.keys(state.images);
    if (!screens.includes(state.viewport)) state.viewport = screens[0] || "desktop";

    const bar = el("div", { className: "bar" }, [el("div", { className: "name", textContent: state.name })]);
    if (screens.length > 1) {
      const toggle = el("div", { className: "switch", role: "group", ariaLabel: "Screen" });
      for (const [key, label] of [["desktop", "Desktop"], ["mobile", "Phone"]]) {
        if (!screens.includes(key)) continue;
        const button = el("button", { type: "button", textContent: label });
        button.setAttribute("aria-pressed", String(state.viewport === key));
        button.addEventListener("click", () => { state.viewport = key; state.selected = null; draw(); });
        toggle.append(button);
      }
      bar.append(toggle);
    }
    root.append(bar);
    for (const note of state.notes) root.append(el("div", { className: "notes", textContent: note }));

    const status = state.live ? live.status[state.viewport] : "failed";
    if (status === "ready") {
      root.append(el("div", { className: "stage" }, [live.stages[state.viewport]]));
      markPicked();
    } else if (status === "failed") {
      drawPicture();
    } else {
      root.append(el("div", { className: "empty", textContent: "Loading the storefront…" }));
      ensureLive(state.viewport);
    }

    const tile = state.selected;
    const panel = el("div", { className: "panel", hidden: !tile });
    if (tile) {
      panel.append(el("div", { className: "title", textContent: tile.title }));
      panel.append(el("div", { className: "meta", textContent: "Product " + tile.productId + (tile.status !== "active" ? " · " + tile.status + ", buyers do not see it yet" : "") }));
      const row = el("div", { className: "row" });
      const page = typeof tile.pageUrl === "string" ? tile.pageUrl : null;
      if (page) {
        const open = el("button", { type: "button", className: "action primary", textContent: "Open product page" });
        open.addEventListener("click", () => openLink(page));
        row.append(open);
      }
      if (state.links.designer) {
        const design = el("button", { type: "button", className: "action", textContent: "Open in the designer" });
        design.addEventListener("click", () => openLink(state.links.designer));
        row.append(design);
      }
      panel.append(row);
    }
    root.append(panel);
  }

  function render(result) {
    const content = (result && result.content) || [];
    const data = (result && result.structuredContent) || {};
    const images = {};
    for (const [viewport, index] of Object.entries(data.imageIndex || {})) {
      const block = content[index];
      if (block && block.type === "image" && typeof block.data === "string") {
        images[viewport] = "data:" + block.mimeType + ";base64," + block.data;
      }
    }
    live = { stages: {}, status: {} };
    state = {
      loading: null,
      viewports: data.viewports || {},
      images,
      viewport: data.viewport === "mobile" ? "mobile" : "desktop",
      selected: null,
      links: data.links || {},
      live: data.live && typeof data.live.url === "string" ? data.live : null,
      name: (data.storefront && data.storefront.name) || "Storefront",
      notes: Array.isArray(data.notes) ? data.notes.filter((note) => typeof note === "string") : [],
    };
    draw();
  }

  function applyContext(context) {
    if (context && (context.theme === "light" || context.theme === "dark")) {
      document.documentElement.style.colorScheme = context.theme;
    }
    const variables = context && context.styles && context.styles.variables;
    if (variables) {
      for (const [name, value] of Object.entries(variables)) {
        if (typeof value === "string" && name.startsWith("--")) document.documentElement.style.setProperty(name, value);
      }
    }
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window.parent) return;
    const message = event.data;
    if (!message || message.jsonrpc !== "2.0") return;
    if (message.id !== undefined && message.method === undefined) {
      const waiting = pending.get(message.id);
      if (!waiting) return;
      pending.delete(message.id);
      if (message.error) waiting.reject(message.error);
      else waiting.resolve(message.result);
      return;
    }
    switch (message.method) {
      case "ui/notifications/tool-result":
        render(message.params);
        break;
      case "ui/notifications/tool-cancelled":
        state = { loading: "The preview was cancelled." };
        draw();
        break;
      case "ui/notifications/host-context-changed":
        applyContext(message.params);
        break;
      case "ui/resource-teardown":
      case "ping":
        if (message.id !== undefined) send({ jsonrpc: "2.0", id: message.id, result: {} });
        break;
    }
  });

  new ResizeObserver(() => {
    notify("ui/notifications/size-changed", { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight });
  }).observe(document.documentElement);

  draw();
  request("ui/initialize", {
    appInfo: { name: "square-share-storefront-preview", version: "1.0.0" },
    appCapabilities: { availableDisplayModes: ["inline", "fullscreen"] },
    protocolVersion: PROTOCOL,
  })
    .then((result) => {
      applyContext((result && result.hostContext) || {});
      notify("ui/notifications/initialized", {});
    })
    .catch(() => {});
})();
`;

/** The whole view, as `resources/read` returns it. */
export const STOREFRONT_PREVIEW_VIEW_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Storefront preview</title>
<style>${STYLE}</style>
</head>
<body>
<div id="app"></div>
<script>${SCRIPT}</script>
</body>
</html>`;
