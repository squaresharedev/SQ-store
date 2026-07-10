import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

afterEach(cleanup);

// jsdom does not implement window.matchMedia; provide a stub.
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
import userEvent from "@testing-library/user-event";
import { DatePicker } from "@/components/ui/DatePicker";
import { Calendar } from "@/components/ui/Calendar";
import { startOfMonth, startOfDay, fullDateLabel } from "@/lib/format/calendar";

/** Exact accessible-name for a calendar day button (avoids substring ambiguity). */
const day = (year: number, month: number, d: number) =>
  fullDateLabel(new Date(year, month, d));

// Pin the system clock so "today" is deterministic.
// Using 2025-07-10 (Thursday, week starting Monday).
const FIXED_DATE = new Date(2025, 6, 10); // July 10 2025
const FIXED_YEAR = 2025;
const FIXED_MONTH = 6; // 0-indexed = July
const FIXED_DAY = 10;

beforeEach(() => {
  // Only fake the Date constructor so "today" is deterministic.
  // Leaving setTimeout/setInterval real prevents userEvent.click from timing out.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(FIXED_DATE);
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// DatePicker — single mode
// ---------------------------------------------------------------------------

describe("DatePicker single mode", () => {
  it("trigger has aria-haspopup=dialog", () => {
    render(
      <DatePicker mode="single" value={null} onChange={vi.fn()} placeholder="Pick a date" />,
    );
    expect(screen.getByRole("button")).toHaveAttribute("aria-haspopup", "dialog");
  });

  it("trigger aria-expanded=false when closed", () => {
    render(
      <DatePicker mode="single" value={null} onChange={vi.fn()} placeholder="Pick a date" />,
    );
    expect(screen.getByRole("button")).toHaveAttribute("aria-expanded", "false");
  });

  it("trigger aria-expanded=true after opening", async () => {
    const user = userEvent.setup({ delay: null });
    render(
      <DatePicker mode="single" value={null} onChange={vi.fn()} placeholder="Pick a date" />,
    );
    await user.click(screen.getByRole("button"));
    expect(screen.getByRole("button", { name: /pick a date|select date/i })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("clicking trigger opens the calendar popover", async () => {
    const user = userEvent.setup({ delay: null });
    render(
      <DatePicker mode="single" value={null} onChange={vi.fn()} placeholder="Pick a date" />,
    );
    await user.click(screen.getByRole("button"));
    expect(screen.getByRole("grid")).toBeInTheDocument();
  });

  it("selecting a day calls onChange with ISO YYYY-MM-DD string", async () => {
    const user = userEvent.setup({ delay: null });
    const onChange = vi.fn();
    render(
      <DatePicker mode="single" value={null} onChange={onChange} />,
    );
    await user.click(screen.getByRole("button"));

    // Click July 15, 2025.
    const day15 = screen.getByRole("button", { name: /15 July 2025/i });
    await user.click(day15);
    expect(onChange).toHaveBeenCalledWith("2025-07-15");
  });

  it("selecting a day closes the popover", async () => {
    const user = userEvent.setup({ delay: null });
    const onChange = vi.fn();
    render(
      <DatePicker mode="single" value={null} onChange={onChange} />,
    );
    await user.click(screen.getByRole("button"));
    const day = screen.getByRole("button", { name: /15 July 2025/i });
    await user.click(day);
    expect(screen.queryByRole("grid")).not.toBeInTheDocument();
  });

  it("displays the selected date in the trigger", () => {
    render(
      <DatePicker mode="single" value="2025-07-15" onChange={vi.fn()} />,
    );
    expect(screen.getByRole("button")).toHaveTextContent(/15/);
  });
});

// ---------------------------------------------------------------------------
// DatePicker — range mode
// ---------------------------------------------------------------------------

describe("DatePicker range mode", () => {
  it("first click sets the 'from' date", async () => {
    const user = userEvent.setup({ delay: null });
    const onChange = vi.fn();
    render(
      <DatePicker mode="range" value={{ from: null, to: null }} onChange={onChange} />,
    );
    await user.click(screen.getByRole("button"));
    await user.click(screen.getByRole("button", { name: day(2025, 6, 5) }));
    expect(onChange).toHaveBeenLastCalledWith({ from: "2025-07-05", to: null });
  });

  it("second click (later date) sets the 'to' date", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup({ delay: null });

    const { rerender } = render(
      <DatePicker mode="range" value={{ from: null, to: null }} onChange={onChange} />,
    );
    await user.click(screen.getByRole("button"));
    // First click — set from
    await user.click(screen.getByRole("button", { name: day(2025, 6, 5) }));

    // Simulate controlled update (parent updates value after onChange)
    rerender(
      <DatePicker
        mode="range"
        value={{ from: "2025-07-05", to: null }}
        onChange={onChange}
      />,
    );

    // Second click — set to
    await user.click(screen.getByRole("button", { name: /10 July 2025/i }));
    expect(onChange).toHaveBeenLastCalledWith({
      from: "2025-07-05",
      to: "2025-07-10",
    });
  });

  it("clicking an earlier date second swaps chronologically", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup({ delay: null });

    // Provide a half-open range (from set, to not yet).
    render(
      <DatePicker
        mode="range"
        value={{ from: "2025-07-10", to: null }}
        onChange={onChange}
      />,
    );
    await user.click(screen.getByRole("button"));
    // Click July 5, which is earlier than July 10.
    await user.click(screen.getByRole("button", { name: day(2025, 6, 5) }));
    // Should swap: from=5, to=10
    expect(onChange).toHaveBeenLastCalledWith({
      from: "2025-07-05",
      to: "2025-07-10",
    });
  });

  it("Done button closes the popover in range mode", async () => {
    const user = userEvent.setup({ delay: null });
    render(
      <DatePicker mode="range" value={{ from: "2025-07-01", to: "2025-07-15" }} onChange={vi.fn()} />,
    );
    await user.click(screen.getByRole("button", { name: /select date|1 Jul/i }));
    expect(screen.getByRole("grid")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /done/i }));
    expect(screen.queryByRole("grid")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Calendar — keyboard navigation (tested directly)
// ---------------------------------------------------------------------------

describe("Calendar keyboard navigation", () => {
  const initialMonth = startOfMonth(new Date(FIXED_YEAR, FIXED_MONTH, 1));
  const selected = { from: null, to: null };
  const noOp = () => undefined;

  it("ArrowRight moves focus to next day", () => {
    const onSelect = vi.fn();
    render(
      <Calendar
        mode="single"
        selected={selected}
        onSelect={onSelect}
        min={null}
        max={null}
        initialMonth={initialMonth}
      />,
    );
    const grid = screen.getByRole("grid");
    // Focus the grid (keyboard events bubble from focused cell to grid)
    grid.focus();
    fireEvent.keyDown(grid, { key: "ArrowRight" });
    // After ArrowRight from July 1 (the initialMonth default focused day),
    // the focused day should be July 2.
    // The data-autofocus attribute should now be on July 2.
    expect(
      grid.querySelector("[data-autofocus]"),
    ).toHaveAttribute("aria-label", expect.stringContaining("2 July 2025"));
  });

  it("ArrowLeft moves focus to previous day", () => {
    render(
      <Calendar
        mode="single"
        selected={{ from: new Date(FIXED_YEAR, FIXED_MONTH, 15), to: null }}
        onSelect={noOp}
        min={null}
        max={null}
        initialMonth={initialMonth}
      />,
    );
    const grid = screen.getByRole("grid");
    grid.focus();
    fireEvent.keyDown(grid, { key: "ArrowLeft" });
    expect(
      grid.querySelector("[data-autofocus]"),
    ).toHaveAttribute("aria-label", expect.stringContaining("14 July 2025"));
  });

  it("ArrowDown moves focus 7 days forward", () => {
    render(
      <Calendar
        mode="single"
        selected={{ from: new Date(FIXED_YEAR, FIXED_MONTH, 1), to: null }}
        onSelect={noOp}
        min={null}
        max={null}
        initialMonth={initialMonth}
      />,
    );
    const grid = screen.getByRole("grid");
    grid.focus();
    fireEvent.keyDown(grid, { key: "ArrowDown" });
    expect(
      grid.querySelector("[data-autofocus]"),
    ).toHaveAttribute("aria-label", expect.stringContaining("8 July 2025"));
  });

  it("ArrowUp moves focus 7 days back", () => {
    render(
      <Calendar
        mode="single"
        selected={{ from: new Date(FIXED_YEAR, FIXED_MONTH, 15), to: null }}
        onSelect={noOp}
        min={null}
        max={null}
        initialMonth={initialMonth}
      />,
    );
    const grid = screen.getByRole("grid");
    grid.focus();
    fireEvent.keyDown(grid, { key: "ArrowUp" });
    expect(
      grid.querySelector("[data-autofocus]"),
    ).toHaveAttribute("aria-label", expect.stringContaining("8 July 2025"));
  });

  it("Home moves focus to Monday of the current week", () => {
    // July 10 2025 is a Thursday. Monday of that week is July 7.
    render(
      <Calendar
        mode="single"
        selected={{ from: new Date(FIXED_YEAR, FIXED_MONTH, 10), to: null }}
        onSelect={noOp}
        min={null}
        max={null}
        initialMonth={initialMonth}
      />,
    );
    const grid = screen.getByRole("grid");
    grid.focus();
    fireEvent.keyDown(grid, { key: "Home" });
    expect(
      grid.querySelector("[data-autofocus]"),
    ).toHaveAttribute("aria-label", expect.stringContaining("7 July 2025"));
  });

  it("End moves focus to Sunday of the current week", () => {
    // July 10 2025 is a Thursday. Sunday of that week is July 13.
    render(
      <Calendar
        mode="single"
        selected={{ from: new Date(FIXED_YEAR, FIXED_MONTH, 10), to: null }}
        onSelect={noOp}
        min={null}
        max={null}
        initialMonth={initialMonth}
      />,
    );
    const grid = screen.getByRole("grid");
    grid.focus();
    fireEvent.keyDown(grid, { key: "End" });
    expect(
      grid.querySelector("[data-autofocus]"),
    ).toHaveAttribute("aria-label", expect.stringContaining("13 July 2025"));
  });

  it("PageDown advances month by 1", async () => {
    const user = userEvent.setup({ delay: null });
    render(
      <Calendar
        mode="single"
        selected={{ from: new Date(FIXED_YEAR, FIXED_MONTH, 1), to: null }}
        onSelect={noOp}
        min={null}
        max={null}
        initialMonth={initialMonth}
      />,
    );
    const grid = screen.getByRole("grid");
    grid.focus();
    fireEvent.keyDown(grid, { key: "PageDown" });
    // Header should now show August 2025.
    expect(screen.getByText(/August 2025/i)).toBeInTheDocument();
  });

  it("PageUp goes back one month", async () => {
    render(
      <Calendar
        mode="single"
        selected={{ from: new Date(FIXED_YEAR, FIXED_MONTH, 1), to: null }}
        onSelect={noOp}
        min={null}
        max={null}
        initialMonth={initialMonth}
      />,
    );
    const grid = screen.getByRole("grid");
    grid.focus();
    fireEvent.keyDown(grid, { key: "PageUp" });
    expect(screen.getByText(/June 2025/i)).toBeInTheDocument();
  });

  it("Enter selects the focused day", () => {
    const onSelect = vi.fn();
    render(
      <Calendar
        mode="single"
        selected={{ from: new Date(FIXED_YEAR, FIXED_MONTH, 15), to: null }}
        onSelect={onSelect}
        min={null}
        max={null}
        initialMonth={initialMonth}
      />,
    );
    const grid = screen.getByRole("grid");
    grid.focus();
    fireEvent.keyDown(grid, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledOnce();
    const arg = onSelect.mock.calls[0][0] as Date;
    expect(arg.getDate()).toBe(15);
    expect(arg.getMonth()).toBe(FIXED_MONTH);
    expect(arg.getFullYear()).toBe(FIXED_YEAR);
  });

  it("Space also selects the focused day", () => {
    const onSelect = vi.fn();
    render(
      <Calendar
        mode="single"
        selected={{ from: new Date(FIXED_YEAR, FIXED_MONTH, 15), to: null }}
        onSelect={onSelect}
        min={null}
        max={null}
        initialMonth={initialMonth}
      />,
    );
    const grid = screen.getByRole("grid");
    grid.focus();
    fireEvent.keyDown(grid, { key: " " });
    expect(onSelect).toHaveBeenCalledOnce();
  });

  // --- aria-current="date" on today ---

  it("today has aria-current=date", () => {
    render(
      <Calendar
        mode="single"
        selected={{ from: null, to: null }}
        onSelect={noOp}
        min={null}
        max={null}
        initialMonth={initialMonth}
      />,
    );
    const todayBtn = screen.getByRole("button", {
      name: /10 July 2025/i,
    });
    expect(todayBtn).toHaveAttribute("aria-current", "date");
  });

  // --- min / max bounds ---

  it("days before min have aria-disabled and disabled attribute", () => {
    const minDate = new Date(FIXED_YEAR, FIXED_MONTH, 10); // July 10 — days < 10 are disabled
    render(
      <Calendar
        mode="single"
        selected={{ from: null, to: null }}
        onSelect={vi.fn()}
        min={minDate}
        max={null}
        initialMonth={initialMonth}
      />,
    );
    // July 5 is before min.
    const day5 = screen.getByRole("button", { name: day(2025, 6, 5) });
    expect(day5).toHaveAttribute("aria-disabled", "true");
    expect(day5).toBeDisabled();
  });

  it("days after max have aria-disabled and disabled attribute", () => {
    const maxDate = new Date(FIXED_YEAR, FIXED_MONTH, 10); // July 10 — days > 10 are disabled
    render(
      <Calendar
        mode="single"
        selected={{ from: null, to: null }}
        onSelect={vi.fn()}
        min={null}
        max={maxDate}
        initialMonth={initialMonth}
      />,
    );
    const day15 = screen.getByRole("button", { name: /15 July 2025/i });
    expect(day15).toHaveAttribute("aria-disabled", "true");
    expect(day15).toBeDisabled();
  });

  it("keyboard navigation clamps at min boundary (ArrowLeft at min stays at min)", () => {
    // Calendar focus always clamps to range, so keyboard can't go below min.
    const minDate = new Date(FIXED_YEAR, FIXED_MONTH, 10);
    render(
      <Calendar
        mode="single"
        selected={{ from: minDate, to: null }}
        onSelect={vi.fn()}
        min={minDate}
        max={null}
        initialMonth={initialMonth}
      />,
    );
    const grid = screen.getByRole("grid");
    grid.focus();
    // focused is July 10 (min). ArrowLeft tries July 9, but clamps to July 10.
    fireEvent.keyDown(grid, { key: "ArrowLeft" });
    const focusedBtn = grid.querySelector("[data-autofocus]");
    expect(focusedBtn).toHaveAttribute(
      "aria-label",
      expect.stringContaining("10 July 2025"),
    );
  });
});
