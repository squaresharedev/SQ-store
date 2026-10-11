import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { cleanup, render, screen } from "../setup/render";
import { AmountField } from "@/components/ui/AmountField";

/**
 * The select-on-focus in AmountField, with the frame it waits for under the
 * test's control.
 *
 * It selects the figure a frame after focus so that typing replaces it. That
 * select must never land once typing has begun, or the next keystroke
 * replaces everything before it. The old guard compared the box's value to
 * what it held at focus, which is not enough: a keystroke the field REFUSES
 * (a sixth digit) leaves the value unchanged, so the select could still land
 * between two keystrokes. Whether it did depended on how fast the machine
 * was, which is how a plans-page test went red on CI some runs and not
 * others. Here the frame fires exactly when the test says.
 */
function Harness({ initial, max }: { initial: number; max: number }) {
  const [value, setValue] = React.useState(initial);
  return (
    <AmountField id="amount" label="Sales per month" value={value} max={max} onChange={setValue} currency="EUR" />
  );
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const field = () => screen.getByLabelText("Sales per month") as HTMLInputElement;
const selected = (input: HTMLInputElement) => (input.selectionEnd ?? 0) - (input.selectionStart ?? 0);

describe("AmountField: selecting the figure on focus", () => {
  it("selects it when nothing has been typed, so typing replaces it", async () => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] });
    const user = userEvent.setup();
    render(<Harness initial={10000} max={10000} />);

    await user.click(field());
    vi.advanceTimersByTime(50);
    expect(selected(field())).toBe("10000".length);

    await user.keyboard("42");
    await user.tab();
    expect(field().value).toBe("42");
  });

  it("does not select it once a key has been pressed, even one the field refuses", async () => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] });
    const user = userEvent.setup();
    render(<Harness initial={10000} max={10000} />);

    await user.click(field());
    // A sixth digit: refused, so the box still reads exactly what it did.
    await user.keyboard("9");
    expect(field().value).toBe("10000");

    vi.advanceTimersByTime(50);
    expect(selected(field())).toBe(0);

    // And so the next key adds to the figure instead of replacing it.
    await user.keyboard("9");
    await user.tab();
    expect(field().value).toBe("10,000");
  });
});
