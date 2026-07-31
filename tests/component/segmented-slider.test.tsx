import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

afterEach(cleanup);
import userEvent from "@testing-library/user-event";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Slider } from "@/components/ui/slider";

// ---------------------------------------------------------------------------
// SegmentedControl
// ---------------------------------------------------------------------------

const options = [
  { value: "a", label: "Option A" },
  { value: "b", label: "Option B" },
  { value: "c", label: "Option C" },
] as const;

describe("SegmentedControl", () => {
  it("renders one button per option", () => {
    render(
      <SegmentedControl
        value="a"
        options={options}
        onChange={vi.fn()}
        ariaLabel="Select option"
      />,
    );
    expect(screen.getAllByRole("button")).toHaveLength(3);
    expect(screen.getByRole("button", { name: "Option A" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Option B" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Option C" })).toBeInTheDocument();
  });

  it("active option has aria-pressed=true, others have aria-pressed=false", () => {
    render(
      <SegmentedControl
        value="b"
        options={options}
        onChange={vi.fn()}
        ariaLabel="Select option"
      />,
    );
    expect(screen.getByRole("button", { name: "Option A" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("button", { name: "Option B" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Option C" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("clicking an option calls onChange with that value", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <SegmentedControl
        value="a"
        options={options}
        onChange={onChange}
        ariaLabel="Select option"
      />,
    );
    await user.click(screen.getByRole("button", { name: "Option B" }));
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith("b");
  });

  it("clicking the already-active option still calls onChange", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <SegmentedControl
        value="a"
        options={options}
        onChange={onChange}
        ariaLabel="Select option"
      />,
    );
    await user.click(screen.getByRole("button", { name: "Option A" }));
    expect(onChange).toHaveBeenCalledWith("a");
  });

  it("disabled: buttons are disabled", () => {
    render(
      <SegmentedControl
        value="a"
        options={options}
        onChange={vi.fn()}
        ariaLabel="Select option"
        disabled
      />,
    );
    screen.getAllByRole("button").forEach((btn) => {
      expect(btn).toBeDisabled();
    });
  });

  it("group has accessible label", () => {
    render(
      <SegmentedControl
        value="a"
        options={options}
        onChange={vi.fn()}
        ariaLabel="Select option"
      />,
    );
    expect(screen.getByRole("group", { name: "Select option" })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Slider
// ---------------------------------------------------------------------------

describe("Slider", () => {
  it("renders with role=slider and correct ARIA attributes", () => {
    render(
      <Slider
        value={50}
        min={0}
        max={100}
        onChange={vi.fn()}
        ariaLabel="Volume"
      />,
    );
    const slider = screen.getByRole("slider", { name: "Volume" });
    expect(slider).toBeInTheDocument();
    expect(slider).toHaveAttribute("aria-valuenow", "50");
    expect(slider).toHaveAttribute("aria-valuemin", "0");
    expect(slider).toHaveAttribute("aria-valuemax", "100");
  });

  it("ArrowRight increases value by step", () => {
    const onChange = vi.fn();
    render(
      <Slider value={50} min={0} max={100} step={5} onChange={onChange} ariaLabel="Volume" />,
    );
    const slider = screen.getByRole("slider");
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith(55);
  });

  it("ArrowUp increases value by step", () => {
    const onChange = vi.fn();
    render(
      <Slider value={50} min={0} max={100} step={5} onChange={onChange} ariaLabel="Volume" />,
    );
    fireEvent.keyDown(screen.getByRole("slider"), { key: "ArrowUp" });
    expect(onChange).toHaveBeenCalledWith(55);
  });

  it("ArrowLeft decreases value by step", () => {
    const onChange = vi.fn();
    render(
      <Slider value={50} min={0} max={100} step={5} onChange={onChange} ariaLabel="Volume" />,
    );
    fireEvent.keyDown(screen.getByRole("slider"), { key: "ArrowLeft" });
    expect(onChange).toHaveBeenCalledWith(45);
  });

  it("ArrowDown decreases value by step", () => {
    const onChange = vi.fn();
    render(
      <Slider value={50} min={0} max={100} step={5} onChange={onChange} ariaLabel="Volume" />,
    );
    fireEvent.keyDown(screen.getByRole("slider"), { key: "ArrowDown" });
    expect(onChange).toHaveBeenCalledWith(45);
  });

  it("Home key sets value to min", () => {
    const onChange = vi.fn();
    render(
      <Slider value={50} min={10} max={100} onChange={onChange} ariaLabel="Volume" />,
    );
    fireEvent.keyDown(screen.getByRole("slider"), { key: "Home" });
    expect(onChange).toHaveBeenCalledWith(10);
  });

  it("End key sets value to max", () => {
    const onChange = vi.fn();
    render(
      <Slider value={50} min={0} max={100} onChange={onChange} ariaLabel="Volume" />,
    );
    fireEvent.keyDown(screen.getByRole("slider"), { key: "End" });
    expect(onChange).toHaveBeenCalledWith(100);
  });

  it("ArrowRight at max does not exceed max", () => {
    const onChange = vi.fn();
    render(
      <Slider value={100} min={0} max={100} onChange={onChange} ariaLabel="Volume" />,
    );
    fireEvent.keyDown(screen.getByRole("slider"), { key: "ArrowRight" });
    // value === max → no change emitted
    expect(onChange).not.toHaveBeenCalled();
  });

  it("ArrowLeft at min does not go below min", () => {
    const onChange = vi.fn();
    render(
      <Slider value={0} min={0} max={100} onChange={onChange} ariaLabel="Volume" />,
    );
    fireEvent.keyDown(screen.getByRole("slider"), { key: "ArrowLeft" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("aria-valuenow reflects current value", () => {
    render(
      <Slider value={33} min={0} max={100} onChange={vi.fn()} ariaLabel="Volume" />,
    );
    expect(screen.getByRole("slider")).toHaveAttribute("aria-valuenow", "33");
  });

  it("disabled slider does not fire onChange on keydown", () => {
    const onChange = vi.fn();
    render(
      <Slider value={50} min={0} max={100} onChange={onChange} ariaLabel="Volume" disabled />,
    );
    fireEvent.keyDown(screen.getByRole("slider"), { key: "ArrowRight" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("valueText is exposed as aria-valuetext", () => {
    render(
      <Slider
        value={50}
        min={0}
        max={100}
        onChange={vi.fn()}
        ariaLabel="Volume"
        valueText="50%"
      />,
    );
    expect(screen.getByRole("slider")).toHaveAttribute("aria-valuetext", "50%");
  });
});
