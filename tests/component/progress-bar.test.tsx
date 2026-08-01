import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ProgressBar } from "@/components/ui/ProgressBar";

afterEach(cleanup);

describe("ProgressBar", () => {
  it("exposes the percentage on a real progressbar role", () => {
    render(<ProgressBar value={0.42} label="Uploading image" />);
    const bar = screen.getByRole("progressbar", { name: "Uploading image" });
    expect(bar).toHaveAttribute("aria-valuenow", "42");
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "100");
  });

  it("omits aria-valuenow when indeterminate", () => {
    render(<ProgressBar value={null} label="Uploading file" />);
    expect(screen.getByRole("progressbar")).not.toHaveAttribute("aria-valuenow");
  });

  it("clamps out-of-range values instead of overflowing the track", () => {
    const { rerender } = render(<ProgressBar value={1.8} label="Upload" />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");

    rerender(<ProgressBar value={-0.5} label="Upload" />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
  });
});
