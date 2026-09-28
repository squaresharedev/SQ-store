/**
 * The dev-only `?preview=empty` switch on the list pages.
 *
 * What this pins: it answers only to the exact value `empty`, it reads the
 * first of a repeated param, and it is OFF in a production build whatever the
 * URL says, since it lets a page skip its list query.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { DEV_PREVIEW_EMPTY, previewsEmptyList } from "@/lib/dev/preview";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("previewsEmptyList", () => {
  it("is on for ?preview=empty outside production", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(previewsEmptyList(DEV_PREVIEW_EMPTY)).toBe(true);
    expect(previewsEmptyList([DEV_PREVIEW_EMPTY, "other"])).toBe(true);
  });

  it("ignores anything else", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(previewsEmptyList(undefined)).toBe(false);
    expect(previewsEmptyList("")).toBe(false);
    expect(previewsEmptyList("Empty")).toBe(false);
    expect(previewsEmptyList(["other", DEV_PREVIEW_EMPTY])).toBe(false);
  });

  it("is always off in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(previewsEmptyList(DEV_PREVIEW_EMPTY)).toBe(false);
  });
});
