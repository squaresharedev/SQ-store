import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "../setup/render";
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
    expect(formatNumber(1284, "en")).toBe("1,284");
    expect(formatNumber(-42_500.5, "en")).toBe("-42,500.5");
    expect(compactNumber(950, "en")).toBe("950");
    expect(compactNumber(12_400, "en")).toBe("12.4k");
    expect(compactNumber(4_200_000, "en")).toBe("4.2M");
    expect(formatShare(3, 12, "en")).toBe("25%");
    expect(formatShare(1, 0, "en")).toBe("0%");
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

  it("bleeds edge to edge: the data stands clear of both ends and a blurred tail runs on to each", () => {
    const { container } = render(
      <LineChart
        data={TREND}
        xKey="week"
        series={[{ key: "revenue" }]}
        variant="area"
        bleed
        valueSide="right"
        yDomain={[0, 2000]}
        yTicks={[0, 500, 1000, 1500, 2000]}
        width={600}
        height={300}
        animate={false}
      />,
    );
    // No axis column and no side margins, but the DATA does not touch the
    // edges: 8% of 600px is kept at each end, so the first and last values
    // are never in the part that blurs away.
    const curve = container.querySelector(".recharts-area-curve")!.getAttribute("d")!;
    const xs = Array.from(curve.matchAll(/(-?[0-9.]+),-?[0-9.]+/g), (match) => Number(match[1]));
    expect(Math.min(...xs)).toBe(48);
    expect(Math.max(...xs)).toBe(552);
    expect(container.querySelector(".recharts-area-curve")!.getAttribute("mask")).toBeNull();

    // From each end value a level tail runs on to the box's edge, drawn twice:
    // sharp, and blurred, each under its own mask.
    const tails = Array.from(container.querySelectorAll("[data-chart-tail]"));
    expect(tails.map((tail) => tail.getAttribute("data-chart-tail"))).toEqual(["start", "end"]);
    for (const tail of tails) {
      const [sharp, soft] = Array.from(tail.children);
      expect(sharp.getAttribute("mask")).toContain("-sharp)");
      expect(sharp.getAttribute("filter")).toBeNull();
      expect(soft.getAttribute("mask")).toContain("-soft)");
      expect(soft.getAttribute("filter")).toContain("-blur)");
      const line = sharp.querySelector("line")!;
      const atEdge = tail.getAttribute("data-chart-tail") === "start" ? "0" : "600";
      expect(line.getAttribute("x2")).toBe(atEdge);
      // Level: it claims no value the data did not have.
      expect(line.getAttribute("y1")).toBe(line.getAttribute("y2"));
    }
    expect(tails[0].querySelector("line")!.getAttribute("x1")).toBe("48");
    expect(tails[1].querySelector("line")!.getAttribute("x1")).toBe("552");

    // The value labels are inside the plot, on the side asked for, one per
    // tick the caller set.
    const values = Array.from(container.querySelectorAll(".recharts-yAxis-tick-labels text"));
    expect(values.map((label) => label.textContent)).toEqual(["0", "500", "1k", "1.5k", "2k"]);
    for (const label of values) {
      expect(label.getAttribute("text-anchor")).toBe("end");
      expect(Number(label.getAttribute("x"))).toBeGreaterThan(500);
      expect(Number(label.getAttribute("x"))).toBeLessThan(600);
    }

    // The end dates sit under their own points, clear of the edges.
    const dates = Array.from(container.querySelectorAll(".recharts-xAxis-tick-labels text"));
    expect(Number(dates[0].getAttribute("x"))).toBe(48);
    expect(Number(dates[dates.length - 1].getAttribute("x"))).toBe(552);

    // The gridlines have no focus to lose, so they simply thin out at the
    // ends. The labels do neither: the ends are read against them.
    for (const gridline of container.querySelectorAll(".recharts-cartesian-grid-horizontal line")) {
      expect(gridline.getAttribute("mask")).toContain("-fade)");
    }
    for (const label of [...values, ...dates]) {
      expect(label.getAttribute("mask")).toBeNull();
      expect(label.getAttribute("filter")).toBeNull();
    }
  });

  it("draws a reference series dashed, without a wash, behind what is measured", () => {
    const { container } = render(
      <LineChart
        data={TREND}
        xKey="week"
        series={[
          { key: "revenue", label: "Revenue" },
          { key: "refunds", label: "Previous period", reference: true },
        ]}
        variant="area"
        width={600}
        height={300}
        animate={false}
        ariaLabel="Revenue versus the previous period"
      />,
    );
    const curves = Array.from(container.querySelectorAll(".recharts-area-curve"));
    expect(curves).toHaveLength(2);
    // Drawn first, so the measured line sits over it.
    expect(curves[0].getAttribute("stroke-dasharray")).toBe("4 4");
    expect(curves[1].getAttribute("stroke-dasharray")).toBeNull();
    const washes = Array.from(container.querySelectorAll(".recharts-area-area"));
    expect(washes[0].getAttribute("fill")).toBe("none");
    expect(washes[1].getAttribute("fill")).toContain("url(#");
    // The legend and the table keep the caller's order: measured first.
    const legend = Array.from(container.querySelectorAll("ul li")).map((row) => row.textContent);
    expect(legend).toEqual(["Revenue", "Previous period"]);
    const headers = within(
      screen.getByRole("table", { name: "Revenue versus the previous period" }),
    ).getAllByRole("columnheader");
    expect(headers.map((header) => header.textContent).slice(1)).toEqual([
      "Revenue",
      "Previous period",
    ]);
  });

  it("can leave the legend to its caller", () => {
    const { container } = render(
      <LineChart
        data={TREND}
        xKey="week"
        series={[{ key: "revenue" }, { key: "refunds", reference: true }]}
        legend={false}
        width={600}
        height={300}
        animate={false}
      />,
    );
    expect(container.querySelector("ul")).toBeNull();
  });

  it("marks a single value as a point with a level through it, since no line can be drawn", () => {
    const { container } = render(
      <LineChart
        data={[{ week: "W1", revenue: 1200 }]}
        xKey="week"
        series={[{ key: "revenue", label: "Revenue" }]}
        variant="area"
        width={600}
        height={300}
        animate={false}
      />,
    );
    expect(container.querySelectorAll(".recharts-area-dot")).toHaveLength(1);
    const level = container.querySelector(".recharts-reference-line line")!;
    expect(level.getAttribute("stroke-dasharray")).toBe("2 4");
    // The level runs through the point.
    const dot = container.querySelector(".recharts-area-dot")!;
    expect(Number(level.getAttribute("y1"))).toBeCloseTo(Number(dot.getAttribute("cy")), 3);
  });

  it("marks the one value in a series of gaps, and nothing in a series that has a line", () => {
    const gaps = render(
      <LineChart
        data={[
          { week: "W1", revenue: null },
          { week: "W2", revenue: 900 },
          { week: "W3", revenue: null },
        ]}
        xKey="week"
        series={[{ key: "revenue" }]}
        connectNulls
        width={600}
        height={300}
        animate={false}
      />,
    );
    expect(gaps.container.querySelectorAll(".recharts-line-dot")).toHaveLength(1);
    expect(gaps.container.querySelectorAll(".recharts-reference-line")).toHaveLength(1);
    cleanup();

    const full = render(
      <LineChart
        data={TREND}
        xKey="week"
        series={[{ key: "revenue" }]}
        width={600}
        height={300}
        animate={false}
      />,
    );
    expect(full.container.querySelectorAll(".recharts-line-dot")).toHaveLength(0);
    expect(full.container.querySelectorAll(".recharts-reference-line")).toHaveLength(0);
  });

  it("fills the height of its parent when asked to", () => {
    const { container } = render(
      <div style={{ height: 400 }}>
        <LineChart
          data={TREND}
          xKey="week"
          series={[{ key: "revenue" }]}
          height="fill"
          animate={false}
        />
      </div>,
    );
    const group = container.querySelector('[role="group"]') as HTMLElement;
    expect(group.className).toContain("h-full");
    expect((group.firstElementChild as HTMLElement).style.height).toBe("100%");
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
    // Twice in the markup: the figure, and the hidden copy it is fitted to
    // the hole against.
    expect(screen.getAllByText("658").length).toBeGreaterThan(0);
  });
});
