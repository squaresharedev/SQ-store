import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { BarChart } from "@/components/charts/BarChart";
import { CompositionBar } from "@/components/charts/CompositionBar";
import { HBarChart } from "@/components/charts/HBarChart";
import { LineChart } from "@/components/charts/LineChart";
import { PieChart } from "@/components/charts/PieChart";
import { compactNumber, formatNumber, formatShare } from "@/components/charts/format";

// Charts render with a fixed `width` in tests so Recharts draws synchronously
// without responsive measuring; `animate={false}` keeps renders settled.

beforeAll(() => {
  // jsdom has no ResizeObserver; Recharts touches it defensively.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(cleanup);

const TREND = [
  { week: "W1", revenue: 1200, refunds: 80 },
  { week: "W2", revenue: 1450, refunds: 60 },
  { week: "W3", revenue: 1310, refunds: 120 },
];

describe("formatters", () => {
  it("groups thousands and compacts large values deterministically", () => {
    expect(formatNumber(1284)).toBe("1,284");
    expect(formatNumber(-42_500.5)).toBe("-42,500.5");
    expect(compactNumber(950)).toBe("950");
    expect(compactNumber(12_400)).toBe("12.4k");
    expect(compactNumber(4_200_000)).toBe("4.2M");
    expect(formatShare(3, 12)).toBe("25%");
    expect(formatShare(1, 0)).toBe("0%");
  });
});

describe("LineChart", () => {
  it("renders one path per series with a legend and a table twin", () => {
    const { container } = render(
      <LineChart
        data={TREND}
        xKey="week"
        series={[
          { key: "revenue", label: "Revenue" },
          { key: "refunds", label: "Refunds" },
        ]}
        width={600}
        height={300}
        animate={false}
        ariaLabel="Weekly revenue"
      />,
    );
    expect(container.querySelectorAll(".recharts-line").length).toBe(2);
    // Legend (visible) + sr table both name the series.
    const table = screen.getByRole("table", { name: "Weekly revenue" });
    expect(within(table).getByRole("columnheader", { name: "Refunds" })).toBeInTheDocument();
    expect(within(table).getByRole("cell", { name: "1,450" })).toBeInTheDocument();
    expect(screen.getAllByText("Revenue").length).toBeGreaterThanOrEqual(2);
  });

  it("shows no legend for a single series", () => {
    const { container } = render(
      <LineChart
        data={TREND}
        xKey="week"
        series={[{ key: "revenue", label: "Revenue" }]}
        width={600}
        height={300}
        animate={false}
      />,
    );
    expect(container.querySelector("ul")).toBeNull();
    expect(container.querySelectorAll(".recharts-line").length).toBe(1);
  });

  it("renders area washes for the area variant", () => {
    const { container } = render(
      <LineChart
        data={TREND}
        xKey="week"
        series={[{ key: "revenue" }]}
        variant="area"
        width={600}
        height={300}
        animate={false}
      />,
    );
    expect(container.querySelectorAll(".recharts-area").length).toBe(1);
  });
});

describe("BarChart", () => {
  it("renders grouped rectangles per series and category", () => {
    const { container } = render(
      <BarChart
        data={TREND}
        xKey="week"
        series={[
          { key: "revenue", label: "Revenue" },
          { key: "refunds", label: "Refunds" },
        ]}
        width={600}
        height={300}
        animate={false}
      />,
    );
    expect(container.querySelectorAll(".recharts-bar").length).toBe(2);
    expect(
      container.querySelectorAll(".recharts-bar-rectangle").length,
    ).toBe(TREND.length * 2);
  });

  it("stacks series when variant is stacked", () => {
    const { container } = render(
      <BarChart
        data={TREND}
        xKey="week"
        series={[{ key: "revenue" }, { key: "refunds" }]}
        variant="stacked"
        width={600}
        height={300}
        animate={false}
      />,
    );
    expect(container.querySelectorAll(".recharts-bar").length).toBe(2);
  });
});

describe("HBarChart", () => {
  it("renders category labels on the y axis and sizes height to rows", () => {
    const { container } = render(
      <HBarChart
        data={[
          { product: "Acid Tee", revenue: 840 },
          { product: "A2 Poster", revenue: 610 },
        ]}
        xKey="product"
        series={[{ key: "revenue", label: "Revenue" }]}
        width={600}
        animate={false}
      />,
    );
    expect(screen.getAllByText("Acid Tee").length).toBeGreaterThanOrEqual(1);
    expect(container.querySelectorAll(".recharts-bar-rectangle").length).toBe(2);
  });
});

describe("CompositionBar", () => {
  const ITEMS = [
    { label: "Paid", value: 164 },
    { label: "Pending", value: 23 },
    { label: "Refunded", value: 0 },
  ];

  it("renders proportional segments, skipping zero values but keeping them in the legend", () => {
    render(<CompositionBar items={ITEMS} ariaLabel="Order status mix" />);
    const segment = screen.getByRole("img", { name: "Paid: 164 (88%)" });
    expect(segment.style.width).toBe(`${(164 / 187) * 100}%`);
    expect(screen.queryByRole("img", { name: /Refunded/ })).toBeNull();
    // Legend still lists the zero-value part with its share.
    expect(screen.getByText("Refunded")).toBeInTheDocument();
  });

  it("shows the readout on keyboard focus (tooltips never gate)", () => {
    render(<CompositionBar items={ITEMS} />);
    fireEvent.focus(screen.getByRole("img", { name: /Pending/ }));
    expect(within(screen.getByRole("status")).getByText("Pending")).toBeInTheDocument();
  });
});

describe("PieChart", () => {
  const CATEGORIES = [
    { label: "Apparel", value: 212 },
    { label: "Prints", value: 168 },
    { label: "Stickers", value: 131 },
    { label: "Accessories", value: 89 },
    { label: "Homeware", value: 54 },
    { label: "Music", value: 38 },
    { label: "Zines", value: 21 },
    { label: "Misc", value: 12 },
  ];

  it("folds the tail into Other past maxSlices and lists values in the legend", () => {
    const { container } = render(
      <PieChart items={CATEGORIES} variant="pie" animate={false} />,
    );
    // Default maxSlices 5: four auto-coloured slices + the folded Other.
    expect(container.querySelectorAll(".recharts-pie-sector").length).toBe(5);
    expect(screen.getByText("Other")).toBeInTheDocument();
    // Other = 54 + 38 + 21 + 12
    expect(screen.getByText("125")).toBeInTheDocument();
  });

  it("shows the headline total in the donut hole", () => {
    render(
      <PieChart
        items={[
          { label: "Embed", value: 386 },
          { label: "Marketplace", value: 272 },
        ]}
        animate={false}
      />,
    );
    expect(screen.getByText("Total")).toBeInTheDocument();
    expect(screen.getByText("658")).toBeInTheDocument();
  });
});
