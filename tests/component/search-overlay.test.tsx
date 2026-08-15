import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";

afterEach(cleanup);

// jsdom implements neither of these, and the overlay uses both: scrollIntoView
// to keep the highlighted row visible, matchMedia because other chrome reads it.
beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
  Element.prototype.scrollIntoView = vi.fn();
});

import { TYPING_DEBOUNCE_MS } from "@/lib/typing-debounce";
import {
  SearchOverlay,
  anchoredPanelStyle,
} from "@/components/search/SearchOverlay";
import {
  EMPTY_SNAPSHOT,
  MAX_QUERY_LENGTH,
  type SearchApiResponse,
  type SearchSnapshot,
} from "@/lib/search/types";

const onClose = vi.fn();
const navigate = vi.fn();

function renderOverlay(props?: { open?: boolean; snapshot?: SearchSnapshot | null }) {
  return render(
    <SearchOverlay
      open={props?.open ?? true}
      onClose={onClose}
      role="owner"
      navigate={navigate}
      snapshot={props?.snapshot ?? null}
    />,
  );
}

/** A populated snapshot, as the provider would pass after warm-up. */
const SNAPSHOT: SearchSnapshot = {
  ...EMPTY_SNAPSHOT,
  products: [
    { id: "sp1", title: "Snapshot lantern", status: "active" },
    { id: "sp2", title: "Snapshot beacon", status: "draft" },
  ],
  storefronts: [{ id: "ss1", name: "Lantern shop" }],
  orders: [
    { id: "so1", product_title: "Snapshot lantern", buyer_email: "buyer@x.com", status: "paid" },
  ],
};

/** A resolved /api/search response. */
function remote(body: Partial<SearchApiResponse> = {}): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ query: "q", groups: [], ...body }),
  } as Response;
}

const PRODUCT_GROUP: SearchApiResponse["groups"][number] = {
  label: "Products",
  type: "product",
  results: [
    {
      id: "product:p1",
      type: "product",
      title: "Blue lantern",
      subtitle: "25.00 EUR",
      href: "/products/p1/edit",
    },
  ],
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock = vi.fn(async () => remote());
  vi.stubGlobal("fetch", fetchMock);
});

// ---- ARIA ---------------------------------------------------------------

describe("SearchOverlay — combobox semantics", () => {
  it("renders nothing when closed", () => {
    renderOverlay({ open: false });
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("exposes a combobox wired to a listbox", () => {
    renderOverlay();
    const input = screen.getByRole("combobox", { name: "Search" });
    expect(input).toHaveAttribute("aria-autocomplete", "list");
    expect(input).toHaveAttribute(
      "aria-controls",
      screen.getByRole("listbox", { name: "Search results" }).id,
    );
  });

  it("keeps DOM focus in the input, never on a result", async () => {
    const user = userEvent.setup();
    renderOverlay();
    const input = screen.getByRole("combobox");
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(document.activeElement).toBe(input);
  });

  it("marks exactly one option selected and points activedescendant at it", async () => {
    const user = userEvent.setup();
    renderOverlay();
    await user.type(screen.getByRole("combobox"), "products");
    const selected = screen
      .getAllByRole("option")
      .filter((option) => option.getAttribute("aria-selected") === "true");
    expect(selected).toHaveLength(1);
    expect(screen.getByRole("combobox")).toHaveAttribute(
      "aria-activedescendant",
      selected[0].id,
    );
  });

  it("reports collapsed when nothing matches", async () => {
    const user = userEvent.setup();
    renderOverlay();
    const input = screen.getByRole("combobox");
    expect(input).toHaveAttribute("aria-expanded", "true"); // suggestions
    await user.type(input, "zzzzqqqq");
    await waitFor(() =>
      expect(input).toHaveAttribute("aria-expanded", "false"),
    );
    expect(input).not.toHaveAttribute("aria-activedescendant");
  });

  it("renders no listbox at all when there are no options", async () => {
    // An empty role="listbox" is a CRITICAL axe violation (the role requires
    // option children), and aria-controls must not outlive the element it
    // names. Caught by the a11y scan; guarded here so it fails faster.
    const user = userEvent.setup();
    renderOverlay();
    await user.type(screen.getByRole("combobox"), "zzzzqqqq");
    await waitFor(() =>
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("combobox")).not.toHaveAttribute("aria-controls");
  });
});

// ---- keyboard -----------------------------------------------------------

describe("SearchOverlay — keyboard", () => {
  it("moves the highlight down and wraps at the end", async () => {
    const user = userEvent.setup();
    renderOverlay();
    await user.type(screen.getByRole("combobox"), "settings");
    const ids = screen.getAllByRole("option").map((option) => option.id);

    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("combobox")).toHaveAttribute(
      "aria-activedescendant",
      ids[1],
    );

    // Walk to the last option, then once more to wrap around to the first.
    for (let i = 1; i < ids.length; i++) await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("combobox")).toHaveAttribute(
      "aria-activedescendant",
      ids[0],
    );
  });

  it("wraps backwards from the first option to the last", async () => {
    const user = userEvent.setup();
    renderOverlay();
    await user.type(screen.getByRole("combobox"), "settings");
    const ids = screen.getAllByRole("option").map((option) => option.id);
    await user.keyboard("{ArrowUp}");
    expect(screen.getByRole("combobox")).toHaveAttribute(
      "aria-activedescendant",
      ids[ids.length - 1],
    );
  });

  it("Enter opens the highlighted result and closes the palette", async () => {
    const user = userEvent.setup();
    renderOverlay();
    await user.type(screen.getByRole("combobox"), "payments");
    await user.keyboard("{Enter}");
    expect(navigate).toHaveBeenCalledWith("/payments");
    expect(onClose).toHaveBeenCalled();
  });

  it("Enter with no results navigates nowhere", async () => {
    const user = userEvent.setup();
    renderOverlay();
    await user.type(screen.getByRole("combobox"), "zzzzqqqq");
    await user.keyboard("{Enter}");
    expect(navigate).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Escape clears the query first, and only then closes", async () => {
    const user = userEvent.setup();
    renderOverlay();
    const input = screen.getByRole("combobox");
    await user.type(input, "lantern");

    await user.keyboard("{Escape}");
    expect(input).toHaveValue("");
    expect(onClose).not.toHaveBeenCalled();

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("leaves Home and End to the caret", async () => {
    const user = userEvent.setup();
    renderOverlay();
    const input = screen.getByRole("combobox") as HTMLInputElement;
    await user.type(input, "settings");
    const before = input.getAttribute("aria-activedescendant");
    await user.keyboard("{Home}{End}");
    expect(input).toHaveAttribute("aria-activedescendant", before ?? "");
  });
});

// ---- pointer ------------------------------------------------------------

describe("SearchOverlay — pointer", () => {
  it("clicking a result opens it without blurring the input", async () => {
    const user = userEvent.setup();
    renderOverlay();
    const input = screen.getByRole("combobox");
    await user.type(input, "payments");
    const option = screen
      .getAllByRole("option")
      .find((element) => within(element).queryByText("Payments"));
    await user.click(option!);
    expect(navigate).toHaveBeenCalledWith("/payments");
  });

  it("the clear button empties the query and keeps focus in the input", async () => {
    const user = userEvent.setup();
    renderOverlay();
    const input = screen.getByRole("combobox");
    await user.type(input, "lantern");
    await user.click(screen.getByRole("button", { name: "Clear search" }));
    expect(input).toHaveValue("");
    expect(document.activeElement).toBe(input);
  });
});

// ---- local index --------------------------------------------------------

describe("SearchOverlay — the local half", () => {
  it("suggests useful intents before anything is typed — and never nav tabs", () => {
    renderOverlay();
    expect(screen.getAllByRole("option").length).toBeGreaterThan(0);
    // Curated groups only: what search exists to make reachable. The pages
    // live in the sidebar already, so they are never recommended.
    expect(screen.getByRole("group", { name: "Actions" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Settings" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Pages" })).not.toBeInTheDocument();
    expect(screen.getByText("Password")).toBeInTheDocument();
    expect(screen.getByText("Export my data")).toBeInTheDocument();
  });

  it("still finds pages by query even though they are never suggested", async () => {
    const user = userEvent.setup();
    renderOverlay();
    await user.type(screen.getByRole("combobox"), "analytics");
    expect(screen.getByRole("group", { name: "Pages" })).toBeInTheDocument();
    expect(screen.getByText("Analytics")).toBeInTheDocument();
  });

  it("answers on the first keystroke without waiting for the network", async () => {
    const user = userEvent.setup();
    renderOverlay();
    await user.type(screen.getByRole("combobox"), "o");
    expect(screen.getAllByRole("option").length).toBeGreaterThan(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("finds a settings field by what someone would call it", async () => {
    const user = userEvent.setup();
    renderOverlay();
    await user.type(screen.getByRole("combobox"), "log out");
    expect(screen.getByText("Sign out")).toBeInTheDocument();
  });

  it("hides write actions from a viewer", async () => {
    const user = userEvent.setup();
    render(
      <SearchOverlay open onClose={onClose} role="viewer" navigate={navigate} />,
    );
    await user.type(screen.getByRole("combobox"), "new product");
    expect(screen.queryByText("New product")).not.toBeInTheDocument();
  });
});

// ---- remote index -------------------------------------------------------

describe("SearchOverlay — the remote half", () => {
  it("does not call the network below the minimum query length", async () => {
    const user = userEvent.setup();
    renderOverlay();
    await user.type(screen.getByRole("combobox"), "a");
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("merges remote results in alongside the local ones", async () => {
    fetchMock.mockResolvedValue(remote({ groups: [PRODUCT_GROUP] }));
    const user = userEvent.setup();
    renderOverlay();
    await user.type(screen.getByRole("combobox"), "lantern");
    expect(await screen.findByText("Blue lantern")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Products" })).toBeInTheDocument();
  });

  it("sends the query url-encoded", async () => {
    const user = userEvent.setup();
    renderOverlay();
    await user.type(screen.getByRole("combobox"), "shoes & socks");
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      encodeURIComponent("shoes & socks"),
    );
  });

  it("drops remote results when the query falls back below the threshold", async () => {
    fetchMock.mockResolvedValue(remote({ groups: [PRODUCT_GROUP] }));
    const user = userEvent.setup();
    renderOverlay();
    const input = screen.getByRole("combobox");
    await user.type(input, "lantern");
    expect(await screen.findByText("Blue lantern")).toBeInTheDocument();

    await user.clear(input);
    await user.type(input, "l");
    await waitFor(() =>
      expect(screen.queryByText("Blue lantern")).not.toBeInTheDocument(),
    );
  });
});

// ---- the character limit ------------------------------------------------

describe("SearchOverlay — character limit", () => {
  it("declares the limit on the field itself", async () => {
    renderOverlay();
    expect(screen.getByRole("combobox")).toHaveAttribute(
      "maxlength",
      String(MAX_QUERY_LENGTH),
    );
  });

  it("clamps a value that arrives past maxLength anyway", async () => {
    // `maxLength` is the browser's affordance and does not cover every path
    // that can set a value — fireEvent.change is the same kind of bypass an
    // IME commit is. The slice in onChange is the enforcement, so the box must
    // hold the capped string, not the pasted one.
    renderOverlay();
    const input = screen.getByRole("combobox") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "x".repeat(5_000) } });
    expect(input.value).toHaveLength(MAX_QUERY_LENGTH);
  });

  it("never sends the server a query it is going to reject", async () => {
    // The route 400s past MAX_QUERY_LENGTH, and the fetch below maps a 400 to
    // "Can't reach the server" — a lie about a request that arrived fine. The
    // bound exists so that request is never made in the first place.
    renderOverlay();
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "lantern".repeat(500) } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const sent = new URL(String(fetchMock.mock.calls[0][0]), "http://localhost")
      .searchParams.get("q");
    expect(sent).not.toBeNull();
    expect(sent!.length).toBeLessThanOrEqual(MAX_QUERY_LENGTH);
  });
});

// ---- resilience ---------------------------------------------------------

describe("SearchOverlay — it always works", () => {
  it("keeps local results and explains itself when the network is down", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    const user = userEvent.setup();
    renderOverlay();
    await user.type(screen.getByRole("combobox"), "settings");
    // The notice lands only after the retry cycle (fail → 1s backoff → fail).
    expect(
      await screen.findByText(/Can't reach the server/i, undefined, {
        timeout: 4000,
      }),
    ).toBeInTheDocument();
    // The whole point: the palette is still usable.
    expect(screen.getAllByRole("option").length).toBeGreaterThan(0);
  });

  it("says the session expired on a 401 rather than throwing the user out", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401 } as Response);
    const user = userEvent.setup();
    renderOverlay();
    await user.type(screen.getByRole("combobox"), "settings");
    expect(await screen.findByText(/session expired/i)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getAllByRole("option").length).toBeGreaterThan(0);
  });

  it("reports throttling on a 429 and does not retry into it", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 429 } as Response);
    const user = userEvent.setup();
    renderOverlay();
    await user.type(screen.getByRole("combobox"), "settings");
    expect(await screen.findByText(/too fast/i)).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a 500 exactly once, then gives up gracefully", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 } as Response);
    const user = userEvent.setup();
    renderOverlay();
    await user.type(screen.getByRole("combobox"), "settings");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2), {
      timeout: 3000,
    });
    expect(await screen.findByText(/Can't reach the server/i)).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("never lets a slow earlier response overwrite a newer one", async () => {
    const slow: SearchApiResponse = {
      query: "la",
      groups: [
        {
          label: "Products",
          type: "product",
          results: [
            { id: "product:old", type: "product", title: "STALE result", href: "/products/old/edit" },
          ],
        },
      ],
    };
    let resolveSlow: (value: Response) => void = () => {};
    fetchMock
      .mockImplementationOnce(
        () => new Promise<Response>((resolve) => (resolveSlow = resolve)),
      )
      .mockImplementationOnce(async () => remote({ groups: [PRODUCT_GROUP] }));

    const user = userEvent.setup();
    renderOverlay();
    const input = screen.getByRole("combobox");
    await user.type(input, "la");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    await user.type(input, "ntern");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Blue lantern")).toBeInTheDocument();

    // The first request finally answers, out of order and out of date.
    resolveSlow({
      ok: true,
      status: 200,
      json: async () => slow,
    } as Response);
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(screen.queryByText("STALE result")).not.toBeInTheDocument();
    expect(screen.getByText("Blue lantern")).toBeInTheDocument();
  });

  it("aborts the in-flight request when the palette closes", async () => {
    let signal: AbortSignal | undefined;
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise<Response>(() => {
          signal = init.signal ?? undefined;
        }),
    );
    const user = userEvent.setup();
    const view = renderOverlay();
    await user.type(screen.getByRole("combobox"), "lantern");
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    view.rerender(
      <SearchOverlay open={false} onClose={onClose} role="owner" navigate={navigate} />,
    );
    expect(signal?.aborted).toBe(true);
  });

  it("starts empty when reopened, never showing the last search's rows", async () => {
    fetchMock.mockResolvedValue(remote({ groups: [PRODUCT_GROUP] }));
    const user = userEvent.setup();
    const view = renderOverlay();
    await user.type(screen.getByRole("combobox"), "lantern");
    expect(await screen.findByText("Blue lantern")).toBeInTheDocument();

    view.rerender(
      <SearchOverlay open={false} onClose={onClose} role="owner" navigate={navigate} />,
    );
    view.rerender(
      <SearchOverlay open onClose={onClose} role="owner" navigate={navigate} />,
    );

    expect(screen.getByRole("combobox")).toHaveValue("");
    expect(screen.queryByText("Blue lantern")).not.toBeInTheDocument();
  });

  it("tells a dead end apart from a working search", async () => {
    const user = userEvent.setup();
    renderOverlay();
    await user.type(screen.getByRole("combobox"), "zzzzqqqq");
    expect(await screen.findByText(/Nothing matches/i)).toBeInTheDocument();
  });
});

// ---- where the anchored panel grows -------------------------------------

describe("anchoredPanelStyle", () => {
  const VIEWPORT = 1440;

  it("grows rightward from a trigger with room beside it (the dashboard bar)", () => {
    const rect = new DOMRect(24, 10, 320, 36);
    const style = anchoredPanelStyle(rect, true, VIEWPORT);
    expect(style.left).toBe(24);
    expect(style.right).toBeUndefined();
    expect(style.width).toBe(480);
  });

  it("grows leftward when the trigger is against the right end of its bar", () => {
    // The storefront designer: a 36px icon button with Save to its right.
    const rect = new DOMRect(1274, 10, 36, 36);
    const style = anchoredPanelStyle(rect, true, VIEWPORT);
    // Right edge pinned to the trigger's, so nothing to the right of it is
    // covered; the panel takes the empty bar to the LEFT instead.
    expect(style.right).toBe(VIEWPORT - rect.right);
    expect(style.left).toBeUndefined();
    expect(style.width).toBe(480);
  });

  it("starts collapsed at the trigger's width in both directions", () => {
    for (const rect of [
      new DOMRect(24, 10, 320, 36),
      new DOMRect(1274, 10, 36, 36),
    ]) {
      expect(anchoredPanelStyle(rect, false, VIEWPORT).width).toBe(rect.width);
    }
  });

  it("never expands narrower than the trigger it is covering", () => {
    // A wide trigger pinned near the right edge: expanding must not shrink it.
    const rect = new DOMRect(1100, 10, 324, 36);
    const style = anchoredPanelStyle(rect, true, VIEWPORT);
    expect(Number(style.width)).toBeGreaterThanOrEqual(rect.width);
  });

  it("keeps both edges inside the viewport", () => {
    const rect = new DOMRect(700, 10, 36, 36);
    const style = anchoredPanelStyle(rect, true, 760);
    // Right-aligned against a cramped viewport: the left edge still clears the
    // gutter rather than running off screen.
    expect(760 - Number(style.right) - Number(style.width)).toBeGreaterThanOrEqual(16);
  });

  it("pins the top to the trigger, so the bar covers it exactly", () => {
    const rect = new DOMRect(24, 10, 320, 36);
    expect(anchoredPanelStyle(rect, true, VIEWPORT).top).toBe(10);
  });
});

// ---- the anchored expansion ---------------------------------------------

describe("SearchOverlay — anchored expansion", () => {
  const RECT = new DOMRect(100, 10, 320, 36);

  function renderAnchored() {
    return render(
      <SearchOverlay
        open
        onClose={onClose}
        role="owner"
        navigate={navigate}
        snapshot={null}
        anchorRect={RECT}
      />,
    );
  }

  it("is not modal when anchored — the page behind stays live for AT", () => {
    renderAnchored();
    const dialog = screen.getByRole("dialog", { name: "Search" });
    expect(dialog).not.toHaveAttribute("aria-modal");
  });

  it("stays modal as the mobile/fallback sheet, which really covers all", () => {
    renderOverlay();
    expect(screen.getByRole("dialog", { name: "Search" })).toHaveAttribute(
      "aria-modal",
      "true",
    );
  });

  it("closes on a pointerdown outside the panel — no scrim to click", () => {
    renderAnchored();
    document.body.dispatchEvent(
      new Event("pointerdown", { bubbles: true }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not close on a pointerdown inside the panel", async () => {
    const user = userEvent.setup();
    renderAnchored();
    await user.click(screen.getByRole("combobox"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not lock page scroll when anchored", () => {
    renderAnchored();
    expect(document.body.style.overflow).not.toBe("hidden");
  });

  it("morphs open: first paint at the trigger's own width, then widens", async () => {
    renderAnchored();
    const dialog = screen.getByRole("dialog", { name: "Search" });
    // First paint: the visible bar IS the old bar — same width, same spot.
    expect(dialog).toHaveStyle({ width: "320px" });
    // A frame later the CSS transition target takes over (jsdom has no real
    // transitions, so the style flip itself is the observable).
    await waitFor(() => expect(dialog).toHaveStyle({ width: "480px" }));
  });

  it("keeps the bar and drops the results in a separate card below it", () => {
    renderAnchored();
    const dialog = screen.getByRole("dialog", { name: "Search" });
    // The dialog itself carries no panel chrome — it is a transparent column
    // holding the bar and the card, so the gap between them shows the page.
    expect(dialog.className).not.toContain("bg-popover");
    // The results card is its own bordered surface UNDER the bar (mt-2 gap),
    // and the listbox lives inside it.
    const card = screen.getByRole("listbox", { name: "Search results" })
      .parentElement as HTMLElement;
    expect(card.className).toContain("mt-2");
    expect(card.className).toContain("border");
    expect(card.className).toContain("bg-popover");
  });

  it("carries the trigger's own Ctrl K chip into the bar it became", () => {
    // jsdom's userAgent is not a Mac, so this is the same label the trigger
    // would show a Windows/Linux user for the identical shortcut.
    renderAnchored();
    expect(screen.getByText("Ctrl K")).toBeInTheDocument();
  });

  it("the chip disappears the moment there is something to type instead", async () => {
    const user = userEvent.setup();
    renderAnchored();
    expect(screen.getByText("Ctrl K")).toBeInTheDocument();
    await user.type(screen.getByRole("combobox"), "l");
    expect(screen.queryByText("Ctrl K")).not.toBeInTheDocument();
  });

  it("the chip comes back once the field is cleared back to empty", async () => {
    const user = userEvent.setup();
    renderAnchored();
    await user.type(screen.getByRole("combobox"), "lantern");
    expect(screen.queryByText("Ctrl K")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear search" }));
    expect(screen.getByText("Ctrl K")).toBeInTheDocument();
  });

  it("closes from the mobile X — the same affordance every modal wears", async () => {
    const user = userEvent.setup();
    renderOverlay();
    await user.click(screen.getByRole("button", { name: "Close search" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("the single X mirrors Escape: clears while there is text, then closes", async () => {
    // ONE X, never two side by side: with text it is the field-clear, empty
    // it is the sheet-close — the same two-step Escape already performs.
    const user = userEvent.setup();
    renderOverlay();
    await user.type(screen.getByRole("combobox"), "lantern");
    expect(
      screen.queryByRole("button", { name: "Close search" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear search" }));
    expect(screen.getByRole("combobox")).toHaveValue("");
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Close search" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("still locks page scroll as the sheet", () => {
    renderOverlay();
    expect(document.body.style.overflow).toBe("hidden");
  });
});

// ---- the snapshot half --------------------------------------------------

describe("SearchOverlay — the snapshot half", () => {
  it("leads the empty palette with a Recent rail when the snapshot has one", () => {
    renderOverlay({ snapshot: SNAPSHOT });
    expect(screen.getByRole("group", { name: "Recent" })).toBeInTheDocument();
    expect(screen.getByText("Snapshot lantern")).toBeInTheDocument();
    expect(screen.getByText("Lantern shop")).toBeInTheDocument();
  });

  it("shows no Recent rail for an empty snapshot", () => {
    renderOverlay({ snapshot: EMPTY_SNAPSHOT });
    expect(screen.queryByRole("group", { name: "Recent" })).not.toBeInTheDocument();
  });

  it("answers a 1-character query from the snapshot with zero network", async () => {
    const user = userEvent.setup();
    renderOverlay({ snapshot: SNAPSHOT });
    await user.type(screen.getByRole("combobox"), "l");
    // "Lantern shop" starts with the term; found before any request exists.
    expect(screen.getByText("Lantern shop")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps entity matches on screen when the live search is down — the whole point", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    const user = userEvent.setup();
    renderOverlay({ snapshot: SNAPSHOT });
    await user.type(screen.getByRole("combobox"), "lantern");
    // The softer notice, because cached entity rows ARE showing…
    expect(
      await screen.findByText(/showing cached matches/i, undefined, { timeout: 5000 }),
    ).toBeInTheDocument();
    // …and here they are: a storefront, findable with the endpoint dead.
    // (getAll: the title also appears as the matching order's product line.)
    expect(screen.getByText("Lantern shop")).toBeInTheDocument();
    expect(screen.getAllByText("Snapshot lantern").length).toBeGreaterThan(0);
  });

  it("replaces a snapshot group with the live one when it lands", async () => {
    fetchMock.mockResolvedValue(
      remote({
        groups: [
          {
            label: "Products",
            type: "product",
            results: [
              {
                // Same row id as the snapshot version — the live copy wins.
                id: "product:sp1",
                type: "product",
                title: "Snapshot lantern",
                subtitle: "25.00 EUR", // the live-only field proves the swap
                href: "/products/sp1/edit",
              },
            ],
          },
        ],
      }),
    );
    const user = userEvent.setup();
    renderOverlay({ snapshot: SNAPSHOT });
    await user.type(screen.getByRole("combobox"), "lantern");
    expect(await screen.findByText("25.00 EUR")).toBeInTheDocument();
    // One Products group, not a snapshot one and a live one stacked.
    expect(screen.getAllByRole("group", { name: "Products" })).toHaveLength(1);
    // Types the live response did NOT cover keep their snapshot fill-in.
    expect(screen.getByText("Lantern shop")).toBeInTheDocument();
  });
});

// ---- retry --------------------------------------------------------------

describe("SearchOverlay — retry", () => {
  it("retries once on a network error, not only on 5xx", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    const user = userEvent.setup();
    renderOverlay();
    await user.type(screen.getByRole("combobox"), "settings");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2), {
      timeout: 4000,
    });
    // Two failures → the honest notice; and no third attempt.
    expect(await screen.findByText(/Can't reach the server/i)).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("a timeout on attempt one does not kill attempt two", async () => {
    // First request hangs forever (a cold route compiling); second answers.
    // Under the old single-controller design the timeout abort poisoned the
    // retry — this is the regression guard for that exact bug.
    fetchMock
      .mockImplementationOnce(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener("abort", () =>
              reject(new DOMException("Aborted", "AbortError")),
            );
          }),
      )
      .mockImplementationOnce(async () => remote({ groups: [PRODUCT_GROUP] }));

    const user = userEvent.setup();
    renderOverlay();
    await user.type(screen.getByRole("combobox"), "lantern");
    // 5s deadline + 1s backoff + attempt two: give it 10s.
    expect(
      await screen.findByText("Blue lantern", undefined, { timeout: 10_000 }),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  }, 15_000);
});

// ---- announcements ------------------------------------------------------

describe("SearchOverlay — announcements", () => {
  function liveRegion(): HTMLElement {
    const region = document.querySelector('[aria-live="polite"]');
    if (!region) throw new Error("no live region");
    return region as HTMLElement;
  }

  it("stays silent until something is typed", () => {
    renderOverlay();
    expect(liveRegion()).toHaveTextContent("");
  });

  it("announces the result count", async () => {
    const user = userEvent.setup();
    renderOverlay();
    await user.type(screen.getByRole("combobox"), "payments");
    await waitFor(() =>
      expect(liveRegion().textContent).toMatch(/result.* for payments/i),
    );
  });

  it("announces an empty result set", async () => {
    const user = userEvent.setup();
    renderOverlay();
    await user.type(screen.getByRole("combobox"), "zzzzqqqq");
    await waitFor(() =>
      expect(liveRegion().textContent).toMatch(/No results for zzzzqqqq/i),
    );
  });
});


// ---- DEBOUNCE -----------------------------------------------------------

/**
 * A field that looks something up while you type spends a request, a Postgres
 * query and a rate-limit take per KEYSTROKE unless it waits. These hold the
 * search bar to one request per burst, at the one interval the whole product
 * shares (lib/typing-debounce).
 *
 * Typed with fireEvent rather than userEvent: each call is a single synchronous
 * change event, which is what lets fake timers step the debounce window
 * exactly. userEvent drives its own timers and deadlocks against them here.
 */
describe("SearchOverlay — debounce", () => {
  /** Type `word` one character at a time, letting `gap` ms pass between them. */
  async function typeAcross(input: HTMLElement, word: string, gap: number) {
    for (let i = 1; i <= word.length; i += 1) {
      fireEvent.change(input, { target: { value: word.slice(0, i) } });
      if (gap > 0) {
        await act(async () => {
          vi.advanceTimersByTime(gap);
        });
      }
    }
  }

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("asks the server once for a burst of typing, not once per keystroke", async () => {
    renderOverlay();
    const input = screen.getByRole("combobox");
    // Seven keystrokes, each one well inside the window.
    await typeAcross(input, "lantern", 40);
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(TYPING_DEBOUNCE_MS);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // And for the whole word, not for a prefix nobody asked about.
    expect(String(fetchMock.mock.calls[0][0])).toContain("lantern");
  });

  it("waits the full interval before it fires", async () => {
    renderOverlay();
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "lantern" },
    });

    await act(async () => {
      vi.advanceTimersByTime(TYPING_DEBOUNCE_MS - 1);
    });
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a pause long enough to settle does spend a second request", async () => {
    renderOverlay();
    const input = screen.getByRole("combobox");
    // Two bursts with a real settle between them: deliberate, so two requests
    // is right. This is the other half of the contract — the debounce delays
    // requests, it does not swallow them.
    await typeAcross(input, "lantern", 40);
    await act(async () => {
      vi.advanceTimersByTime(TYPING_DEBOUNCE_MS);
    });
    fireEvent.change(input, { target: { value: "lanterns" } });
    await act(async () => {
      vi.advanceTimersByTime(TYPING_DEBOUNCE_MS);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
