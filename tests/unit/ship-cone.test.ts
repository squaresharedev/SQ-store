import { describe, expect, it } from "vitest";
import {
  CLIP_SHUT,
  NO_GEOMETRY,
  cloudPath,
  coneClip,
  journey,
  type Geometry,
} from "@/components/orders/ship-cone";

// The success cloud behind the van in the mark-shipped button. Geometry is
// what ShipConfirmButton measures: a 40px-tall, 300px-wide button with the
// van's middle 100px in, the cone 1.2 heights long and the van's journey
// padded so the cone and the lagging text cone both clear the far edge.
const WIDTH = 300;
const g: Geometry = { height: 40, rest: 100, total: WIDTH - 92 + 48 + 28, cone: 48 };
const MARGIN = 12;

const numbers = (s: string) => (s.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);

describe("the plain cone (what reveals the words)", () => {
  it("does not exist until the van has moved, or before it has been measured", () => {
    expect(coneClip(0, g)).toBe(CLIP_SHUT);
    expect(coneClip(-5, g)).toBe(CLIP_SHUT);
    expect(coneClip(50, NO_GEOMETRY)).toBe(CLIP_SHUT);
    // A lagging cone waits for the van to get past its lag.
    expect(coneClip(20, g, 0, 28)).toBe(CLIP_SHUT);
  });

  it("starts as a three-point thread and becomes a five-point cone", () => {
    expect(numbers(coneClip(4, g))).toHaveLength(6);
    expect(numbers(coneClip(150, g))).toHaveLength(10);
  });

  it("covers the whole button by the end of the van's journey", () => {
    const points = numbers(coneClip(g.total, g, 0, 28));
    // polygon(0 0, BACK 0, tip half, BACK full, 0 full): BACK is where the flat part ends.
    expect(points[2]).toBeGreaterThanOrEqual(WIDTH);
  });
});

describe("the cloud (what the gooey filter melts into the success colour)", () => {
  it("is empty until the van has moved, or before it has been measured", () => {
    expect(cloudPath(0, g, MARGIN)).toBe("");
    expect(cloudPath(-5, g, MARGIN)).toBe("");
    expect(cloudPath(50, NO_GEOMETRY, MARGIN)).toBe("");
  });

  it("is a well-formed path of bounded size at every point of the journey", () => {
    for (let x = 1; x <= g.total; x += 7) {
      const path = cloudPath(x, g, MARGIN);
      expect(path.startsWith("M")).toBe(true);
      expect(path.endsWith("Z")).toBe(true);
      expect(path).not.toMatch(/NaN|Infinity/);
      // One outline, a spine, two rows of bumps and the floaters: never a runaway.
      expect(path.match(/M/g)!.length).toBeLessThanOrEqual(1 + 27 + 18 + 12);
      expect(path.length).toBeLessThan(9000);
    }
  });

  it("streams out of the van rather than appearing along the whole button at once", () => {
    const x = 6;
    const tip = g.rest + MARGIN + x;
    // Every disc starts (its left point) close behind the tip: the trail has only just begun.
    const starts = [...cloudPath(x, g, MARGIN).matchAll(/M(-?\d+\.\d)/g)].map((m) => Number(m[1]));
    expect(starts.length).toBeGreaterThan(0);
    expect(Math.min(...starts)).toBeGreaterThan(tip - 60);
  });

  it("plays the same every time", () => {
    expect(cloudPath(120, g, MARGIN)).toBe(cloudPath(120, g, MARGIN));
  });
});

describe("journey", () => {
  it("is the van's progress, held between 0 and 1", () => {
    expect(journey(-10, g)).toBe(0);
    expect(journey(g.total / 2, g)).toBeCloseTo(0.5);
    expect(journey(g.total * 2, g)).toBe(1);
    expect(journey(50, NO_GEOMETRY)).toBe(0);
  });
});
