import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { cleanup, render, screen, within } from "../setup/render";
import { ToastProvider } from "@/components/ui/Toast";
import { ThemePanel } from "@/components/storefront/ThemePanel";
import { FinishControls } from "@/components/storefront/FinishControls";
import { TypographySection } from "@/components/storefront/TypographySection";
import { HeaderSection } from "@/components/storefront/HeaderSection";
import { CardStyleControls } from "@/components/storefront/CardStyleControls";
import { TextBlockEditor } from "@/components/storefront/TextBlockEditor";
import { LibraryPanel } from "@/components/storefront/LibraryPanel";
import { MarqueeLibraryEntry } from "@/components/storefront/MarqueeLibraryEntry";
import { settingById, type SettingRef } from "@/lib/storefront/setting-ref";
import { DEFAULT_STOREFRONT_CONFIG, resolveCardStyle, type StorefrontTheme, type TextBlock } from "@/types/storefront";
import { english } from "../setup/translate";

/**
 * THE EDITOR UPGRADE'S SEARCH ENTRIES OPEN SOMETHING THAT EXISTS. Each entry's
 * ref names a place in the editor; here that place is rendered, and the
 * control the entry is named after is looked for in it, by the entry's own
 * label. An entry whose control was moved or renamed fails here instead of
 * sending a seller to a panel that does not have it.
 */

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
});
afterEach(cleanup);

const THEME: StorefrontTheme = {
  ...DEFAULT_STOREFRONT_CONFIG.theme,
  fontPairing: "editorial",
  cardColor: "#ffffff",
};

const TEXT: TextBlock = {
  type: "text",
  id: "00000000-0000-4000-8000-000000000001",
  text: "Hello",
  variant: "body",
  align: "left",
  x: 0,
  y: 0,
  w: 2,
  h: 1,
};

const noop = () => {};

/** The Theme group's whole body, as ControlsPanel puts it together. */
function themeLook(): ReactElement {
  return (
    <ToastProvider>
      <ThemePanel theme={THEME} onChange={noop} backgroundImageUrl={null} onBackgroundImageChange={noop} />
      <FinishControls theme={THEME} onChange={noop} />
    </ToastProvider>
  );
}

function typography(): ReactElement {
  return <TypographySection theme={THEME} onChange={noop} fontUrl={null} onFontUrlChange={noop} />;
}

function header(): ReactElement {
  return <HeaderSection header={{ show: true, name: "Shop", bio: "" }} onChange={noop} />;
}

/** Product cards > Card style (its "More" is opened by the test). */
function cardStyle(): ReactElement {
  return <CardStyleControls value={resolveCardStyle(THEME)} onChange={noop} colorScope={{ theme: THEME, scope: "theme" }} />;
}

function library(): ReactElement {
  return (
    <LibraryPanel
      tab="shapes"
      onTabChange={noop}
      uploads={[]}
      uploading={false}
      uploadProgress={null}
      canAddBlocks
      onUpload={noop}
      onPlaceUpload={noop}
      onAddShape={noop}
      onAddBand={noop}
      onAddButton={noop}
      onClose={noop}
      moreBlocks={<MarqueeLibraryEntry onAdd={noop} disabled={false} />}
    />
  );
}

/** Where each new entry leads, and the words of the control it is named after
 *  that must be in what that place shows. */
const ENTRIES: { id: string; ref: SettingRef; host: "theme" | "typography" | "header" | "cards" | "text" | "library" }[] = [
  { id: "palette", ref: { kind: "theme", section: "look" }, host: "theme" },
  { id: "motion", ref: { kind: "theme", section: "look" }, host: "theme" },
  { id: "paper-texture", ref: { kind: "theme", section: "look" }, host: "theme" },
  { id: "font-pairing", ref: { kind: "group", group: "typography" }, host: "typography" },
  { id: "text-styles", ref: { kind: "group", group: "typography" }, host: "typography" },
  { id: "header-logo-menu", ref: { kind: "group", group: "header" }, host: "header" },
  { id: "card-color", ref: { kind: "cards", section: "cardStyle" }, host: "cards" },
  { id: "card-blend", ref: { kind: "cards", section: "cardStyle" }, host: "cards" },
  { id: "card-name-strip", ref: { kind: "cards", section: "cardStyle" }, host: "cards" },
  { id: "card-photo-shape", ref: { kind: "cards", section: "cardStyle" }, host: "cards" },
  { id: "card-shadow", ref: { kind: "cards", section: "cardStyle" }, host: "cards" },
  { id: "text-valign", ref: { kind: "block", field: "valign", types: ["text"] }, host: "text" },
  { id: "bands", ref: { kind: "library", tab: "shapes" }, host: "library" },
  { id: "button-block", ref: { kind: "library", tab: "shapes" }, host: "library" },
  { id: "scrolling-text", ref: { kind: "library", tab: "shapes" }, host: "library" },
];

async function show(host: (typeof ENTRIES)[number]["host"]) {
  const user = userEvent.setup();
  switch (host) {
    case "theme":
      render(themeLook());
      return;
    case "typography":
      render(typography());
      return;
    case "header":
      render(header());
      return;
    case "cards": {
      render(cardStyle());
      // The name strip, the photo's outline and the shadow wait behind "More".
      const more = screen.queryByRole("button", { name: "More" });
      if (more) await user.click(more);
      return;
    }
    case "text":
      render(
        <TextBlockEditor
          block={TEXT}
          accent="#171717"
          onUpdate={noop}
          onDuplicate={noop}
          onRemove={noop}
          summons={{ field: "valign", nonce: 1 }}
        />,
      );
      return;
    case "library":
      render(library());
      return;
  }
}

describe("every entry for the editor upgrade's controls", () => {
  it.each(ENTRIES)("$id opens $host, which has a control of that name", async ({ id, ref, host }) => {
    const entry = settingById(id);
    expect(entry, id).not.toBeNull();
    expect(entry!.ref).toEqual(ref);
    await show(host);
    const label = english(entry!.label);
    expect(label.length).toBeGreaterThan(0);
    if (host === "library") {
      // The drawer that ADDS it: the band and the button under Layout, the
      // strip under its own heading.
      expect(screen.getAllByText(label).length, label).toBeGreaterThan(0);
      return;
    }
    expect(screen.getAllByText(label).length, label).toBeGreaterThan(0);
  });

  it("points a block's own setting at the field the inspector marks", async () => {
    await show("text");
    const field = document.querySelector('[data-block-field="valign"]');
    expect(field).not.toBeNull();
    expect(within(field as HTMLElement).getByText(english("EditorType.panel.valign.label"))).toBeInTheDocument();
  });
});
