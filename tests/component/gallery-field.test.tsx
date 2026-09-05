import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GalleryField } from "@/components/products/GalleryField";
import type { GalleryFormImage } from "@/components/products/form-values";
import { GALLERY_MAX, type ProductOptionGroup } from "@/types/product";

afterEach(cleanup);

// The move-to control is the app's own Select, which keeps the active option
// in view when its list opens. jsdom has no scrollIntoView; the stub is the
// whole of what these tests need.
Element.prototype.scrollIntoView = vi.fn();

const COLOUR = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const RED = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BLUE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SIZE = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const LARGE = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

const GROUPS: ProductOptionGroup[] = [
  {
    id: COLOUR,
    name: "Colour",
    display: "swatch",
    options: [
      { id: RED, name: "Red", swatch: "#cc0000", available: true },
      { id: BLUE, name: "Blue", swatch: "#0000cc", available: true },
    ],
  },
  {
    id: SIZE,
    name: "Size",
    display: "chip",
    options: [{ id: LARGE, name: "Large", available: true }],
  },
];

function photo(overrides: Partial<GalleryFormImage> = {}): GalleryFormImage {
  return {
    localId: crypto.randomUUID(),
    key: `images/owner/${crypto.randomUUID()}-photo.jpg`,
    file: null,
    previewUrl: "https://cdn.test/photo.jpg",
    alt: "",
    ...overrides,
  };
}

const file = (name: string) => new File(["x"], name, { type: "image/png" });

describe("GalleryField — grouping and upload", () => {
  it("with no options yet, uploads land in one plain bucket", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<GalleryField inputId="gallery" images={[]} optionGroups={[]} onChange={onChange} />);

    expect(screen.getByText("Photos")).toBeInTheDocument();
    expect(screen.queryByText("Every version")).toBeNull();

    const input = document.getElementById("gallery-general") as HTMLInputElement;
    await user.upload(input, file("a.png"));
    expect(onChange).toHaveBeenCalledTimes(1);
    const [[added]] = onChange.mock.calls;
    expect(added).toHaveLength(1);
    expect(added[0].optionId).toBeUndefined();
    expect(added[0].file?.name).toBe("a.png");
  });

  it("gives every option across every group its own upload target", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <GalleryField inputId="gallery" images={[]} optionGroups={GROUPS} onChange={onChange} />,
    );

    expect(screen.getByText("Every version")).toBeInTheDocument();
    expect(screen.getByText("Red")).toBeInTheDocument();
    expect(screen.getByText("Blue")).toBeInTheDocument();
    // The second axis gets buckets too: which one changes the photo is the
    // seller's business, not this component's guess.
    expect(screen.getByText("Large")).toBeInTheDocument();

    const redInput = document.getElementById(`gallery-${RED}`) as HTMLInputElement;
    await user.upload(redInput, file("red.png"));
    expect(onChange.mock.calls[0]![0][0].optionId).toBe(RED);

    const largeInput = document.getElementById(`gallery-${LARGE}`) as HTMLInputElement;
    await user.upload(largeInput, file("large.png"));
    expect(onChange.mock.calls[1]![0][0].optionId).toBe(LARGE);
  });

  it("heads each bucket with its group, so two axes can share an option name", () => {
    const onChange = vi.fn();
    render(
      <GalleryField inputId="gallery" images={[]} optionGroups={GROUPS} onChange={onChange} />,
    );
    // One heading per option, so both colours carry "Colour:" and the lone
    // size carries "Size:".
    expect(screen.getAllByText("Colour:")).toHaveLength(2);
    expect(screen.getAllByText("Size:")).toHaveLength(1);
  });

  it("reassigns a photo to a different option through its own select, without deleting it", async () => {
    const user = userEvent.setup();
    const image = photo({ optionId: RED });
    const onChange = vi.fn();
    render(
      <GalleryField
        inputId="gallery"
        images={[image]}
        optionGroups={GROUPS}
        onChange={onChange}
      />,
    );

    // The app's own Select, not a native one: a listbox opened from a
    // combobox, so the move is a click on the target's row.
    await user.click(screen.getByRole("combobox", { name: /which version this photo is shown for/i }));
    await user.click(screen.getByRole("option", { name: "Move to: Colour: Blue" }));
    expect(onChange).toHaveBeenLastCalledWith([{ ...image, optionId: BLUE }]);
  });

  it("reorders a photo only among its own bucket's siblings", async () => {
    const user = userEvent.setup();
    const redA = photo({ optionId: RED, alt: "red-a" });
    const redB = photo({ optionId: RED, alt: "red-b" });
    const blueA = photo({ optionId: BLUE, alt: "blue-a" });
    const onChange = vi.fn();
    render(
      <GalleryField
        inputId="gallery"
        images={[redA, blueA, redB]}
        optionGroups={GROUPS}
        onChange={onChange}
      />,
    );

    // redA and redB swap places; blueA — a different bucket — stays exactly
    // where it was in between them, proving the move is scoped to its own
    // option rather than the whole list.
    const moveLater = within(
      document.querySelector(`[data-gallery-photo="${redA.localId}"]`)!,
    ).getByRole("button", { name: /move photo later/i });
    await user.click(moveLater);
    expect(onChange).toHaveBeenLastCalledWith([redB, blueA, redA]);
  });

  it("stops accepting uploads once the global cap is reached", async () => {
    const user = userEvent.setup();
    const images = Array.from({ length: GALLERY_MAX }, () => photo());
    const onChange = vi.fn();
    render(
      <GalleryField inputId="gallery" images={images} optionGroups={[]} onChange={onChange} />,
    );

    expect(screen.getByText(/limit reached/i)).toBeInTheDocument();
    const input = document.getElementById("gallery-general") as HTMLInputElement;
    expect(input).toBeDisabled();
    await user.upload(input, file("overflow.png")).catch(() => {});
    expect(onChange).not.toHaveBeenCalled();
  });
});
