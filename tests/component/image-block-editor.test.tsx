import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IMAGE_ALT_MAX, type ImageBlock } from "@/types/storefront";
import { ImageBlockEditor } from "@/components/storefront/ImageBlockEditor";

/**
 * The inspector card for an uploaded element. Patches emit on every change
 * (no save step), and the two controls that depend on each other — fit and
 * framing — must stay in step: there is nothing to reposition once the whole
 * image is visible.
 */

afterEach(cleanup);

const KEY =
  "elements/11111111-2222-4333-8444-555555555555/66666666-7777-4888-8999-aaaaaaaaaaaa-logo.svg";

function imageBlock(overrides: Partial<ImageBlock> = {}): ImageBlock {
  return {
    type: "image",
    id: "00000000-0000-4000-8000-000000000001",
    key: KEY,
    alt: "",
    x: 0,
    y: 0,
    w: 1,
    h: 1,
    ...overrides,
  };
}

function renderEditor(block: ImageBlock = imageBlock(), canFrame = true) {
  const onUpdate = vi.fn();
  const onFrame = vi.fn();
  const onDuplicate = vi.fn();
  const onRemove = vi.fn();
  render(
    <ImageBlockEditor
      block={block}
      canFrame={canFrame}
      onUpdate={onUpdate}
      onFrame={onFrame}
      onDuplicate={onDuplicate}
      onRemove={onRemove}
    />,
  );
  return { onUpdate, onFrame, onDuplicate, onRemove };
}

describe("ImageBlockEditor — fit", () => {
  it("shows Fill as the current choice when the block has no fit stored", () => {
    renderEditor();
    expect(screen.getByRole("button", { name: "Fill" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Fit" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("patches the fit when the other option is pressed", async () => {
    const user = userEvent.setup();
    const { onUpdate } = renderEditor();
    await user.click(screen.getByRole("button", { name: "Fit" }));
    expect(onUpdate).toHaveBeenCalledWith({ fit: "contain" });
  });

  it("reflects a stored contain fit", () => {
    renderEditor(imageBlock({ fit: "contain" }));
    expect(screen.getByRole("button", { name: "Fit" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});

describe("ImageBlockEditor — framing", () => {
  it("offers repositioning while the image is cropped to fill", async () => {
    const user = userEvent.setup();
    const { onFrame } = renderEditor();
    await user.click(screen.getByRole("button", { name: "Reposition image" }));
    expect(onFrame).toHaveBeenCalledTimes(1);
  });

  it("hides repositioning under Fit — nothing is cropped, so there is no crop to move", () => {
    renderEditor(imageBlock({ fit: "contain" }));
    expect(screen.queryByRole("button", { name: "Reposition image" })).toBeNull();
  });

  it("disables repositioning while there is no artwork loaded to frame", () => {
    renderEditor(imageBlock(), false);
    expect(screen.getByRole("button", { name: "Reposition image" })).toBeDisabled();
  });
});

describe("ImageBlockEditor — alt text", () => {
  it("shows the stored description and patches on typing", async () => {
    const user = userEvent.setup();
    const { onUpdate } = renderEditor(imageBlock({ alt: "Our" }));
    const field = screen.getByLabelText("Description");
    expect(field).toHaveValue("Our");
    await user.type(field, "!");
    expect(onUpdate).toHaveBeenCalledWith({ alt: "Our!" });
  });

  it("caps the field at the schema's limit, so the input cannot outrun the save", () => {
    renderEditor();
    expect(screen.getByLabelText("Description")).toHaveAttribute(
      "maxlength",
      String(IMAGE_ALT_MAX),
    );
  });

  it("starts empty, which is the correct markup for decoration", () => {
    renderEditor();
    expect(screen.getByLabelText("Description")).toHaveValue("");
  });
});

describe("ImageBlockEditor — opacity and block actions", () => {
  it("reports the stored opacity", () => {
    // The number and the % unit are separate elements (number in an editable
    // input, unit in a sibling <span>), so getByText("40%") no longer works.
    renderEditor(imageBlock({ opacity: 40 }));
    expect(screen.getByDisplayValue("40")).toBeInTheDocument();
  });

  it("treats an absent opacity as fully opaque", () => {
    renderEditor();
    expect(screen.getByDisplayValue("100")).toBeInTheDocument();
  });

  it("duplicates and removes through their own callbacks", async () => {
    const user = userEvent.setup();
    const { onDuplicate, onRemove } = renderEditor();
    await user.click(screen.getByRole("button", { name: /Duplicate/ }));
    expect(onDuplicate).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: /Remove from grid/ }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });
});
