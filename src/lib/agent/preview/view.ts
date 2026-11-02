/**
 * THE STOREFRONT PREVIEW VIEW: an MCP Apps view (the `ui://` resource that
 * preview_storefront names in `_meta.ui.resourceUri`), spec 2026-01-26.
 *
 * One self-contained HTML document: no script, style or font from anywhere,
 * so it runs under the host's restrictive default CSP with nothing declared.
 * It speaks the protocol by hand (it is a handful of messages): `ui/initialize`,
 * then the host's `ui/notifications/tool-result`, whose content carries the
 * screenshots (`image` blocks, shown as data: URLs, which the default CSP
 * allows) and whose structuredContent carries where each tile is.
 *
 * Every word from a seller (titles, the storefront's name) goes in through
 * textContent, never as markup.
 *
 * What the seller does here goes back to the model with `ui/update-model-context`
 * (which tile they are looking at), and out with `ui/open-link` (the product
 * page, the designer), both of which the host may ask the person about first.
 */

export const MCP_APP_MIME_TYPE = "text/html;profile=mcp-app";

/** The protocol revision this view speaks. */
const PROTOCOL_VERSION = "2026-01-26";

const STYLE = `
:root {
  color-scheme: light dark;
  --bg: var(--color-background-primary, light-dark(#ffffff, #171717));
  --bg-2: var(--color-background-secondary, light-dark(#f5f5f5, #262626));
  --ink: var(--color-text-primary, light-dark(#171717, #fafafa));
  --ink-2: var(--color-text-secondary, light-dark(#525252, #a3a3a3));
  --line: var(--color-border-primary, light-dark(#e5e5e5, #404040));
  --accent: var(--color-background-inverse, light-dark(#171717, #fafafa));
  --accent-ink: var(--color-text-inverse, light-dark(#ffffff, #171717));
  --font: var(--font-sans, ui-sans-serif, system-ui, sans-serif);
}
* { box-sizing: border-box; }
html, body { margin: 0; background: var(--bg); color: var(--ink); font: 14px/1.4 var(--font); }
.bar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 12px; }
.name { font-weight: 600; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.switch { display: inline-flex; border: 1px solid var(--line); }
.switch button, .action { font: inherit; font-size: 13px; padding: 6px 12px; border: 0; background: transparent; color: var(--ink); cursor: pointer; }
.switch button[aria-pressed="true"] { background: var(--accent); color: var(--accent-ink); }
.notes { padding: 0 12px 8px; color: var(--ink-2); font-size: 12px; }
.stage { padding: 0 12px 12px; display: flex; justify-content: center; }
.frame { position: relative; width: 100%; border: 1px solid var(--line); background: var(--bg-2); }
.frame.phone { max-width: 390px; }
.frame img { display: block; width: 100%; height: auto; }
.hot { position: absolute; border: 0; padding: 0; background: transparent; cursor: pointer; }
.hot:hover, .hot:focus-visible, .hot[aria-pressed="true"] { outline: 2px solid var(--accent); outline-offset: -2px; }
.panel { margin: 0 12px 12px; padding: 10px 12px; border: 1px solid var(--line); display: grid; gap: 6px; }
.panel[hidden] { display: none; }
.panel .title { font-weight: 600; }
.panel .meta { color: var(--ink-2); font-size: 12px; word-break: break-all; }
.panel .row { display: flex; flex-wrap: wrap; gap: 6px; }
.action { border: 1px solid var(--line); }
.action.primary { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); }
.empty { padding: 24px 12px; color: var(--ink-2); text-align: center; }
`;

const SCRIPT = `
(() => {
  const PROTOCOL = ${JSON.stringify(PROTOCOL_VERSION)};
  const pending = new Map();
  let nextId = 1;
  let state = { loading: "Taking the pictures…", viewports: {}, images: {}, viewport: "desktop", selected: null, links: {}, name: "", notes: [] };

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

  function draw() {
    root.replaceChildren();
    if (state.loading) {
      root.append(el("div", { className: "empty", textContent: state.loading }));
      return;
    }
    const viewports = Object.keys(state.images);
    if (!viewports.includes(state.viewport)) state.viewport = viewports[0] || "desktop";

    const bar = el("div", { className: "bar" }, [el("div", { className: "name", textContent: state.name })]);
    if (viewports.length > 1) {
      const toggle = el("div", { className: "switch", role: "group", ariaLabel: "Screen" });
      for (const [key, label] of [["desktop", "Desktop"], ["mobile", "Phone"]]) {
        if (!state.images[key]) continue;
        const button = el("button", { type: "button", textContent: label });
        button.setAttribute("aria-pressed", String(state.viewport === key));
        button.addEventListener("click", () => { state.viewport = key; state.selected = null; draw(); });
        toggle.append(button);
      }
      bar.append(toggle);
    }
    root.append(bar);
    for (const note of state.notes) root.append(el("div", { className: "notes", textContent: note }));

    const image = state.images[state.viewport];
    if (!image) {
      root.append(el("div", { className: "empty", textContent: "No picture of this storefront could be taken. The details are in the text of this result." }));
      return;
    }
    const frame = el("div", { className: "frame" + (state.viewport === "mobile" ? " phone" : "") });
    frame.append(el("img", { src: image, alt: state.name + ", " + (state.viewport === "mobile" ? "on a phone" : "on a desktop") }));
    const measured = state.viewports[state.viewport];
    if (measured && measured.page && measured.page.width > 0 && measured.page.height > 0) {
      for (const tile of measured.tiles || []) {
        const hot = el("button", { type: "button", className: "hot", title: tile.title });
        hot.setAttribute("aria-label", tile.title);
        hot.setAttribute("aria-pressed", String(state.selected && state.selected.productId === tile.productId));
        hot.style.left = (100 * tile.x / measured.page.width) + "%";
        hot.style.top = (100 * tile.y / measured.page.height) + "%";
        hot.style.width = (100 * tile.w / measured.page.width) + "%";
        hot.style.height = (100 * tile.h / measured.page.height) + "%";
        hot.addEventListener("click", () => selectTile(tile));
        frame.append(hot);
      }
    }
    root.append(el("div", { className: "stage" }, [frame]));

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
    state = {
      loading: null,
      viewports: data.viewports || {},
      images,
      viewport: data.viewport === "mobile" ? "mobile" : "desktop",
      selected: null,
      links: data.links || {},
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
        state.loading = "The preview was cancelled.";
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
