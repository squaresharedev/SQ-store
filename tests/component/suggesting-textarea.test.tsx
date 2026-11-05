import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import userEvent from "@testing-library/user-event";
import { act, cleanup, render, screen } from "../setup/render";
import { SuggestingTextarea } from "@/components/ui/SuggestingTextarea";

// The grey next words, as a seller meets them: asked after a pause with the
// cursor at the end, Tab takes them, typing the same letters keeps the rest,
// anything else or Esc makes them go, an answer for old text is dropped, and
// "Turn off" is there while the field is in use. The model is a stub.

afterEach(cleanup);

const LABELS = {
  idle: "AI suggests the next words as you type.",
  offered: "adds the grey text. Esc hides it.",
  accept: "Add the suggested words",
  announce: "Suggestion:",
  turnOff: "Turn off",
};

function Field({ suggest, onTurnOff }: { suggest: ((text: string) => Promise<string | null>) | null; onTurnOff?: () => void }) {
  const [value, setValue] = useState("");
  return (
    <SuggestingTextarea
      aria-label="Description"
      value={value}
      onChange={setValue}
      suggest={suggest}
      labels={LABELS}
      onTurnOff={onTurnOff}
    />
  );
}

const field = () => screen.getByRole("textbox", { name: "Description" });
const grey = () => document.querySelector("[data-next-words]")?.textContent ?? null;

/** Lets the pause before asking run out, and the answer arrive. */
const pause = () => act(async () => vi.advanceTimersByTimeAsync(600));

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("SuggestingTextarea", () => {
  it("asks after a pause at the end, and Tab adds the grey words", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const suggest = vi.fn(async () => "350 ml.");
    render(<Field suggest={suggest} />);
    await user.click(field());
    expect(screen.getByText(LABELS.idle)).toBeInTheDocument();

    await user.type(field(), "A mug that holds ");
    expect(suggest).not.toHaveBeenCalled();
    await pause();
    expect(suggest).toHaveBeenCalledTimes(1);
    expect(suggest).toHaveBeenCalledWith("A mug that holds ");
    expect(grey()).toBe("350 ml.");
    expect(field()).toHaveAccessibleDescription("Tab adds the grey text. Esc hides it.");
    expect(screen.getByText("Suggestion: 350 ml.")).toBeInTheDocument();

    await user.keyboard("{Tab}");
    expect(field()).toHaveValue("A mug that holds 350 ml.");
    expect(field()).toHaveFocus();
    expect(grey()).toBeNull();
  });

  it("keeps the rest on offer while the same letters are typed, and drops it on anything else", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<Field suggest={async () => "350 ml."} />);
    await user.type(field(), "Holds ");
    await pause();
    await user.type(field(), "35");
    expect(grey()).toBe("0 ml.");
    await user.type(field(), "x");
    expect(grey()).toBeNull();
  });

  it("hides on Esc, and Tab then moves on as usual", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <>
        <Field suggest={async () => "350 ml."} />
        <button type="button">Next</button>
      </>,
    );
    await user.type(field(), "Holds ");
    await pause();
    await user.keyboard("{Escape}");
    expect(grey()).toBeNull();
    expect(field()).toHaveValue("Holds ");
  });

  it("drops an answer for text that has changed since", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    let answer: (words: string) => void = () => {};
    const suggest = vi.fn(() => new Promise<string | null>((resolve) => (answer = resolve)));
    render(<Field suggest={suggest} />);
    await user.type(field(), "Holds ");
    await pause();
    await user.type(field(), "about");
    await act(async () => answer("350 ml."));
    expect(grey()).toBeNull();
    expect(field()).toHaveValue("Holds about");
  });

  it("asks nothing with the cursor away from the end", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const suggest = vi.fn(async () => "350 ml.");
    render(<Field suggest={suggest} />);
    await user.type(field(), "Holds ");
    await user.keyboard("{ArrowLeft}{ArrowLeft}");
    await pause();
    expect(suggest).not.toHaveBeenCalled();
  });

  it("offers the way out while the field is in use, and is a plain field when off", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onTurnOff = vi.fn();
    const { rerender } = render(<Field suggest={async () => null} onTurnOff={onTurnOff} />);
    expect(screen.queryByRole("button", { name: LABELS.turnOff })).toBeNull();
    await user.click(field());
    await user.click(screen.getByRole("button", { name: LABELS.turnOff }));
    expect(onTurnOff).toHaveBeenCalled();

    rerender(<Field suggest={null} />);
    expect(screen.queryByText(LABELS.idle)).toBeNull();
    expect(field()).not.toHaveAttribute("aria-describedby");
  });
});
