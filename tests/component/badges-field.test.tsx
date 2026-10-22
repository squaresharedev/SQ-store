import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import userEvent from "@testing-library/user-event";
import { cleanup, fireEvent, render, screen, waitFor, within } from "../setup/render";
import { invalidInput } from "@/lib/errors";
import { msg } from "@/i18n/types";

// The check a written badge goes through before it is added: a server action,
// so a spy here. Clean unless a spec says otherwise.
const checkBadgeLabelMock = vi.fn();
vi.mock("@/lib/products/badge-actions", () => ({
  checkBadgeLabel: (label: unknown) => checkBadgeLabelMock(label),
}));

import { BadgesField } from "@/components/products/BadgesField";
import { badgesSnapshot, type BadgeFormValue } from "@/components/products/form-values";
import { BADGES_MAX, BADGES_ON_PHOTO_MAX } from "@/types/product";

afterEach(cleanup);
// jsdom does not implement window.matchMedia; the Popover under both pickers
// reads it. Same stub as color-picker.test.tsx.
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
beforeEach(() => {
  checkBadgeLabelMock.mockReset();
  checkBadgeLabelMock.mockResolvedValue({ ok: true });
});

/** The field with real state around it, and that state printed for asserts. */
function Harness({ initial = [] }: { initial?: BadgeFormValue[] }) {
  const [badges, setBadges] = useState(initial);
  return (
    <>
      <BadgesField inputId="badges" badges={badges} onChange={setBadges} />
      <output data-testid="state">{JSON.stringify(badgesSnapshot(badges))}</output>
    </>
  );
}

const state = () => JSON.parse(screen.getByTestId("state").textContent ?? "[]") as { icon: string; label: string }[];
const row = (label: string, localId = label, extra: Partial<BadgeFormValue> = {}): BadgeFormValue => ({
  localId,
  icon: "star",
  label,
  color: "ink",
  placement: "beside",
  ...extra,
});
const labelInputs = () => [...document.querySelectorAll<HTMLInputElement>("[data-product-badge-label]")];

async function openPicker(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Search or write your own" }));
  return screen.getByRole("combobox", { name: "Search badges" });
}

describe("BadgesField: one-click badges", () => {
  it("offers the common badges and the search before any are added", () => {
    render(<Harness />);
    expect(screen.getByText("Add a badge")).toBeTruthy();
    for (const name of ["Loved by 1,000+ people", "Eco friendly", "Handmade", "Free shipping"]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
    expect(screen.getByRole("button", { name: "Search or write your own" })).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Badges" })).toBeNull();
  });

  it("lands a badge with a number with that number selected, so typing replaces it", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Loved by 1,000+ people" }));

    const [input] = labelInputs();
    expect(input!.value).toBe("Loved by 1,000+ people");
    expect(document.activeElement).toBe(input);
    expect(input!.value.slice(input!.selectionStart!, input!.selectionEnd!)).toBe("1,000");

    await user.keyboard("250");
    expect(state()).toEqual([{ icon: "heart", label: "Loved by 250+ people", color: "red" }]);
    // Offered once: it is on the product now.
    expect(screen.queryByRole("button", { name: "Loved by 1,000+ people" })).toBeNull();
  });

  it("hands focus back to the search when the button that was pressed goes away", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Eco friendly" }));
    expect(state()).toEqual([{ icon: "leaf", label: "Eco friendly", color: "green" }]);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Search or write your own" }));
  });
});

describe("BadgesField: the search", () => {
  it("lists every ready-made badge under its group before anything is typed", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const search = await openPicker(user);
    expect(document.activeElement).toBe(search);
    const listbox = screen.getByRole("listbox", { name: "Badges" });
    expect(within(listbox).getByRole("group", { name: "Trust and service" })).toBeTruthy();
    expect(within(listbox).getByRole("group", { name: "About the product" })).toBeTruthy();
    expect(within(listbox).getAllByRole("option").length).toBe(31);
  });

  it("finds badges by the words people search with, and Enter adds the highlighted one", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const search = await openPicker(user);
    await user.type(search, "refund");

    const options = screen.getAllByRole("option").map((option) => option.textContent);
    expect(options).toEqual(expect.arrayContaining(["30-day money-back guarantee", "Free returns"]));
    // Words that are not a preset are also offered as the seller's own.
    expect(options.at(-1)).toBe("Add “refund”");

    await user.keyboard("{ArrowDown}");
    const active = search.getAttribute("aria-activedescendant")!;
    const chosen = document.getElementById(active)!.textContent;
    await user.keyboard("{Enter}");

    expect(state().map((badge) => badge.label)).toEqual([chosen]);
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(checkBadgeLabelMock).not.toHaveBeenCalled();
  });

  it("shows a badge already on the product as added, and never highlights it", async () => {
    const user = userEvent.setup();
    render(<Harness initial={[row("Handmade")]} />);
    const search = await openPicker(user);
    await user.type(search, "handmade");

    const handmade = screen.getByRole("option", { name: /Handmade/ });
    expect(handmade.getAttribute("aria-disabled")).toBe("true");
    expect(within(handmade).getByText("Added")).toBeTruthy();
    expect(screen.getByText("This product already has that badge.")).toBeTruthy();
    // Typed words equal to one already there are not offered again.
    expect(screen.queryByRole("option", { name: /^Add “/ })).toBeNull();
    expect(search.getAttribute("aria-activedescendant")).not.toBe(handmade.id);
  });

  it("adds the seller's own words on Enter when no preset answers all of them", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const search = await openPicker(user);
    // "Handmade" answers one word of three: offered, but not what Enter takes.
    await user.type(search, "Handmade in Lisbon");
    expect(screen.getByRole("option", { name: "Handmade" })).toBeTruthy();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(state()).toEqual([{ icon: "hand-heart", label: "Handmade in Lisbon", color: "pink" }]));
    expect(checkBadgeLabelMock).toHaveBeenCalledWith("Handmade in Lisbon");
  });

  it("takes the preset on Enter when it answers every word typed", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const search = await openPicker(user);
    await user.type(search, "plant based{Enter}");
    expect(state()).toEqual([{ icon: "vegan", label: "Vegan", color: "green" }]);
    expect(checkBadgeLabelMock).not.toHaveBeenCalled();
  });

  it("checks words the seller wrote before adding them, and starts them with a fitting icon", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const search = await openPicker(user);
    await user.type(search, "Handmade in Lisbon");
    await user.click(screen.getByRole("option", { name: "Add “Handmade in Lisbon”" }));

    expect(checkBadgeLabelMock).toHaveBeenCalledWith("Handmade in Lisbon");
    expect(state()).toEqual([{ icon: "hand-heart", label: "Handmade in Lisbon", color: "pink" }]);
  });

  it("does not add words the check refuses, and says why under the field", async () => {
    checkBadgeLabelMock.mockResolvedValue({
      ok: false,
      error: invalidInput(
        msg("Errors.products.badgeRefused.message", { label: "Best weed in town" }),
        msg("Errors.products.badgeRefused.fix", { email: "support@squareshare.eu" }),
      ),
    });
    const user = userEvent.setup();
    render(<Harness />);
    const search = await openPicker(user);
    await user.type(search, "Best weed in town{Enter}");

    expect(await screen.findByText(/“Best weed in town” breaks the platform rules/)).toBeTruthy();
    expect(state()).toEqual([]);
    expect(screen.getByRole("combobox")).toBeTruthy();

    // A new attempt clears the old reason.
    await user.type(search, "!");
    expect(screen.queryByText(/breaks the platform rules/)).toBeNull();
  });

  it("says something went wrong rather than adding, when the check cannot be reached", async () => {
    checkBadgeLabelMock.mockRejectedValue(new Error("Failed to fetch"));
    const user = userEvent.setup();
    render(<Harness />);
    const search = await openPicker(user);
    await user.type(search, "Locally roasted{Enter}");
    expect(await screen.findByText(/Failed to fetch/)).toBeTruthy();
    expect(state()).toEqual([]);
  });

  it("closes on Escape without adding anything", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const search = await openPicker(user);
    await user.type(search, "vegan");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(state()).toEqual([]);
  });
});

describe("BadgesField: the rows", () => {
  it("edits the words in place and changes the icon from the grid", async () => {
    const user = userEvent.setup();
    render(<Harness initial={[row("Organic")]} />);
    const input = screen.getByLabelText("Words for badge 1");
    await user.clear(input);
    await user.type(input, "Certified organic");

    await user.click(screen.getByRole("button", { name: "Icon and colour for badge 1" }));
    const grid = screen.getByRole("group", { name: "Choose an icon" });
    expect(within(grid).getByRole("button", { name: "Star" }).getAttribute("aria-pressed")).toBe("true");
    await user.click(within(grid).getByRole("button", { name: "Sprout" }));

    expect(state()).toEqual([{ icon: "sprout", label: "Certified organic" }]);
    expect(screen.queryByRole("group", { name: "Choose an icon" })).toBeNull();
  });

  it("walks the icon grid with the arrow keys", async () => {
    const user = userEvent.setup();
    render(<Harness initial={[row("Organic")]} />);
    await user.click(screen.getByRole("button", { name: "Icon and colour for badge 1" }));
    // Opens on the chosen icon, "Star", the third in the list.
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Star");
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Rosette");
    // Down is a whole row of six.
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement?.getAttribute("data-badge-icon-choice")).toBe("gift");
    await user.keyboard("{ArrowLeft}{Enter}");
    expect(state()[0]!.icon).toBe("gem");
  });

  it("reorders and removes, keeping focus on the list", async () => {
    const user = userEvent.setup();
    render(<Harness initial={[row("One"), row("Two"), row("Three")]} />);

    await user.click(screen.getByRole("button", { name: "Move badge 1 later" }));
    expect(state().map((badge) => badge.label)).toEqual(["Two", "One", "Three"]);
    expect((screen.getByRole("button", { name: "Move badge 1 earlier" }) as HTMLButtonElement).disabled).toBe(true);

    await user.click(screen.getByRole("button", { name: "Remove badge 2" }));
    expect(state().map((badge) => badge.label)).toEqual(["Two", "Three"]);
    // Its neighbour takes the focus its own buttons had.
    expect(document.activeElement).toBe(screen.getByLabelText("Words for badge 2"));
  });

  it("marks the later of two rows that say the same thing", () => {
    render(<Harness initial={[row("Vegan", "a"), row("VEGAN", "b")]} />);
    const [first, second] = labelInputs();
    expect(first!.getAttribute("aria-invalid")).toBeNull();
    expect(second!.getAttribute("aria-invalid")).toBe("true");
  });

  it(`stops offering more at ${BADGES_MAX} and says why`, () => {
    const full = Array.from({ length: BADGES_MAX }, (_, index) => row(`Badge ${index + 1}`));
    render(<Harness initial={full} />);
    expect(screen.getByText(`That's ${BADGES_MAX} badges, the most one product can show. Remove one to add another.`)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Search or write your own" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Eco friendly" })).toBeNull();
  });

  it("publishes a datapoint for every badge's words and icon", () => {
    render(<Harness initial={[row("Eco friendly", "x", { icon: "leaf" })]} />);
    const field = document.querySelector('[data-product-field="badges"]')!;
    expect(field.getAttribute("data-product-value")).toBe("1");
    expect(document.querySelector('[data-product-field="badge.0.label"]')).toBe(labelInputs()[0]);
    expect(document.querySelector('[data-product-field="badge.0.icon"]')!.getAttribute("data-product-value")).toBe("leaf");
  });
});

describe("BadgesField: colours", () => {
  it("gives a ready-made badge its own colour, and a written one the closest preset's", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Eco friendly" }));
    const search = await openPicker(user);
    await user.type(search, "Handmade in Lisbon{Enter}");
    await waitFor(() =>
      expect(state()).toEqual([
        { icon: "leaf", label: "Eco friendly", color: "green" },
        { icon: "hand-heart", label: "Handmade in Lisbon", color: "pink" },
      ]),
    );
  });

  it("changes the colour without closing, and the drawings show it", async () => {
    const user = userEvent.setup();
    render(<Harness initial={[row("Organic", "o", { icon: "sprout" })]} />);
    await user.click(screen.getByRole("button", { name: "Icon and colour for badge 1" }));
    const colours = screen.getByRole("group", { name: "Choose a colour" });
    expect(within(colours).getByRole("button", { name: "Same as the text" }).getAttribute("aria-pressed")).toBe("true");
    expect(within(colours).getAllByRole("button")).toHaveLength(9);

    await user.click(within(colours).getByRole("button", { name: "Green" }));
    expect(state()).toEqual([{ icon: "sprout", label: "Organic", color: "green" }]);
    // Still open, so the icon can be chosen in the same visit, drawn in green.
    const grid = screen.getByRole("group", { name: "Choose an icon" });
    const leaf = within(grid).getByRole("button", { name: "Leaf" });
    expect((leaf.querySelector("svg") as SVGElement).style.color).toBe("rgb(22, 163, 74)");
    await user.click(leaf);
    expect(state()).toEqual([{ icon: "leaf", label: "Organic", color: "green" }]);
    expect(screen.queryByRole("group", { name: "Choose a colour" })).toBeNull();

    // Back to the page's own ink: stored as nothing at all.
    await user.click(screen.getByRole("button", { name: "Icon and colour for badge 1" }));
    await user.click(screen.getByRole("button", { name: "Same as the text" }));
    expect(state()).toEqual([{ icon: "leaf", label: "Organic" }]);
    expect(document.querySelector('[data-product-field="badge.0.color"]')!.getAttribute("data-product-value")).toBe("ink");
  });
});

describe("BadgesField: where a badge goes", () => {
  it("moves a badge onto a corner of the photo and back, from its row", async () => {
    const user = userEvent.setup();
    render(<Harness initial={[row("Vegan", "v")]} />);
    await user.click(screen.getByRole("button", { name: "Where badge 1 goes" }));
    const picker = screen.getByRole("group", { name: "Where it goes" });
    expect(within(picker).getByRole("button", { name: "Beside the product" }).getAttribute("aria-pressed")).toBe("true");
    await user.click(within(picker).getByRole("button", { name: "On the photo, top right" }));
    expect(state()).toEqual([{ icon: "star", label: "Vegan", placement: "photo-top-right" }]);
    expect(screen.queryByRole("group", { name: "Where it goes" })).toBeNull();
    expect(document.querySelector('[data-product-field="badge.0.placement"]')!.getAttribute("data-product-value")).toBe(
      "photo-top-right",
    );

    // The preview shows it there.
    expect(document.querySelector('[data-badge-preview-corner="photo-top-right"]')!.textContent).toBe("Vegan");
    expect(document.querySelector("[data-badge-preview-beside]")!.textContent).toBe("");

    await user.click(screen.getByRole("button", { name: "Where badge 1 goes" }));
    await user.click(screen.getByRole("button", { name: "Beside the product" }));
    expect(state()).toEqual([{ icon: "star", label: "Vegan" }]);
  });

  it(`refuses a badge a corner once the photo holds ${BADGES_ON_PHOTO_MAX}, but lets those on it move`, async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initial={[
          row("One", "1", { placement: "photo-top-left" }),
          row("Two", "2", { placement: "photo-top-left" }),
          row("Three", "3", { placement: "photo-bottom-right" }),
          row("Four", "4"),
        ]}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Where badge 4 goes" }));
    let picker = screen.getByRole("group", { name: "Where it goes" });
    for (const corner of ["top left", "top right", "bottom left", "bottom right"]) {
      expect((within(picker).getByRole("button", { name: `On the photo, ${corner}` }) as HTMLButtonElement).disabled).toBe(true);
    }
    expect(screen.getByText(`The photo holds up to ${BADGES_ON_PHOTO_MAX} badges. Move one beside the product first.`)).toBeTruthy();
    await user.keyboard("{Escape}");

    await user.click(screen.getByRole("button", { name: "Where badge 1 goes" }));
    picker = screen.getByRole("group", { name: "Where it goes" });
    await user.click(within(picker).getByRole("button", { name: "On the photo, bottom left" }));
    expect(state()[0]).toEqual({ icon: "star", label: "One", placement: "photo-bottom-left" });
  });
});

describe("BadgesField: dragging in the preview", () => {
  // jsdom has no layout and no PointerEvent: the zones get rectangles of their
  // own, and pointer events are mouse events carrying a pointer id.
  const PHOTO = { left: 0, top: 0, width: 200, height: 200 };
  const BESIDE = { left: 220, top: 0, width: 200, height: 200 };
  const rect = (box: { left: number; top: number; width: number; height: number }) =>
    ({ ...box, right: box.left + box.width, bottom: box.top + box.height, x: box.left, y: box.top, toJSON: () => box }) as DOMRect;

  beforeAll(() => {
    if (!("PointerEvent" in window)) {
      class PointerEventStub extends MouseEvent {
        pointerId: number;
        constructor(type: string, init: PointerEventInit = {}) {
          super(type, init);
          this.pointerId = init.pointerId ?? 1;
        }
      }
      Object.defineProperty(window, "PointerEvent", { value: PointerEventStub, writable: true });
    }
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      const zone = this.getAttribute("data-badge-zone");
      if (zone === "photo") return rect(PHOTO);
      if (zone === "beside") return rect(BESIDE);
      return rect({ left: 230, top: 30, width: 80, height: 20 });
    });
  });

  function drag(label: string, to: { x: number; y: number }) {
    const pill = document.querySelector(`[data-badge-preview-pill="${label}"]`)!;
    fireEvent.pointerDown(pill, { button: 0, clientX: 240, clientY: 40, pointerId: 1 });
    fireEvent.pointerMove(pill, { clientX: (240 + to.x) / 2, clientY: (40 + to.y) / 2, pointerId: 1 });
    fireEvent.pointerMove(pill, { clientX: to.x, clientY: to.y, pointerId: 1 });
    fireEvent.pointerUp(pill, { clientX: to.x, clientY: to.y, pointerId: 1 });
  }

  it("drops a badge into the corner of the photo nearest the pointer", () => {
    render(<Harness initial={[row("Vegan", "v")]} />);
    drag("Vegan", { x: 30, y: 170 });
    expect(state()).toEqual([{ icon: "star", label: "Vegan", placement: "photo-bottom-left" }]);
    drag("Vegan", { x: 190, y: 10 });
    expect(state()).toEqual([{ icon: "star", label: "Vegan", placement: "photo-top-right" }]);
    drag("Vegan", { x: 300, y: 100 });
    expect(state()).toEqual([{ icon: "star", label: "Vegan" }]);
  });

  it("leaves a badge where it was when it is let go outside both places, or barely moved", () => {
    render(<Harness initial={[row("Vegan", "v")]} />);
    drag("Vegan", { x: 600, y: 600 });
    expect(state()).toEqual([{ icon: "star", label: "Vegan" }]);
    const pill = document.querySelector('[data-badge-preview-pill="Vegan"]')!;
    fireEvent.pointerDown(pill, { button: 0, clientX: 240, clientY: 40, pointerId: 1 });
    fireEvent.pointerUp(pill, { clientX: 242, clientY: 41, pointerId: 1 });
    expect(state()).toEqual([{ icon: "star", label: "Vegan" }]);
  });

  it("shows a dragged badge following the pointer, and the quarter it would land in", () => {
    render(<Harness initial={[row("Vegan", "v")]} />);
    const pill = document.querySelector('[data-badge-preview-pill="Vegan"]')!;
    fireEvent.pointerDown(pill, { button: 0, clientX: 240, clientY: 40, pointerId: 1 });
    fireEvent.pointerMove(pill, { clientX: 150, clientY: 160, pointerId: 1 });
    expect(document.querySelector("[data-badge-ghost]")).not.toBeNull();
    expect(document.querySelector('[data-badge-drop-active="yes"]')!.getAttribute("data-badge-drop")).toBe(
      "photo-bottom-right",
    );
    fireEvent.pointerCancel(pill, { pointerId: 1 });
    expect(document.querySelector("[data-badge-ghost]")).toBeNull();
    expect(state()).toEqual([{ icon: "star", label: "Vegan" }]);
  });

  it(`refuses a drop onto a full photo, says why, and keeps the badge beside the product`, () => {
    render(
      <Harness
        initial={[
          row("One", "1", { placement: "photo-top-left" }),
          row("Two", "2", { placement: "photo-top-right" }),
          row("Three", "3", { placement: "photo-bottom-right" }),
          row("Four", "4"),
        ]}
      />,
    );
    const pill = document.querySelector('[data-badge-preview-pill="Four"]')!;
    fireEvent.pointerDown(pill, { button: 0, clientX: 240, clientY: 40, pointerId: 1 });
    fireEvent.pointerMove(pill, { clientX: 20, clientY: 180, pointerId: 1 });
    expect(document.querySelector('[data-badge-drop-active="refused"]')).not.toBeNull();
    fireEvent.pointerUp(pill, { clientX: 20, clientY: 180, pointerId: 1 });
    expect(state()[3]).toEqual({ icon: "star", label: "Four" });
    expect(document.querySelector("[data-badge-preview-hint]")!.textContent).toBe(
      `The photo holds up to ${BADGES_ON_PHOTO_MAX} badges. Move one beside the product first.`,
    );
    // One already on the photo may still change corners.
    drag("One", { x: 20, y: 180 });
    expect(state()[0]).toEqual({ icon: "star", label: "One", placement: "photo-bottom-left" });
  });

  it("draws the preview with the seller's photo and title, and hides it from assistive technology", () => {
    render(
      <BadgesField
        inputId="b"
        badges={[row("Vegan", "v")]}
        onChange={() => {}}
        previewImageUrl="https://cdn.test/cover.jpg"
        previewTitle="Oak bench"
      />,
    );
    const preview = document.querySelector("[data-badge-preview]")!;
    expect(preview.getAttribute("aria-hidden")).toBe("true");
    expect(preview.querySelector("img")!.getAttribute("src")).toBe("https://cdn.test/cover.jpg");
    expect(preview.textContent).toContain("Oak bench");
    expect(screen.getByText("Drag a badge onto the photo, or beside the product.")).toBeTruthy();
  });
});
