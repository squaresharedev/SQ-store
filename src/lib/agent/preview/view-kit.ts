/**
 * WHAT EVERY MCP APPS VIEW OF THIS SERVER SHARES (spec 2026-01-26): the
 * document around it, the host's look, the buttons, and the protocol, spoken by
 * hand so a view is one self-contained document with nothing to load.
 *
 * A view's own script defines three functions and may use the kit's helpers:
 *
 *   - `draw()`, which paints the view from its own state (called once at the
 *     start, before any result has arrived);
 *   - `onResult(result)`, for `ui/notifications/tool-result`;
 *   - `onCancelled()`, for `ui/notifications/tool-cancelled`.
 *
 * Helpers: `el(tag, props, children)` builds a node (text goes in through
 * `textContent`, never markup), `request(method, params)` and
 * `notify(method, params)` talk to the host, `openLink(url)` asks it to open one.
 */

export const MCP_APP_MIME_TYPE = "text/html;profile=mcp-app";

/** The protocol revision these views speak. */
const PROTOCOL_VERSION = "2026-01-26";

/** The host's own colours and type when it passes them (hostContext.styles),
 *  a plain light or dark look when it does not. Prefixed so nothing a view
 *  draws from this app (its own --accent and the like) can collide. */
const BASE_STYLE = `
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
.action { font: inherit; font-size: 13px; padding: 6px 12px; border: 1px solid var(--pv-line); background: transparent; color: var(--pv-ink); cursor: pointer; }
.action.primary { background: var(--pv-accent); color: var(--pv-accent-ink); border-color: var(--pv-accent); }
.notes { padding: 0 12px 8px; color: var(--pv-ink-2); font-size: 12px; }
.empty { padding: 24px 12px; color: var(--pv-ink-2); text-align: center; }
`;

/** The helpers, ahead of the view's own script. */
const HELPERS = `
  const pending = new Map();
  let nextId = 1;
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
  const openLink = (url) => { if (url) request("ui/open-link", { url }).catch(() => {}); };
  const applyContext = (context) => {
    if (context && (context.theme === "light" || context.theme === "dark")) {
      document.documentElement.style.colorScheme = context.theme;
    }
    const variables = context && context.styles && context.styles.variables;
    if (variables) {
      for (const [name, value] of Object.entries(variables)) {
        if (typeof value === "string" && name.startsWith("--")) document.documentElement.style.setProperty(name, value);
      }
    }
  };
`;

/** The wiring, after it: the host's messages, the view's size, the handshake. */
function wiring(app: { name: string; version: string }): string {
  return `
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
        onResult(message.params);
        break;
      case "ui/notifications/tool-cancelled":
        onCancelled();
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
    appInfo: ${JSON.stringify(app)},
    appCapabilities: { availableDisplayModes: ["inline", "fullscreen"] },
    protocolVersion: ${JSON.stringify(PROTOCOL_VERSION)},
  })
    .then((result) => {
      applyContext((result && result.hostContext) || {});
      notify("ui/notifications/initialized", {});
    })
    .catch(() => {});
`;
}

/** A whole view, as `resources/read` returns it. */
export function viewDocument(view: {
  title: string;
  /** Its own rules, after the shared ones. */
  style: string;
  /** Its own script: draw, onResult and onCancelled, and what they need. */
  script: string;
  app: { name: string; version: string };
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${view.title}</title>
<style>${BASE_STYLE}${view.style}</style>
</head>
<body>
<div id="app"></div>
<script>
(() => {
${HELPERS}
${view.script}
${wiring(view.app)}
})();
</script>
</body>
</html>`;
}
