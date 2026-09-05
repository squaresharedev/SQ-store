import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { Sidebar } from "@/components/dashboard/Sidebar";
import {
  AnalyticsIcon,
  DiscoverIcon,
  OrdersIcon,
  OverviewIcon,
  PaymentsIcon,
  ProductsIcon,
  SettingsIcon,
  StorefrontIcon,
} from "@/components/dashboard/nav-icons";

// The icons animate; jsdom cannot exercise the choreography, so these pin the
// render contract only. The dev-server filmstrip in /dev/nav-icons covers the
// motion itself.

/**
 * The animated icons' contract: idle state is pixel-identical to the lucide
 * originals (the animation only exists between hover and settle), and the
 * real Sidebar mounts them inside motion-wrapped rows without exploding.
 * jsdom can't exercise the choreography itself; the dev-server filmstrip in
 * /dev/nav-icons covers that. These pin the render contract.
 */

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
}));

afterEach(cleanup);

const ICONS = [
  ["Overview", OverviewIcon],
  ["Products", ProductsIcon],
  ["Storefront", StorefrontIcon],
  ["Orders", OrdersIcon],
  ["Analytics", AnalyticsIcon],
  ["Payments", PaymentsIcon],
  ["Settings", SettingsIcon],
  ["Discover", DiscoverIcon],
] as const;

describe("nav icons", () => {
  it.each(ICONS)("%s renders a decorative currentColor svg", (_name, Icon) => {
    const { container } = render(<Icon />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveAttribute("stroke", "currentColor");
    expect(svg).toHaveAttribute("viewBox", "0 0 24 24");
    // One color: nothing in the tree hardcodes a paint.
    for (const el of container.querySelectorAll("[stroke], [fill]")) {
      const stroke = el.getAttribute("stroke");
      const fill = el.getAttribute("fill");
      if (stroke) expect(stroke).toBe("currentColor");
      if (fill) expect(fill).toBe("none");
    }
  });

  it("ProductsIcon keeps the lucide package silhouette", () => {
    const { container } = render(<ProductsIcon />);
    const drawn = [...container.querySelectorAll("path, polyline")]
      .map((el) => el.getAttribute("d") ?? el.getAttribute("points"))
      .join(" ");
    expect(drawn).toContain("M11 21.73"); // box body
    expect(drawn).toContain("3.29 7 12 12 20.71 7"); // the lid
  });

  it("PaymentsIcon rests as the plain lucide card, nothing more", () => {
    const { container } = render(<PaymentsIcon />);
    // A hover that needs extra furniture has to add it without leaving any of
    // it on the resting glyph. The card and its stripe are the whole resting
    // glyph, and the hover sparkles carry opacity 0 on the element itself, so
    // they stay invisible even where no variant label reaches them (reduced
    // motion, or an icon rendered outside a nav row).
    expect(container.querySelectorAll("rect")).toHaveLength(1);
    expect(container.querySelectorAll("line")).toHaveLength(1);
    expect(container.querySelectorAll("polyline, circle")).toHaveLength(0);

    const sparkles = [...container.querySelectorAll("path")];
    expect(sparkles.length).toBeGreaterThan(0);
    for (const sparkle of sparkles) {
      expect(sparkle.getAttribute("opacity")).toBe("0");
    }
  });

  it("ProductsIcon shuts its four lids onto lines the icon already draws", () => {
    const { container } = render(<ProductsIcon />);
    expect(container.querySelector("polyline")?.getAttribute("points")).toBe(
      "3.29 7 12 12 20.71 7",
    );
    const lids = [...container.querySelectorAll("path")]
      .map((p) => p.getAttribute("d") ?? "")
      .filter((d) => d.endsWith("Z"));
    expect(lids).toHaveLength(4);

    // The two long lids meet on the seam, which is how the resting icon gets
    // the one diagonal lucide draws without anything drawing it separately.
    expect(lids.filter((d) => d.includes("16.36 9.50"))).toHaveLength(2);

    // The two side lids are the ones a real box folds away first: shut, they
    // collapse onto their own hinge, so they render as nothing at all.
    const corners = (d: string) =>
      (d.match(/-?\d+(?:\.\d+)?\s-?\d+(?:\.\d+)?/g) ?? []).map((pair) =>
        pair.split(/\s+/).map(Number),
      );
    const folded = lids.filter((d) => {
      const [a, b, c, e] = corners(d);
      return c?.[0] === b?.[0] && c?.[1] === b?.[1] && e?.[0] === a?.[0];
    });
    expect(folded).toHaveLength(2);
  });
});

describe("Sidebar with animated icons", () => {
  it("renders every nav row with its glyph and hrefs intact", () => {
    render(<Sidebar />);
    const nav = screen.getByRole("navigation", { name: "Dashboard" });
    for (const [label, href] of [
      ["Overview", "/dashboard"],
      ["Products", "/products"],
      ["Storefront", "/storefront"],
      ["Orders", "/orders"],
      ["Analytics", "/analytics"],
      ["Payments", "/payments"],
      ["Settings", "/settings"],
    ] as const) {
      const link = screen.getByRole("link", { name: label });
      expect(link).toHaveAttribute("href", href);
      expect(link.querySelector("svg")).not.toBeNull();
    }
    // Those seven and nothing else. The rail used to carry a permanently
    // disabled "Discover / Coming soon" row: a roadmap entry occupying a slot
    // in navigation a seller uses dozens of times a day. Asserting the exact
    // set, rather than just the rows we want, is what stops the next one.
    expect(within(nav).getAllByRole("link")).toHaveLength(7);
  });

  it("marks the active route, and carries no dead rows", () => {
    render(<Sidebar />);
    expect(screen.getByRole("link", { name: "Overview" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    const nav = screen.getByRole("navigation", { name: "Dashboard" });
    expect(nav.querySelector("[aria-disabled]")).toBeNull();
  });
});
