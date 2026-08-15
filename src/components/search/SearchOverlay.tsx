"use client";

import * as React from "react";
import {
  Bell,
  FileText,
  LayoutGrid,
  Plus,
  Receipt,
  Search as SearchIcon,
  Settings as SettingsIcon,
  Store,
  Users,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { infoTextClass, overlayCloseButtonClass, overlaySurfaceClass, transitionClass } from "@/components/ui/control-styles";
import { useIsMacPlatform } from "@/lib/hooks/useIsMacPlatform";
import { TYPING_DEBOUNCE_MS } from "@/lib/typing-debounce";
import { searchLocalRegistry } from "@/lib/search/registry";
import {
  buildRecentGroup,
  buildSnapshotGroups,
} from "@/lib/search/snapshot-groups";
import {
  MAX_QUERY_LENGTH,
  MIN_REMOTE_QUERY_LENGTH,
  type SearchApiResponse,
  type SearchGroup,
  type SearchResult,
  type SearchResultType,
  type SearchSnapshot,
} from "@/lib/search/types";
import type { TeamRole } from "@/lib/team/permissions";

/**
 * THE UNIVERSAL SEARCH PALETTE (the "maximized" state).
 *
 * TWO INDEXES, ONE LIST. Pages, settings sections, settings FIELDS and quick
 * actions are matched synchronously from the bundled registry; products,
 * orders, storefronts, team and notifications come from /api/search. The local
 * half needs no network, so the palette answers on the first keystroke and
 * stays useful when the remote half is slow, throttled, offline or broken. The
 * remote half is an enhancement layered on top, never a dependency.
 *
 * IT IS A COMBOBOX, NOT A DIALOG WITH A FIELD IN IT. DOM focus never leaves the
 * input; the highlighted row is tracked with aria-activedescendant. That is why
 * there is no Tab trap here (unlike Modal/Popover, which move focus INTO the
 * panel): a trap plus a live text field means every arrow key fights the caret.
 *
 * Props rather than context so the component can be rendered and driven whole
 * in a test; SearchProvider supplies them in the app.
 */

const REQUEST_TIMEOUT_MS = 5_000;
const RETRY_DELAY_MS = 1_000;

/** Breathing room kept between the panel and the viewport edges. */
const EDGE_GUTTER = 16;
/** 30rem: noticeably wider than the resting bar, without the near-half-screen
 *  spread the first cut had. */
const PANEL_WIDTH = 480;

/**
 * Where the anchored panel sits, and WHICH WAY IT GROWS.
 *
 * Rightward is the default and fits the dashboard, whose trigger sits at the
 * bar's left with nothing beside it. The storefront designer is the opposite
 * case: its trigger is a 36px icon button with the save state and the Save
 * button immediately to its right, and a panel growing rightward from there
 * expanded straight over Save (the panel is z-[60], so it wins).
 *
 * So when the full width does not fit to the right, the panel pins its RIGHT
 * edge to the trigger's and grows leftward instead, over the empty stretch of
 * bar rather than the controls. Collapsed it is the trigger's own width either
 * way, so the opening morph still starts pixel-matched on top of it.
 *
 * The leftward case sets `right` rather than a computed `left`: the pinned edge
 * then needs no arithmetic, and `width` stays the only animated property in
 * both directions.
 *
 * Exported for tests — the geometry is the whole behaviour here, and it is far
 * cheaper to assert on than to drive through a layout.
 */
export function anchoredPanelStyle(
  rect: DOMRect,
  expanded: boolean,
  viewportWidth: number,
): React.CSSProperties {
  const left = Math.max(rect.left, EDGE_GUTTER);
  const roomRight = viewportWidth - EDGE_GUTTER - left;
  const roomLeft = rect.right - EDGE_GUTTER;
  const growLeft = roomRight < PANEL_WIDTH && roomLeft > roomRight;
  // max(rect.width, …) so a cramped trigger never expands NARROWER than the
  // bar it is covering, which would read as the control shrinking.
  const width = Math.min(
    PANEL_WIDTH,
    Math.max(rect.width, growLeft ? roomLeft : roomRight),
  );
  return {
    top: rect.top,
    width: expanded ? width : rect.width,
    ...(growLeft
      ? { right: Math.max(EDGE_GUTTER, viewportWidth - rect.right) }
      : { left: Math.min(left, viewportWidth - width - EDGE_GUTTER) }),
  };
}

/** What the remote half is currently doing. Local results ignore all of it. */
type RemoteStatus = "idle" | "loading" | "ok" | "error" | "auth" | "throttled";

const ICONS: Record<SearchResultType, React.ComponentType<{ className?: string }>> = {
  page: LayoutGrid,
  action: Plus,
  settings: SettingsIcon,
  product: FileText,
  order: Receipt,
  storefront: Store,
  team: Users,
  notification: Bell,
};

/** Message shown under the input when the remote half could not answer. Local
 *  results are still on screen in every one of these cases, which is why none
 *  of them is phrased as a failure of the search itself. */
const REMOTE_NOTICE: Partial<Record<RemoteStatus, string>> = {
  error: "Can't reach the server — showing pages, settings and actions only.",
  auth: "Your session expired, so only pages and settings are shown.",
  throttled: "Searching too fast — showing pages, settings and actions only.",
};

export function SearchOverlay({
  open,
  onClose,
  role,
  navigate,
  snapshot = null,
  anchorRect = null,
  anchorsRef,
}: {
  open: boolean;
  onClose: () => void;
  /** The active account's role, for hiding actions it cannot perform. */
  role: TeamRole | null;
  /** How to go somewhere. Injected so the storefront designer can route this
   *  through its unsaved-changes guard instead of pushing straight away. */
  navigate: (href: string) => void;
  /** The prefetched entity index (SearchProvider warms it). Null degrades to
   *  registry + live search — nothing here is load-bearing. */
  snapshot?: SearchSnapshot | null;
  /** Rect of the trigger the palette should attach under, captured by the
   *  provider in the OPENING event handler. Null → centered fallback (mobile
   *  never gets one; the sheet ignores it regardless). */
  anchorRect?: DOMRect | null;
  /** The registered trigger elements, for re-measuring on window resize. */
  anchorsRef?: React.RefObject<Set<HTMLElement>>;
}) {
  const [query, setQuery] = React.useState("");
  const [remoteGroups, setRemoteGroups] = React.useState<SearchGroup[]>([]);
  const [remoteStatus, setRemoteStatus] = React.useState<RemoteStatus>("idle");
  /** The row the user arrowed or hovered onto. See `activeId` below. */
  const [chosenId, setChosenId] = React.useState<string | null>(null);
  // Same hook the trigger uses, so its ⌘K/Ctrl K chip and this one never
  // disagree about which platform they're on.
  const isMac = useIsMacPlatform();

  const inputRef = React.useRef<HTMLInputElement>(null);
  const listboxId = React.useId();
  const optionId = React.useCallback(
    (id: string) => `${listboxId}-${id}`,
    [listboxId],
  );

  const trimmed = query.trim();
  const wantsRemote = trimmed.length >= MIN_REMOTE_QUERY_LENGTH;

  // Local results are derived, not fetched: no effect, no loading state, no way
  // for them to lag the caret or disagree with what is in the box.
  const localGroups = React.useMemo(
    () => searchLocalRegistry(query, { role }),
    [query, role],
  );

  // Snapshot matches are just as derived — the cache was filled long before
  // the first keystroke, so entity names answer in the same render too.
  const snapshotGroups = React.useMemo(
    () => buildSnapshotGroups(snapshot, query),
    [snapshot, query],
  );

  // THE MERGE. Three sources, one list:
  //   registry (instant) + snapshot entities (instant) + live /api/search.
  // The live response is authoritative for any type it covers, so a live group
  // REPLACES its snapshot counterpart per type; snapshot groups only FILL IN
  // where live hasn't answered (yet, or at all). Result ids match across the
  // two sources, so the swap keeps aria-activedescendant pointing at the same
  // row. Remote rows and the remote status are both gated on the query still
  // being long enough to have asked — derived rather than cleared, so a
  // backspace below the threshold hides them in the same render. An empty
  // query leads with the snapshot's "Recent" rail when there is one.
  const groups = React.useMemo(() => {
    if (!trimmed) {
      const recent = buildRecentGroup(snapshot);
      return recent ? [recent, ...localGroups] : localGroups;
    }
    const live = wantsRemote ? remoteGroups : [];
    const liveTypes = new Set(live.map((group) => group.type));
    const fillIn = snapshotGroups.filter((group) => !liveTypes.has(group.type));
    return [...localGroups, ...fillIn, ...live];
  }, [trimmed, localGroups, snapshotGroups, remoteGroups, wantsRemote, snapshot]);
  const flat = React.useMemo(
    () => groups.flatMap((group) => group.results),
    [groups],
  );

  // ---- remote half ------------------------------------------------------

  // A monotonic request counter. Every response checks it before touching
  // state, so a slow early reply can never overwrite a newer one — the classic
  // typeahead bug where deleting a character brings the old results back.
  const seqRef = React.useRef(0);
  const abortRef = React.useRef<AbortController | null>(null);
  const retryRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const runRemoteSearch = React.useCallback(async (term: string) => {
    abortRef.current?.abort();
    // TWO controllers, deliberately. The OUTER one means "this search is no
    // longer wanted" (newer keystroke, palette closed). Each attempt gets its
    // own INNER controller for the deadline, with the outer abort forwarded
    // in. A single shared controller cannot retry after its own timeout —
    // once aborted it stays aborted, so attempt two dies on arrival. That was
    // exactly the failure being fixed: a cold route (dev compile, cold start)
    // blew the first deadline and the search gave up for good.
    const outer = new AbortController();
    abortRef.current = outer;
    const seq = ++seqRef.current;
    // Superseded by a newer keystroke. Checked before EVERY state write, which
    // is what makes an out-of-order response harmless rather than confusing.
    const stale = () => seqRef.current !== seq;

    setRemoteStatus("loading");

    // ONE retry, and for every transient failure shape: 5xx, timeout, network
    // error. Never for 4xx (identical twice) or 429 (spends a budget already
    // refusing us). A loop rather than recursion, so both attempts share the
    // seq and the outer controller and a keystroke during backoff cancels the
    // retry instead of racing it.
    for (let attempt = 0; attempt < 2; attempt++) {
      if (stale() || outer.signal.aborted) return;
      const inner = new AbortController();
      const forwardAbort = () => inner.abort();
      outer.signal.addEventListener("abort", forwardAbort, { once: true });
      const timeout = setTimeout(() => inner.abort(), REQUEST_TIMEOUT_MS);
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(term)}`, {
          signal: inner.signal,
          headers: { accept: "application/json" },
        });
        if (stale()) return;

        if (response.status === 401) {
          setRemoteGroups([]);
          setRemoteStatus("auth");
          return;
        }
        if (response.status === 429) {
          setRemoteGroups([]);
          setRemoteStatus("throttled");
          return;
        }
        if (response.status >= 500 && attempt === 0) {
          clearTimeout(timeout);
          await new Promise((resolve) => {
            retryRef.current = setTimeout(resolve, RETRY_DELAY_MS);
          });
          if (stale() || outer.signal.aborted) return;
          continue;
        }
        if (!response.ok) {
          setRemoteGroups([]);
          setRemoteStatus("error");
          return;
        }

        const body = (await response.json()) as SearchApiResponse;
        if (stale()) return;
        setRemoteGroups(body.groups ?? []);
        setRemoteStatus("ok");
        return;
      } catch {
        // The user cancelling (outer abort / newer seq) is not a failure.
        if (stale() || outer.signal.aborted) return;
        // Timeout or network error: worth the one retry too.
        if (attempt === 0) {
          clearTimeout(timeout);
          await new Promise((resolve) => {
            retryRef.current = setTimeout(resolve, RETRY_DELAY_MS);
          });
          if (stale() || outer.signal.aborted) return;
          continue;
        }
        setRemoteGroups([]);
        setRemoteStatus("error");
        return;
      } finally {
        clearTimeout(timeout);
        outer.signal.removeEventListener("abort", forwardAbort);
      }
    }
  }, []);

  React.useEffect(() => {
    if (!open) return;
    if (!wantsRemote) {
      // Nothing to ask for below the threshold. Only the in-flight request is
      // cancelled here; the stale ROWS are hidden by deriving them out below,
      // not by clearing state, so there is no frame where a shorter query
      // still shows a longer one's results.
      seqRef.current++;
      abortRef.current?.abort();
      return;
    }
    const timer = setTimeout(
      () => void runRemoteSearch(trimmed),
      TYPING_DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
  }, [open, trimmed, wantsRemote, runRemoteSearch]);

  // Leaving the palette cancels everything in flight, so a response can never
  // land against a closed overlay.
  React.useEffect(() => {
    if (open) return;
    seqRef.current++;
    abortRef.current?.abort();
    if (retryRef.current) clearTimeout(retryRef.current);
  }, [open]);

  // ...and closing RESETS it, so reopening is never the last search still up.
  // Adjusted during render (React's documented pattern for resetting state on a
  // prop change, as the Sidebar does for pathname) rather than in an effect,
  // which would paint the stale palette for a frame first.
  const [wasOpen, setWasOpen] = React.useState(open);
  // Resize can move the trigger while the palette is open; this override
  // (measured in the resize handler) then supersedes the rect the provider
  // captured at open time. Tri-state on purpose: `undefined` means "no resize
  // happened, trust the provider", while `null` means "a resize DID happen and
  // there is no anchor any more" (shrunk under the breakpoint) — collapsing
  // those two would resurrect the stale rect. Reset on every open/close flip.
  const [resizedRect, setResizedRect] = React.useState<DOMRect | null | undefined>(
    undefined,
  );
  // THE MORPH. First paint happens with the panel at the trigger's own size;
  // one frame later `expanded` flips and a CSS transition carries width and
  // max-height to their full values, so the old bar visibly GROWS into the
  // new one instead of being replaced by it. Reset on every open, so each
  // opening morphs, not just the first.
  const [expanded, setExpanded] = React.useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    setResizedRect(undefined);
    setExpanded(false);
    if (!open) {
      setQuery("");
      setRemoteGroups([]);
      setRemoteStatus("idle");
      setChosenId(null);
    }
  }

  React.useEffect(() => {
    if (!open) return;
    // rAF, not a timeout: the collapsed frame must actually PAINT before the
    // expanded styles land, or the browser coalesces both into one style and
    // no transition runs.
    const frame = requestAnimationFrame(() => setExpanded(true));
    return () => cancelAnimationFrame(frame);
  }, [open]);

  // The provider's capture is the first paint's truth; a resize re-measures.
  const effectiveAnchorRect = resizedRect === undefined ? anchorRect : resizedRect;

  // Track the trigger through window resizes while open (the top bar is
  // sticky, so scroll never moves it; resize is the only thing that can).
  React.useEffect(() => {
    if (!open || !anchorsRef) return;
    function update() {
      const visible = [...(anchorsRef?.current ?? [])].find(
        (el) => el.offsetParent !== null && el.getBoundingClientRect().width > 0,
      );
      setResizedRect(
        window.matchMedia("(min-width: 640px)").matches
          ? (visible?.getBoundingClientRect() ?? null)
          : null,
      );
    }
    window.addEventListener("resize", update, { passive: true });
    return () => window.removeEventListener("resize", update);
  }, [open, anchorsRef]);

  // ---- active option ----------------------------------------------------

  // The highlight is DERIVED, not stored: state holds only what the user
  // chose with the arrow keys, and the row actually highlighted is that choice
  // if it still exists, else the first result.
  //
  // Storing it directly and reconciling in an effect is the obvious version and
  // the wrong one — results change on every keystroke and again when the remote
  // half lands, so there is always a frame where aria-activedescendant points
  // at a row that is no longer rendered, which is a dangling reference for a
  // screen reader. Deriving makes that state unrepresentable.
  const activeId =
    chosenId && flat.some((result) => result.id === chosenId)
      ? chosenId
      : (flat[0]?.id ?? null);

  const moveActive = React.useCallback(
    (delta: 1 | -1) => {
      if (flat.length === 0) return;
      const index = flat.findIndex((result) => result.id === activeId);
      const next = flat[(index + delta + flat.length) % flat.length];
      if (!next) return;
      setChosenId(next.id);
      // getElementById rather than a selector: ids here embed a useId value and
      // a row id, and neither is guaranteed to be a valid CSS identifier.
      document
        .getElementById(optionId(next.id))
        ?.scrollIntoView({ block: "nearest" });
    },
    [activeId, flat, optionId],
  );

  const activate = React.useCallback(
    (result: SearchResult) => {
      if (!result.href) return;
      onClose();
      navigate(result.href);
    },
    [navigate, onClose],
  );

  // ---- open / close mechanics ------------------------------------------

  const panelRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    // Scroll lock is a SHEET behaviour. The anchored desktop expansion is a
    // dropdown, not a modal: the page behind stays live and scrollable (the
    // top bar is sticky, so the trigger — and the panel pinned to it — holds
    // still while content moves underneath, like any combobox).
    const anchored = anchorRect !== null;
    const previousOverflow = document.body.style.overflow;
    if (!anchored) document.body.style.overflow = "hidden";
    inputRef.current?.focus();
    return () => {
      if (!anchored) document.body.style.overflow = previousOverflow;
      // Focus goes back where it came from, so closing with Esc leaves the
      // keyboard user exactly where they were.
      previouslyFocused?.focus?.();
    };
  }, [open, anchorRect]);

  // With no scrim there is nothing to click to dismiss, so outside-click is
  // its own listener — capture phase, exactly like Popover.tsx, so an
  // ancestor's stopPropagation can never wedge the panel open. The click also
  // REACHES whatever it landed on (the wrapper is pointer-events-none): one
  // tap closes the search and does the thing, the way dropdowns behave.
  React.useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!panelRef.current?.contains(event.target as Node)) onClose();
    }
    document.addEventListener("pointerdown", onPointerDown, true);
    return () =>
      document.removeEventListener("pointerdown", onPointerDown, true);
  }, [open, onClose]);

  if (!open) return null;

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        moveActive(1);
        break;
      case "ArrowUp":
        event.preventDefault();
        moveActive(-1);
        break;
      case "Enter": {
        const result = flat.find((item) => item.id === activeId);
        if (!result) break; // Nothing highlighted: never navigate by accident.
        event.preventDefault();
        activate(result);
        break;
      }
      case "Escape":
        event.preventDefault();
        // Clear first, close second. One Esc undoing a long query is kinder
        // than one Esc throwing away the whole palette.
        if (query) setQuery("");
        else onClose();
        break;
      // Home/End and every other key fall through to the input, so the caret
      // behaves like a caret.
    }
  }

  // Same gate as the rows: a notice about a request we are no longer making
  // would be a lie about the results on screen.
  const effectiveStatus: RemoteStatus = wantsRemote ? remoteStatus : "idle";
  // With a snapshot on screen the failure is smaller than the stock message
  // claims: entity matches ARE showing, they're just cached rather than live.
  const notice =
    effectiveStatus === "error" && snapshot !== null
      ? "Live search unreachable — showing cached matches, pages and settings."
      : REMOTE_NOTICE[effectiveStatus];
  const count = flat.length;
  const status = !trimmed
    ? ""
    : effectiveStatus === "loading"
      ? "Searching…"
      : count === 0
        ? `No results for ${trimmed}`
        : `${count} result${count === 1 ? "" : "s"} for ${trimmed}`;

  // Anchored is desktop-only by construction (the provider never captures a
  // rect under the sm breakpoint), so the anchored branches below can use
  // plain, unprefixed classes.
  const anchored = effectiveAnchorRect !== null;

  return (
    // z-[60]: above the mobile drawer (z-50), which can be open behind this.
    // pointer-events-none: NO scrim and NO blocking — the page behind stays
    // fully interactive, and only the panel itself catches the pointer. The
    // search is an expansion of the bar, not a layer over the app.
    <div className="pointer-events-none fixed inset-0 z-[60]">
      <div
        ref={panelRef}
        role="dialog"
        // Modal only as the mobile sheet, which really does cover everything.
        // The anchored expansion leaves the page live, and claiming otherwise
        // would have a screen reader treat the whole app as inert.
        aria-modal={anchored ? undefined : "true"}
        aria-label="Search"
        // Anchored: a TRANSPARENT column sitting exactly on the trigger. Its
        // first child is a bar that pixel-matches the trigger it covers, so
        // what the user sees is THE SAME BAR — which then widens (the width
        // transition here) while the results drop in as their own card below.
        // It grows away from whatever is beside the trigger; see
        // anchoredPanelStyle.
        style={
          effectiveAnchorRect
            ? anchoredPanelStyle(effectiveAnchorRect, expanded, window.innerWidth)
            : undefined
        }
        className={cn(
          "pointer-events-auto absolute flex flex-col",
          anchored
            ? // Desktop, anchored (the normal case): no chrome of its own —
              // the bar and the card each carry theirs. Only width animates.
              "transition-[width] duration-slow ease-entrance motion-reduce:transition-none"
            : cn(
                // The shared panel from `sm` up; on mobile it is a full-screen
                // sheet, so the chrome is dropped there. `inset-0` follows the
                // VISUAL viewport, so when the on-screen keyboard opens the
                // sheet shrinks with it and the input stays above the keys.
                overlaySurfaceClass,
                "inset-0 overflow-hidden max-sm:border-0 max-sm:bg-background max-sm:shadow-none",
                // Desktop with no registered trigger (tests, future
                // surfaces): the centred palette in the upper third.
                "sm:inset-x-0 sm:bottom-auto sm:top-[10vh] sm:mx-auto sm:h-auto sm:max-h-[70vh] sm:w-[calc(100%-2rem)] sm:max-w-xl",
              ),
        )}
      >
        {/* THE BAR. Anchored: identical to the trigger underneath — same
            h-9, same border, same padding, same text size — so covering it is
            invisible and the expansion reads as that bar getting wider, never
            as a new control appearing. Sheet/fallback: the roomier row. */}
        <div
          className={
            anchored
              ? "flex h-9 shrink-0 items-center gap-2 rounded-none border border-input bg-background px-3"
              : "flex shrink-0 items-center gap-2 border-b border-border px-4 py-3"
          }
        >
          <SearchIcon
            className="size-4 shrink-0 text-muted-foreground"
            aria-hidden
          />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-label="Search"
            aria-autocomplete="list"
            aria-expanded={count > 0}
            // Only while the listbox actually exists — see the results block.
            aria-controls={count > 0 ? listboxId : undefined}
            aria-activedescendant={activeId ? optionId(activeId) : undefined}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder="Search products, orders, settings…"
            // THE CHARACTER LIMIT, in both forms on purpose.
            //
            // `maxLength` is the affordance: the browser refuses the 101st
            // character and clamps a paste, so the field behaves like a bounded
            // field rather than accepting text that will be rejected later.
            // The slice is the ENFORCEMENT, because maxLength is not applied to
            // every path that can set a value (an IME composition commits past
            // it in some browsers) and this is the value the request is built
            // from.
            //
            // It matters beyond tidiness. The server rejects anything over
            // MAX_QUERY_LENGTH with a 400, which the fetch below maps to
            // `error` — so without a client bound, a long paste reported "Can't
            // reach the server" for a query that reached it fine. It also
            // bounds the per-keystroke local work: the registry and snapshot
            // matchers NFD-normalise the term against every cached entity name
            // in the same render as the keystroke, which a pasted megabyte
            // turns into a frozen tab.
            maxLength={MAX_QUERY_LENGTH}
            value={query}
            onChange={(event) =>
              setQuery(event.target.value.slice(0, MAX_QUERY_LENGTH))
            }
            onKeyDown={onKeyDown}
            // Sheet: text-base, NOT text-sm — anything under 16px makes iOS
            // Safari zoom the page on focus. Anchored (desktop-only): text-sm,
            // matching the trigger this bar impersonates.
            className={cn(
              "min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground",
              anchored ? "text-sm" : "text-base",
            )}
          />
          {/* ONE X, with Escape's exact semantics: clears while there is
              text, closes once there isn't. Two side-by-side X buttons (a
              field-clear and a sheet-close) read as a coin toss on mobile —
              this way every press of the only X does the obvious next step,
              and keyboard (Esc) and touch behave identically. On desktop it
              exists only while there is text, purely as the field-clear
              (closing is Esc / a click outside). */}
          <button
            type="button"
            aria-label={query ? "Clear search" : "Close search"}
            // Keep focus in the input: a blur here would collapse the combobox.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              if (query) {
                setQuery("");
                inputRef.current?.focus();
              } else {
                onClose();
              }
            }}
            className={cn(
              overlayCloseButtonClass,
              // The shared size-9 X in the roomy sheet row; a size-8 inside
              // the anchored h-9 bar so it sits inset like a field affordance
              // rather than flush to the borders.
              anchored && "size-8",
              // Empty + desktop = nothing to clear and Esc closes: hidden.
              query ? "flex" : "flex sm:hidden",
            )}
          >
            <X className={anchored ? "size-4" : "size-5"} aria-hidden />
          </button>
          {/* The trigger's own ⌘K/Ctrl K chip, carried into the bar it became
              — Ctrl+K still closes from here (the provider's listener is on
              `document`, capture phase, so it fires whether or not this input
              has focus), and the chip is the reminder of that. It disappears
              the moment there is something to type instead of a shortcut to
              reach for, and never existed for touch (no keyboard, no reason
              for the hint). `hidden sm:flex`, like the input's own text-sm
              step, applies whether the panel actually anchored or fell back
              to the centred desktop layout. */}
          {!query && isMac !== null && (
            <kbd
              aria-hidden
              className="hidden shrink-0 rounded-none border border-border bg-muted px-1.5 py-0.5 font-inter text-[0.6875rem] leading-none text-muted-foreground sm:flex"
            >
              {isMac ? "⌘K" : "Ctrl K"}
            </kbd>
          )}
        </div>

        {/* Results. `overflow-y-auto` + `flex-1` gives the scrolling body.

            The SCROLLING ELEMENT IS THE LISTBOX ITSELF, not a wrapper. A plain
            scrollable div with no focusable content inside it cannot be
            scrolled by keyboard in Safari (axe: scrollable-region-focusable);
            the listbox can, because arrow keys walk its options and scroll each
            into view. `tabIndex={-1}` makes that reachability explicit without
            putting it in the tab order, which would pull focus out of the
            input and break the combobox.

            It is also rendered ONLY when it has options: an empty
            role="listbox" is a critical ARIA violation (the role requires
            option children), and the input's aria-controls is dropped to match
            rather than left naming an element that isn't there.

            ANCHORED, the results live in their OWN card, dropped under the bar
            with a visible gap: the bar is the bar, and this is the modal that
            opens beneath it. It unfolds (max-height + opacity) on the same
            tokens the bar widens with. Sheet/fallback render the same body
            directly inside the panel. */}
        {(() => {
          const body = (
            <>
              {count > 0 ? (
                <div
                  id={listboxId}
                  role="listbox"
                  aria-label="Search results"
                  tabIndex={-1}
                  className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-safe focus:outline-none"
                >
                  {groups.map((group) => (
                    <SearchResultGroup
                      key={`${group.type}:${group.label}`}
                      group={group}
                      activeId={activeId}
                      optionId={optionId}
                      onActivate={activate}
                      onHover={setChosenId}
                    />
                  ))}
                </div>
              ) : (
                <p className="flex-1 px-4 py-8 text-center font-inter text-sm text-muted-foreground">
                  {trimmed
                    ? `Nothing matches “${trimmed}”.`
                    : "Start typing to search."}
                </p>
              )}

              {/* Footer only when something needs SAYING (a degraded remote
                  half). The keyboard-hints bar it used to carry is gone: the
                  arrows and Esc work whether or not a legend says so, and the
                  legend cost a permanent row of chrome. */}
              {notice && (
                <div className="shrink-0 border-t border-border px-4 py-2">
                  <p
                    role="status"
                    className={infoTextClass}
                  >
                    {notice}
                  </p>
                </div>
              )}
            </>
          );

          if (!effectiveAnchorRect) return body;

          const below =
            effectiveAnchorRect.top + effectiveAnchorRect.height + 8;
          return (
            <div
              style={{
                // Hugs its content (the card is only as tall as its rows) up
                // to a cap: 540px keeps a typed search from running to the
                // floor, and the viewport bound covers genuinely short
                // screens. The cap is sized ABOVE the resting suggestions'
                // worst case (~524px: 3 Recent + 3 Actions + 3 Settings), so
                // the default state never scrolls; a long result list does.
                // Trimming suggestions and this number are one budget — grow
                // one, grow the other.
                maxHeight: expanded
                  ? Math.max(
                      160,
                      Math.min(window.innerHeight - below - 16, 540),
                    )
                  : 0,
                opacity: expanded ? 1 : 0,
              }}
              className={cn(
                overlaySurfaceClass,
                "mt-2 flex min-h-0 flex-col overflow-hidden",
                "transition-[max-height,opacity] duration-slow ease-entrance motion-reduce:transition-none",
              )}
            >
              {body}
            </div>
          );
        })()}

        {/* Result counts, announced politely. Permanently mounted so the first
            update after opening is not swallowed by the region appearing. */}
        <div aria-live="polite" aria-atomic="true" className="sr-only">
          {status}
        </div>
      </div>
    </div>
  );
}

function SearchResultGroup({
  group,
  activeId,
  optionId,
  onActivate,
  onHover,
}: {
  group: SearchGroup;
  activeId: string | null;
  optionId: (id: string) => string;
  onActivate: (result: SearchResult) => void;
  onHover: (id: string) => void;
}) {
  const headingId = React.useId();
  return (
    <div role="group" aria-labelledby={headingId}>
      <p
        id={headingId}
        className="px-4 pb-1 pt-3 font-inter text-xs font-medium uppercase tracking-wide text-muted-foreground"
      >
        {group.label}
      </p>
      {group.results.map((result) => {
        const Icon = ICONS[result.type];
        const active = result.id === activeId;
        return (
          <div
            key={result.id}
            id={optionId(result.id)}
            role="option"
            aria-selected={active}
            // Keep focus in the input when clicking a row, or the combobox
            // collapses before the click lands.
            //
            // MOUSE ONLY, and that is not a detail: preventing the default on a
            // TOUCH pointerdown also suppresses the synthesized click, so every
            // tap on a phone silently did nothing. Guarding on pointerType
            // keeps the desktop behaviour and gives touch its click back.
            onPointerDown={(event) => {
              if (event.pointerType === "mouse") event.preventDefault();
            }}
            onClick={() => onActivate(result)}
            onMouseMove={() => onHover(result.id)}
            className={cn(
              // min-h-11 keeps every row at a 44px touch target on mobile.
              "flex min-h-11 cursor-pointer items-center gap-3 px-4 py-2",
              transitionClass,
              active ? "bg-accent" : "hover:bg-accent/50",
            )}
          >
            <Icon
              className={cn(
                "size-4 shrink-0",
                active ? "text-foreground" : "text-muted-foreground",
              )}
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-foreground">
                {result.title}
              </span>
              {result.subtitle && (
                <span className="block truncate font-inter text-xs text-muted-foreground">
                  {result.subtitle}
                </span>
              )}
            </span>
            {result.badge && (
              <span className="shrink-0 rounded-full border border-border bg-muted px-1.5 py-px font-inter text-[0.6875rem] font-medium capitalize text-muted-foreground">
                {result.badge}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

