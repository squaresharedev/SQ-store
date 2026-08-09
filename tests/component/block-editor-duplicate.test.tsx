import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ShapeBlock, TextBlock } from "@/types/storefront";
import { ShapeBlockEditor } from "@/components/storefront/ShapeBlockEditor";
import { TextBlockEditor } from "@/components/storefront/TextBlockEditor";

/**
 * The inspector's Duplicate button: the no-keyboard half of copy/paste,
 * present on TEXT and SHAPE editors (product tiles deliberately have no
 * copy path — one block per product). Keyboard copy/paste itself is covered
 * end to end in tests/e2e/03-storefront.spec.ts.
 */

afterEach(cleanup);

const shapeBlock: ShapeBlock = {
  type: "shape",
  id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  kind: "star",
  color: "#171717",
  x: 0,
  y: 0,
  w: 1,
  h: 1,
};

const textBlock: TextBlock = {
  type: "text",
  id: "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff",
  text: "hello",
  variant: "heading",
  align: "left",
  x: 1,
  y: 0,
  w: 2,
  h: 1,
};

describe("inspector Duplicate button", () => {
  it("shape editor duplicates on click", async () => {
    const user = userEvent.setup();
    const onDuplicate = vi.fn();
    render(
      <ShapeBlockEditor
        block={shapeBlock}
        onUpdate={vi.fn()}
        onDuplicate={onDuplicate}
        onRemove={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Duplicate" }));
    expect(onDuplicate).toHaveBeenCalledTimes(1);
  });

  it("text editor duplicates on click", async () => {
    const user = userEvent.setup();
    const onDuplicate = vi.fn();
    render(
      <TextBlockEditor
        block={textBlock}
        accent="#171717"
        onUpdate={vi.fn()}
        onDuplicate={onDuplicate}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Duplicate" }));
    expect(onDuplicate).toHaveBeenCalledTimes(1);
  });
});
