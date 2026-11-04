/**
 * THE PUBLISH CARD: the MCP Apps view publish_products answers in. What went
 * live and where to open it, and what did not and why, one row per product,
 * with the way to fix a refusal when the fix is the seller's (their trader
 * details). Drawn from `structuredContent` alone: it reads nothing and loads
 * only the products' own photos, which its resource's CSP allows.
 *
 * Every word from the store goes in through textContent; addresses only into
 * an <img> (https only) or `ui/open-link`, which the host may confirm first.
 */

import { viewDocument } from "@/lib/agent/preview/view-kit";

const STYLE = `
.head { padding: 12px 12px 8px; }
.head .title { font-weight: 600; font-size: 15px; }
.head .sub { color: var(--pv-ink-2); font-size: 12px; margin-top: 2px; }
.list { list-style: none; margin: 0; padding: 0 12px 12px; display: grid; gap: 8px; }
.row { display: grid; grid-template-columns: 48px minmax(0, 1fr); gap: 4px 10px; align-items: center; padding: 8px; border: 1px solid var(--pv-line); }
.thumb { width: 48px; height: 48px; object-fit: cover; background: var(--pv-bg-2); display: block; }
.text { min-width: 0; }
.item-title { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.meta { color: var(--pv-ink-2); font-size: 12px; }
.row[data-outcome="refused"] .meta, .row[data-outcome="not_found"] .meta { color: var(--pv-ink); }
.reason { font-size: 12px; margin-top: 2px; }
.buttons { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 6px; }
.buttons:empty { display: none; }
`;

const SCRIPT = `
  const OUTCOMES = { published: "Live now", already_live: "Already live", refused: "Not published", not_found: "Not found" };
  let state = { loading: "Publishing…" };
  const root = document.getElementById("app");

  function button(label, url, primary) {
    const node = el("button", { type: "button", className: "action" + (primary ? " primary" : ""), textContent: label });
    node.addEventListener("click", () => openLink(url));
    return node;
  }

  function draw() {
    root.replaceChildren();
    if (state.loading) {
      root.append(el("div", { className: "empty", textContent: state.loading }));
      return;
    }
    if (state.items.length === 0) {
      root.append(el("div", { className: "empty", textContent: "Nothing was published. The details are in the text of this result." }));
      return;
    }
    const live = state.items.filter((item) => item.outcome === "published" || item.outcome === "already_live").length;
    const missed = state.items.length - live;
    const head = el("div", { className: "head" }, [
      el("div", { className: "title", textContent: live === 0 ? "Nothing went live" : live === 1 ? "1 product is live" : live + " products are live" }),
    ]);
    if (missed) head.append(el("div", { className: "sub", textContent: missed === 1 ? "1 could not be published." : missed + " could not be published." }));
    root.append(head);

    const list = el("ul", { className: "list" });
    for (const item of state.items) {
      const row = el("li", { className: "row" });
      row.setAttribute("data-outcome", item.outcome);
      const thumb = typeof item.imageUrl === "string" && /^https:\\/\\//.test(item.imageUrl)
        ? el("img", { className: "thumb", src: item.imageUrl, alt: "" })
        : el("div", { className: "thumb" });
      const text = el("div", { className: "text" }, [
        el("div", { className: "item-title", textContent: item.title }),
        el("div", { className: "meta", textContent: [item.price, OUTCOMES[item.outcome] || item.outcome].filter(Boolean).join(" · ") }),
      ]);
      if (typeof item.reason === "string") text.append(el("div", { className: "reason", textContent: item.reason }));
      const buttons = el("div", { className: "buttons" });
      if (typeof item.pageUrl === "string") buttons.append(button("Open the page", item.pageUrl, true));
      if (item.fix && typeof item.fix.url === "string") buttons.append(button(item.fix.label || "Fix it", item.fix.url, !item.pageUrl));
      if (typeof item.editUrl === "string") buttons.append(button("Edit the product", item.editUrl, false));
      row.append(thumb, text, buttons);
      list.append(row);
    }
    root.append(list);
  }

  function onResult(result) {
    const data = (result && result.structuredContent) || {};
    const items = Array.isArray(data.items)
      ? data.items.filter((item) => item && typeof item.title === "string" && typeof item.outcome === "string")
      : [];
    state = { loading: null, items };
    draw();
  }

  function onCancelled() {
    state = { loading: "Publishing was cancelled." };
    draw();
  }
`;

/** The whole view, as `resources/read` returns it. */
export const PUBLISH_CARD_VIEW_HTML = viewDocument({
  title: "Published",
  style: STYLE,
  script: SCRIPT,
  app: { name: "square-share-publish-card", version: "1.0.0" },
});
