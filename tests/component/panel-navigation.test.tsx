import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { DEFAULT_PRODUCT_PAGE_CONFIG, DEFAULT_STOREFRONT_CONFIG } from "@/types/storefront";
import { ToastProvider } from "@/components/ui/Toast";
import { PanelTabs, panelProps } from "@/components/ui/PanelTabs";
import { PanelBackRow, PanelMenu, PanelMenuItem } from "@/components/ui/PanelMenu";
import { ControlsPanel } from "@/components/storefront/ControlsPanel";
import { editorEntries } from "@/components/storefront/editor-search";
import { SettingTargetProvider } from "@/lib/storefront/setting-context";
import {
  PRODUCT_PAGE_HOTSPOTS,
  freshSettingRef,
  type SettingRef,
} from "@/lib/storefront/setting-ref";

/**
 * The two primitives the side panels navigate with, and the design panel that
 * spends them.
 *
 * What these pin is the thing the grouping exists for: a seller can always see
 * where they are and always get back. A submenu with no visible way out is
 * worse than the flat column it replaced.
 */

afterEach(cleanup);

// A summoned section scrolls itself into view; jsdom has no layout, so it has
// no scrollIntoView either. The stub is the whole of what the tests need.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

const themed = () => structuredClone(DEFAULT_STOREFRONT_CONFIG.theme);

describe("PanelTabs", () => {
  function Harness() {
    const [tab, setTab] = useState<"one" | "two">("one");
    return (
      <>
        <PanelTabs
          id="t"
          value={tab}
          options={[
            { value: "one", label: "One" },
            { value: "two", label: "Two" },
          ]}
          onChange={setTab}
          ariaLabel="Scope"
        />
        <div {...panelProps("t", tab)}>{tab === "one" ? "First" : "Second"}</div>
      </>
    );
  }

  it("ties each tab to the panel it labels", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const one = screen.getByRole("tab", { name: "One" });
    expect(one).toHaveAttribute("aria-selected", "true");

    // The pairing is what makes a tab announce its contents, so it is asserted
    // rather than assumed: the panel points back at the tab that selected it.
    const panel = screen.getByRole("tabpanel");
    expect(panel).toHaveAttribute("aria-labelledby", one.id);
    expect(one).toHaveAttribute("aria-controls", panel.id);

    await user.click(screen.getByRole("tab", { name: "Two" }));
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Second");
  });
});

describe("PanelMenu", () => {
  it("opens a group and gets back out again", async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    const onOpen = vi.fn();

    const { rerender } = render(
      <PanelMenu>
        <PanelMenuItem label="Typography" hint="Sans" onClick={onOpen} />
      </PanelMenu>,
    );

    const row = screen.getByRole("button", { name: /typography/i });
    // The hint is part of the row's name, so the current value is spoken with
    // the group rather than being colour or position alone.
    expect(row).toHaveAccessibleName(/sans/i);
    await user.click(row);
    expect(onOpen).toHaveBeenCalledTimes(1);

    rerender(<PanelBackRow title="Typography" onBack={onBack} />);
    await user.click(screen.getByRole("button", { name: /back/i }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

describe("ControlsPanel grouping", () => {
  // The background editor reports upload failures as toasts, so the panel only
  // mounts inside a provider.
  const controls = () => (
    <ToastProvider>
      <ControlsPanel
      theme={themed()}
      header={{ show: true, name: "", bio: "" }}
      onThemeChange={vi.fn()}
      onHeaderChange={vi.fn()}
      onCanvasChange={vi.fn()}
      backgroundImageUrl={null}
      onBackgroundImageChange={vi.fn()}
      customFontUrl={null}
      onCustomFontUrlChange={vi.fn()}
        showGrid={false}
        onShowGridChange={vi.fn()}
        productPage={DEFAULT_PRODUCT_PAGE_CONFIG}
        onProductPageChange={vi.fn()}
        shippingPolicy={{}}
        sellerIdentity={{}}
        searchEntries={editorEntries([], new Map())}
      />
    </ToastProvider>
  );

  it("opens on a menu of groups, not on a wall of controls", () => {
    render(controls());

    // PLT-02: role="list" was removed from PanelMenu (mixed content with the
    // search field violated axe). Use the data attribute instead.
    const menu = document.querySelector("[data-panel-menu]")!;
    expect(menu).not.toBeNull();
    expect(menu.querySelectorAll("[data-panel-menu-item]")).toHaveLength(7);
    // Nothing editable until a group is chosen: that IS the fix.
    expect(screen.queryByRole("slider")).not.toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    // The bucket named for its difficulty rather than its subject is gone.
    expect(screen.queryByText("Advanced")).not.toBeInTheDocument();
  });

  it("keeps the grid guide with the canvas, not with the saved theme", async () => {
    const user = userEvent.setup();
    render(controls());

    await user.click(screen.getByRole("button", { name: /^Theme/ }));
    expect(screen.queryByRole("switch", { name: "Show grid" })).toBeNull();

    await user.click(screen.getByRole("button", { name: /back/i }));
    await user.click(screen.getByRole("button", { name: /^Canvas/ }));
    expect(screen.getByRole("switch", { name: "Show grid" })).toBeVisible();
  });

  it("lets card style and price tag be open together", async () => {
    const user = userEvent.setup();
    render(controls());

    await user.click(screen.getByRole("button", { name: /^Product cards/ }));

    // Both halves stay reachable at once on purpose: the corner roundness in
    // one bounds the tag position in the other, so closing one to read the
    // other would hide the reason a spot is unavailable.
    const cardStyle = screen.getByRole("button", { name: "Card style" });
    const priceTag = screen.getByRole("button", { name: "Price tag" });
    await user.click(priceTag);

    expect(cardStyle).toHaveAttribute("aria-expanded", "true");
    expect(priceTag).toHaveAttribute("aria-expanded", "true");
  });
});

describe("ControlsPanel reopening a setting by name", () => {
  /**
   * A stand-in for StorefrontDesigner's own SettingTargetProvider: `open`
   * mirrors what openSetting/openProductPage actually do (clone the ref
   * before storing it), and the button simulates a seller clicking a product
   * page hotspot — which, on the real canvas, hands back the exact same
   * PRODUCT_PAGE_HOTSPOTS object every single time.
   */
  function Harness() {
    const [activeRef, setActiveRef] = useState<SettingRef | null>(null);
    const open = (ref: SettingRef) => setActiveRef(freshSettingRef(ref));
    return (
      <ToastProvider>
        <SettingTargetProvider
          value={{ activeRef, open, close: () => setActiveRef(null) }}
        >
          <button
            type="button"
            aria-label="Click the buy-button hotspot"
            onClick={() => open(PRODUCT_PAGE_HOTSPOTS.cta)}
          />
          <ControlsPanel
            theme={themed()}
            header={{ show: true, name: "", bio: "" }}
            onThemeChange={vi.fn()}
            onHeaderChange={vi.fn()}
            onCanvasChange={vi.fn()}
            backgroundImageUrl={null}
            onBackgroundImageChange={vi.fn()}
            customFontUrl={null}
            onCustomFontUrlChange={vi.fn()}
            showGrid={false}
            onShowGridChange={vi.fn()}
            productPage={DEFAULT_PRODUCT_PAGE_CONFIG}
            onProductPageChange={vi.fn()}
            shippingPolicy={{}}
            sellerIdentity={{}}
            searchEntries={editorEntries([], new Map())}
          />
        </SettingTargetProvider>
      </ToastProvider>
    );
  }

  it("brings the panel back after the seller navigated away by hand", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: "Click the buy-button hotspot" }));
    expect(screen.getByRole("button", { name: "Buy button" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );

    // The seller leaves it by hand: back to the menu, into an unrelated group.
    await user.click(screen.getByRole("button", { name: /back/i }));
    await user.click(screen.getByRole("button", { name: /^Theme/ }));
    expect(screen.queryByRole("button", { name: "Buy button" })).not.toBeInTheDocument();

    // Clicking the SAME hotspot again must still bring the panel back — not
    // get silently swallowed because the request looks unchanged.
    await user.click(screen.getByRole("button", { name: "Click the buy-button hotspot" }));
    expect(await screen.findByRole("button", { name: "Buy button" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });
});
