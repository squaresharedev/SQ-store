"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useTranslations } from "next-intl";
import { cartApiPath, cartViewApiPath } from "@/lib/checkout/paths";
import { forgetCartHandle, isCartStorageEvent, readCartHandle, writeCartHandle } from "@/lib/cart/storage";
import { CART_QUERY_PARAM, type LinkChannel } from "@/lib/storefront/product-page-url";
import type { OrderLineSource } from "@/lib/checkout/lines";
import type { CartHandle, CartLineView, CartRefusal, CartResponse, CartView } from "@/types/cart";
import type { CartPageConfig } from "@/types/storefront";
import { CART_LOOK, CART_UNDO_MS, type CartLook } from "./cart-look";

// ONE BUYER'S CART ON ONE STOREFRONT, for every cart control on the page: the
// cart button, the drawer, "Add to cart" on the product page and on tiles.
// The server holds the cart (app/api/cart); the browser keeps only its handle
// (lib/cart/storage.ts) and the last view it was shown. Nothing here is a
// price the server did not just work out.

export type CartAddRequest = {
  productId: string;
  optionIds: readonly string[];
  quantity: number;
  source: OrderLineSource;
  /** For the "added" announcement. */
  title: string;
};

export type CartAddResult = { ok: true } | { ok: false; error: CartRefusal };

/** A line taken out a moment ago, offered back. */
export type CartUndo = { line: CartLineView };

export type CartContextValue = {
  storefrontId: string;
  config: CartPageConfig;
  look: CartLook;
  /** In the editor or the lab: drawn exactly, nothing sent. */
  preview: boolean;
  /** Inside the embed frame on the seller's own site: no panel opens there
   *  (the frame grows with its content), and the cart opens on our page. */
  embedded: boolean;
  /** How many items the cart holds, for the cart button (before any view). */
  count: number;
  /** The cart as last shown; null until it has been read once. */
  view: CartView | null;
  status: "idle" | "loading" | "error";
  open: boolean;
  setOpen: (open: boolean) => void;
  add: (request: CartAddRequest) => Promise<CartAddResult>;
  setQuantity: (key: string, quantity: number) => Promise<CartRefusal | null>;
  remove: (key: string) => Promise<void>;
  undo: CartUndo | null;
  restore: () => Promise<void>;
  refresh: () => Promise<void>;
  /** The line that went in last, and when (for the cart button's bump and the
   *  "Added" note). */
  lastAdded: { productId: string; title: string; at: number } | null;
  /** What a screen reader is told after a change (an aria-live region). */
  announcement: string;
  /** The cart's id, for a link that carries it to our page (the embed). */
  cartId: string | null;
};

const CartContext = createContext<CartContextValue | null>(null);

/** The cart, or null where this page has none (cart switched off, no
 *  checkout, the seller's own buy link). */
export function useCart(): CartContextValue | null {
  return useContext(CartContext);
}


// ---- The stored handle, as an external store: no hydration mismatch (the
// server's snapshot is "no cart"), and every tab sees another's change. ----

/** Same-tab writes do not fire `storage`; this does. */
const CHANGE_EVENT = "ss-cart-change";

function subscribe(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

/** Snapshots must be stable between reads of the same value. */
const snapshots = new Map<string, { raw: string; handle: CartHandle | null }>();

function snapshotOf(storefrontId: string): CartHandle | null {
  const handle = readCartHandle(storefrontId);
  const raw = JSON.stringify(handle);
  const cached = snapshots.get(storefrontId);
  if (cached && cached.raw === raw) return cached.handle;
  snapshots.set(storefrontId, { raw, handle });
  return handle;
}

function storeHandle(storefrontId: string, handle: CartHandle | null): void {
  if (handle) writeCartHandle(storefrontId, handle);
  else forgetCartHandle(storefrontId);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function send(path: string, body: unknown): Promise<CartResponse | null> {
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      credentials: "same-origin",
    });
    return (await response.json().catch(() => null)) as CartResponse | null;
  } catch {
    return null;
  }
}

export function CartProvider({
  storefrontId,
  config,
  embedded = false,
  via = null,
  look = CART_LOOK,
  children,
}: {
  storefrontId: string;
  config: CartPageConfig;
  embedded?: boolean;
  /** How the buyer arrived, for the seller's "Added to cart" figure. */
  via?: LinkChannel | null;
  look?: CartLook;
  children: ReactNode;
}) {
  const t = useTranslations("ProductPage.cart");
  const handle = useSyncExternalStore(
    subscribe,
    () => snapshotOf(storefrontId),
    () => null,
  );
  const [view, setView] = useState<CartView | null>(null);
  const [status, setStatus] = useState<CartContextValue["status"]>("idle");
  const [open, setOpenState] = useState(false);
  const [undo, setUndo] = useState<CartUndo | null>(null);
  const [lastAdded, setLastAdded] = useState<CartContextValue["lastAdded"]>(null);
  const [announcement, setAnnouncement] = useState("");
  // The latest translator, read when a change is announced (an inline
  // dependency would rebuild every action on each render).
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  });

  /** Take the server's answer as the truth: the view, and the handle. */
  const accept = useCallback(
    (cart: CartView) => {
      if (cart.closed || cart.lines.length === 0) {
        storeHandle(storefrontId, cart.closed ? null : { id: cart.id, rev: cart.rev, count: 0 });
        setView(cart.closed ? null : cart);
        return;
      }
      storeHandle(storefrontId, { id: cart.id, rev: cart.rev, count: cart.count });
      setView(cart);
    },
    [storefrontId],
  );

  const refresh = useCallback(async () => {
    const current = readCartHandle(storefrontId);
    if (!current) {
      setView(null);
      return;
    }
    setStatus("loading");
    const result = await send(cartViewApiPath(storefrontId), { cartId: current.id });
    if (result?.ok) {
      accept(result.cart);
      setStatus("idle");
    } else if (result && !result.ok && result.error === "gone") {
      storeHandle(storefrontId, null);
      setView(null);
      setStatus("idle");
    } else {
      setStatus("error");
    }
  }, [accept, storefrontId]);

  // A link from the embedded shop carries its cart: carry on with it here.
  // When this page already held a different cart with something in it, the
  // two become one (the server merges). The id leaves the address bar at
  // once, so it is not shared by accident with the page's address.
  useEffect(() => {
    const url = new URL(window.location.href);
    const arriving = url.searchParams.get(CART_QUERY_PARAM)?.toLowerCase() ?? null;
    if (arriving) {
      url.searchParams.delete(CART_QUERY_PARAM);
      window.history.replaceState(window.history.state, "", url.toString());
    }
    const stored = readCartHandle(storefrontId);
    void (async () => {
      if (arriving && UUID.test(arriving) && arriving !== stored?.id) {
        if (stored && stored.count > 0) {
          const merged = await send(cartApiPath(storefrontId), {
            cartId: arriving,
            change: { kind: "merge", fromCartId: stored.id },
          });
          if (merged?.ok) {
            accept(merged.cart);
            return;
          }
        }
        storeHandle(storefrontId, { id: arriving, rev: 0, count: 0 });
      }
      // Read once on arrival: the count stays true, and a cart paid in
      // another tab (or swept) is forgotten.
      await refresh();
    })();
  }, [accept, refresh, storefrontId]);

  // Opening on a cart another tab changed while this one was closed: look
  // again. (While it is open, the storage listener below does.)
  const setOpen = useCallback(
    (next: boolean) => {
      setOpenState(next);
      if (!next) return;
      const current = readCartHandle(storefrontId);
      if (current && !(view && view.id === current.id && view.rev === current.rev)) void refresh();
    },
    [refresh, storefrontId, view],
  );

  // The buyer came back to this tab (the embedded shop's tab, after adding on
  // our product page): look again.
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === "visible" && readCartHandle(storefrontId)) void refresh();
    }
    function onStorage(event: StorageEvent) {
      if (isCartStorageEvent(event, storefrontId) && open) void refresh();
    }
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("storage", onStorage);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("storage", onStorage);
    };
  }, [open, refresh, storefrontId]);

  const change = useCallback(
    async (body: Record<string, unknown>): Promise<CartResponse | null> =>
      send(cartApiPath(storefrontId), {
        cartId: readCartHandle(storefrontId)?.id ?? null,
        ...body,
        ...(via ? { via } : {}),
      }),
    [storefrontId, via],
  );

  const add = useCallback(
    async (request: CartAddRequest): Promise<CartAddResult> => {
      const result = await change({
        change: {
          kind: "add",
          productId: request.productId,
          optionIds: [...request.optionIds],
          quantity: request.quantity,
          source: request.source,
        },
      });
      if (!result) return { ok: false, error: "unavailable" };
      if (result.cart) accept(result.cart);
      if (!result.ok) return { ok: false, error: result.error };
      setLastAdded({ productId: request.productId, title: request.title, at: Date.now() });
      setAnnouncement(tRef.current("addedAnnounce", { title: request.title, count: result.cart.count }));
      if (!embedded && config.afterAdd !== "note") setOpenState(true);
      return { ok: true };
    },
    [accept, change, config.afterAdd, embedded],
  );

  const setQuantity = useCallback(
    async (key: string, quantity: number): Promise<CartRefusal | null> => {
      const result = await change({ change: { kind: "set", key, quantity } });
      if (!result) return "unavailable";
      if (result.cart) accept(result.cart);
      if (!result.ok && result.error === "gone") await refresh();
      return result.ok ? null : result.error;
    },
    [accept, change, refresh],
  );

  const remove = useCallback(
    async (key: string) => {
      const line = view?.lines.find((candidate) => candidate.key === key) ?? null;
      const result = await change({ change: { kind: "remove", key } });
      if (result?.cart) accept(result.cart);
      if (result?.ok && line) {
        setUndo({ line });
        setAnnouncement(tRef.current("removed", { title: line.title ?? tRef.current("gone") }));
      }
    },
    [accept, change, view],
  );

  // An Undo is offered for a moment, then goes.
  useEffect(() => {
    if (!undo) return;
    const timer = window.setTimeout(() => setUndo(null), CART_UNDO_MS);
    return () => window.clearTimeout(timer);
  }, [undo]);

  const restore = useCallback(async () => {
    if (!undo) return;
    const { line } = undo;
    setUndo(null);
    const result = await change({
      change: { kind: "add", productId: line.productId, optionIds: line.optionIds, quantity: line.quantity, source: "cart" },
    });
    if (result?.cart) accept(result.cart);
  }, [accept, change, undo]);

  const value = useMemo<CartContextValue>(
    () => ({
      storefrontId,
      config,
      look,
      preview: false,
      embedded,
      count: view?.count ?? handle?.count ?? 0,
      view,
      status,
      open,
      setOpen,
      add,
      setQuantity,
      remove,
      undo,
      restore,
      refresh,
      lastAdded,
      announcement,
      cartId: handle?.id ?? view?.id ?? null,
    }),
    [
      storefrontId,
      config,
      look,
      embedded,
      view,
      handle,
      status,
      open,
      setOpen,
      add,
      setQuantity,
      remove,
      undo,
      restore,
      refresh,
      lastAdded,
      announcement,
    ],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

/**
 * A cart drawn from fixed data: the storefront designer's artboard and the
 * lab. Every control works on the page (open, close), nothing is sent.
 */
export function CartPreviewProvider({
  storefrontId,
  config,
  view,
  look = CART_LOOK,
  embedded = false,
  initiallyOpen = false,
  children,
}: {
  storefrontId: string;
  config: CartPageConfig;
  view: CartView | null;
  look?: CartLook;
  embedded?: boolean;
  initiallyOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const value = useMemo<CartContextValue>(
    () => ({
      storefrontId,
      config,
      look,
      preview: true,
      embedded,
      count: view?.count ?? 0,
      view,
      status: "idle",
      open,
      setOpen,
      add: async () => ({ ok: true }),
      setQuantity: async () => null,
      remove: async () => {},
      undo: null,
      restore: async () => {},
      refresh: async () => {},
      lastAdded: null,
      announcement: "",
      cartId: view?.id ?? null,
    }),
    [storefrontId, config, look, embedded, view, open],
  );
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}
