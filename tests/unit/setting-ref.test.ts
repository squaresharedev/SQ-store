import { describe, expect, it } from "vitest";
import {
  CONTROLS_GROUPS,
  GROUP_LABELS,
  STOREFRONT_SETTINGS,
  isPerTileSetting,
  isSameSettingRef,
  settingById,
  settingGroup,
  settingHref,
  settingIdFromHref,
} from "@/lib/storefront/setting-ref";
import { searchLocalRegistry } from "@/lib/search/registry";
import { english } from "../setup/translate";

/**
 * The settings catalogue is the contract between three things that must agree:
 * universal search, the panel's own filter field, and the panel that has to
 * open. These pin the parts that would fail silently — a setting that is
 * findable but opens nothing, or a link that parses back to the wrong control.
 */

describe("the catalogue", () => {
  it("has no duplicate ids", () => {
    const ids = STOREFRONT_SETTINGS.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("only ever points at a group the panel actually has, or at a block's own control", () => {
    for (const entry of STOREFRONT_SETTINGS) {
      const group = settingGroup(entry.ref);
      if (entry.ref.kind === "block") {
        // A block's setting opens in that block's inspector, never a group,
        // and names a field that block kind's inspector really has.
        expect(group).toBeNull();
        expect(entry.ref.types.length).toBeGreaterThan(0);
        continue;
      }
      expect(CONTROLS_GROUPS).toContain(group);
      expect(GROUP_LABELS[group!]).toBeTruthy();
    }
  });

  it("finds the card extras and the block settings by the words a seller would use", () => {
    const byId = (id: string) => settingById(id)!;
    expect(byId("card-hover-effect").ref).toEqual({ kind: "cards", section: "hover" });
    expect(byId("card-second-photo").ref).toEqual({ kind: "cards", section: "hover" });
    for (const id of ["card-buy-button", "card-star-rating", "card-low-stock"]) {
      expect(byId(id).ref).toEqual({ kind: "cards", section: "shopping" });
    }
    expect(byId("text-spacing").ref).toEqual({ kind: "block", field: "spacing", types: ["text"] });
    expect(byId("element-blur").ref).toMatchObject({ kind: "block", field: "blur" });
    // Both scopes have the card extras; a block setting has no tile copy.
    expect(isPerTileSetting(byId("card-low-stock").ref)).toBe(true);
    expect(isPerTileSetting(byId("text-spacing").ref)).toBe(false);
  });

  it("compares block refs by field and kinds", () => {
    expect(
      isSameSettingRef(
        { kind: "block", field: "blur", types: ["shape", "text"] },
        { kind: "block", field: "blur", types: ["shape", "text"] },
      ),
    ).toBe(true);
    expect(
      isSameSettingRef(
        { kind: "block", field: "blur", types: ["shape"] },
        { kind: "block", field: "spacing", types: ["shape"] },
      ),
    ).toBe(false);
  });

  it("covers every group, so no part of the panel is unreachable by name", () => {
    const covered = new Set(STOREFRONT_SETTINGS.map((e) => settingGroup(e.ref)));
    for (const group of CONTROLS_GROUPS) expect(covered).toContain(group);
  });

  it("gives every entry words a seller would actually type", () => {
    for (const entry of STOREFRONT_SETTINGS) {
      expect(entry.keywords.length).toBeGreaterThan(0);
    }
  });
});

describe("settingHref and settingIdFromHref", () => {
  it("round-trips every entry, with and without a storefront", () => {
    for (const entry of STOREFRONT_SETTINGS) {
      expect(settingIdFromHref(settingHref(entry.id))).toBe(entry.id);
      expect(settingIdFromHref(settingHref(entry.id, "abc-123"))).toBe(entry.id);
    }
  });

  it("sends a seller with no storefront to the list, not to a broken id", () => {
    expect(settingHref("accent")).toBe("/storefront?setting=accent");
    expect(settingHref("accent", "abc")).toBe("/storefront/abc?setting=accent");
  });

  it("reads nothing out of a link that names no setting", () => {
    expect(settingIdFromHref("/storefront/abc")).toBeNull();
    expect(settingIdFromHref("/settings/account#username")).toBeNull();
    // An id that is not in the catalogue is junk, not a setting.
    expect(settingIdFromHref("/storefront?setting=drop-tables")).toBeNull();
  });
});

describe("isSameSettingRef", () => {
  it("compares by value, since refs are minted fresh at every call site", () => {
    expect(
      isSameSettingRef({ kind: "group", group: "theme" }, { kind: "group", group: "theme" }),
    ).toBe(true);
    expect(
      isSameSettingRef({ kind: "group", group: "theme" }, { kind: "theme", section: "canvas" }),
    ).toBe(false);
    expect(
      isSameSettingRef({ kind: "cards", section: "priceTag" }, { kind: "cards", section: "priceTag" }),
    ).toBe(true);
    expect(
      isSameSettingRef({ kind: "cards", section: "priceTag" }, { kind: "cards", section: "cardStyle" }),
    ).toBe(false);
    expect(
      isSameSettingRef({ kind: "theme", section: "look" }, { kind: "theme", section: "look" }),
    ).toBe(true);
    expect(
      isSameSettingRef({ kind: "theme", section: "look" }, { kind: "theme", section: "canvas" }),
    ).toBe(false);
    expect(isSameSettingRef(null, null)).toBe(true);
    expect(isSameSettingRef(null, { kind: "group", group: "theme" })).toBe(false);
  });
});

describe("scope", () => {
  it("treats card settings as per-tile and everything else as storefront-wide", () => {
    expect(isPerTileSetting(settingById("title-position")!.ref)).toBe(true);
    expect(isPerTileSetting(settingById("price-position")!.ref)).toBe(true);
    // A background is the storefront's; no tile has one of its own.
    expect(isPerTileSetting(settingById("background")!.ref)).toBe(false);
    expect(isPerTileSetting(settingById("canvas-size")!.ref)).toBe(false);
  });
});

describe("universal search", () => {
  const owner = "owner" as const;

  it("finds a storefront setting by a phrase a seller would use", () => {
    const titles = searchLocalRegistry("move the price", { role: owner, t: english }).flatMap((group) =>
      group.results.map((result) => result.title),
    );
    expect(titles).toContain("Price position");
  });

  it("carries a link the designer can parse back to the same setting", () => {
    const result = searchLocalRegistry("title position", { role: owner, t: english })
      .flatMap((group) => group.results)
      .find((r) => r.title === "Title position");
    expect(result).toBeDefined();
    expect(settingIdFromHref(result!.href!)).toBe("title-position");
  });

  it("says where the setting lives, so a result is not just a word", () => {
    const result = searchLocalRegistry("roundness", { role: owner, t: english })
      .flatMap((group) => group.results)
      .find((r) => r.title === "Corner roundness");
    expect(result?.subtitle).toBe("Storefront / Product cards");
  });

  it("hides every storefront setting from a role that cannot edit one", () => {
    const titles = searchLocalRegistry("price position", { role: "viewer", t: english }).flatMap((group) =>
      group.results.map((result) => result.title),
    );
    expect(titles).not.toContain("Price position");
  });
});
