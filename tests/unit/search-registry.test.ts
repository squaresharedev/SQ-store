import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MAIN_NAV,
  SETTINGS_LINK,
  SETTINGS_NAV,
} from "@/lib/search/nav-constants";
import { searchLocalRegistry } from "@/lib/search/registry";
import type { SearchGroup, SearchResult } from "@/lib/search/types";

/** Flatten groups to the rows the palette would render. */
function rows(groups: SearchGroup[]): SearchResult[] {
  return groups.flatMap((group) => group.results);
}

function hrefs(groups: SearchGroup[]): (string | undefined)[] {
  return rows(groups).map((result) => result.href);
}

/** Owner sees everything; used wherever the permission gate isn't the subject. */
const AS_OWNER = { role: "owner" as const, limit: 50 };

describe("local search registry — coverage", () => {
  it("indexes every dashboard nav route", () => {
    for (const link of [...MAIN_NAV, SETTINGS_LINK]) {
      const found = searchLocalRegistry(link.label, AS_OWNER);
      expect(
        hrefs(found),
        `"${link.label}" (${link.href}) is in the sidebar but not findable`,
      ).toContain(link.href);
    }
  });

  it("indexes every settings section", () => {
    for (const link of SETTINGS_NAV) {
      const found = searchLocalRegistry(link.label, AS_OWNER);
      expect(
        hrefs(found),
        `"${link.label}" (${link.href}) is in the settings rail but not findable`,
      ).toContain(link.href);
    }
  });

  it("gives every entry a unique id", () => {
    // Ids become DOM ids for aria-activedescendant; a duplicate silently points
    // the screen reader at the wrong row.
    const all = rows(searchLocalRegistry("e", { role: "owner", limit: 500 }));
    const ids = all.map((result) => result.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("local search registry — matching by intent", () => {
  const cases: [query: string, expectedHref: string][] = [
    ["handle", "/settings/account#username"],
    ["sign in name", "/settings/account#username"],
    // One name since the merge, so the old display-name vocabulary has to
    // land on the username field rather than 404 into a dead anchor.
    ["store name", "/settings/account#username"],
    ["display name", "/settings/account#username"],
    ["nickname", "/settings/account#username"],
    ["log out", "/settings/account#sign-out"],
    ["logout", "/settings/account#sign-out"],
    ["change password", "/settings/account#password"],
    ["avatar", "/settings/account#avatar"],
    ["vat", "/settings/tax#vat"],
    ["gdpr export", "/settings/danger#export"],
    ["close account", "/settings/danger#delete"],
    ["add product", "/products/new"],
    ["sell something", "/products/new"],
    ["add teammate", "/settings/team#invite"],
    ["catalogue", "/products"],
    ["payouts", "/payments"],
    ["stats", "/analytics"],
    ["shop", "/storefront"],
  ];

  for (const [query, expectedHref] of cases) {
    it(`"${query}" finds ${expectedHref}`, () => {
      expect(hrefs(searchLocalRegistry(query, AS_OWNER))).toContain(expectedHref);
    });
  }

  it("finds nothing for a query that matches nothing", () => {
    expect(rows(searchLocalRegistry("zzzzqqqq", AS_OWNER))).toHaveLength(0);
  });
});

describe("local search registry — searching the way people type", () => {
  /** The FIRST row, which is also the one Enter activates. */
  function top(query: string): string | undefined {
    return rows(searchLocalRegistry(query, AS_OWNER))[0]?.href;
  }

  const cases: [query: string, expectedHref: string][] = [
    // A DESCRIPTION rather than a name. None of these strings appears in any
    // label; each is assembled out of a label, a subtitle and a synonym.
    ["store bg color", "/storefront?setting=background"],
    ["storefront background colour", "/storefront?setting=background"],
    ["i want to change the colour of my shop background", "/storefront?setting=background"],
    ["space between products", "/storefront?setting=grid-gap"],
    ["how many columns", "/storefront?setting=canvas-size"],
    ["where is the price", "/storefront?setting=price-position"],
    ["make my store name bigger", "/storefront?setting=header"],
    ["how do i change my password", "/settings/account#password"],
    ["download my data", "/settings/danger#export"],

    // MISSPELLED, in the label, in a synonym, and across a whole sentence.
    ["bacground", "/storefront?setting=background"],
    ["passwrod", "/settings/account#password"],
    ["carosel", "/storefront?setting=display-mode"],
    ["notifcations", "/settings/notifications"],
    ["stroefront", "/storefront"],
    ["chnage the bacground colur of my stor", "/storefront?setting=background"],

    // ABBREVIATED and shortened.
    ["bg", "/storefront?setting=background"],
    ["profile pic", "/settings/account#avatar"],
    ["delete my acct", "/settings/danger#delete"],
    ["cs", "/storefront?setting=canvas-size"],

    // SPELLED the other way round from the label.
    ["accent color", "/storefront?setting=accent"],
    ["corner roundness", "/storefront?setting=corner-radius"],
  ];

  for (const [query, expectedHref] of cases) {
    it(`"${query}" leads with ${expectedHref}`, () => {
      expect(top(query)).toBe(expectedHref);
    });
  }

  it("orders the GROUPS by what answered, not by a fixed shelf order", () => {
    // Pages-then-actions-then-settings is right for the resting palette and
    // wrong for a query: it put the Orders page above Corner roundness for
    // "corners", and the first row is what Enter activates.
    expect(top("make the corners rounder")).toBe(
      "/storefront?setting=corner-radius",
    );
    expect(top("upload a font")).toBe("/storefront?setting=font");
  });

  it("still leads with the page when the page IS the answer", () => {
    expect(top("analytics")).toBe("/analytics");
    expect(top("orders")).toBe("/orders");
  });

  it("does not invent matches for a query nothing knows", () => {
    for (const query of ["zzzzqqqq", "qwertyuiop", "xylophone"]) {
      expect(rows(searchLocalRegistry(query, AS_OWNER)), query).toHaveLength(0);
    }
  });
});

describe("local search registry — empty query", () => {
  it("suggests actions and curated settings — and NO pages", () => {
    const groups = searchLocalRegistry("", AS_OWNER);
    expect(rows(groups).length).toBeGreaterThan(0);
    expect(groups.map((group) => group.label)).toEqual(["Actions", "Settings"]);
    // The sidebar already shows every page; recommending them is noise. They
    // must stay SEARCHABLE, just never suggested.
    expect(rows(groups).some((result) => result.type === "page")).toBe(false);
  });

  it("pages stay searchable even though they are never suggested", () => {
    expect(hrefs(searchLocalRegistry("analytics", AS_OWNER))).toContain(
      "/analytics",
    );
    expect(hrefs(searchLocalRegistry("overview", AS_OWNER))).toContain(
      "/dashboard",
    );
  });

  it("surfaces the buried intents, not just the tabs already in the sidebar", () => {
    // The point of the curation: reset password, export data etc. are what
    // people open search FOR — the sidebar already shows the pages.
    const suggested = hrefs(searchLocalRegistry("", AS_OWNER));
    expect(suggested).toContain("/settings/account#password");
    expect(suggested).toContain("/settings/danger#export");
    expect(suggested).toContain("/settings/account#username");
    expect(suggested).toContain("/products/new");
  });

  it("keeps the curation permission-gated for a viewer", () => {
    const suggested = hrefs(searchLocalRegistry("", { role: "viewer", limit: 50 }));
    expect(suggested).not.toContain("/products/new");
    expect(suggested).toContain("/settings/account#password");
  });

  it("treats whitespace as empty", () => {
    expect(rows(searchLocalRegistry("   ", AS_OWNER))).toEqual(
      rows(searchLocalRegistry("", AS_OWNER)),
    );
  });
});

describe("local search registry — permission gate", () => {
  it("hides write actions from a viewer", () => {
    const viewer = searchLocalRegistry("product", { role: "viewer", limit: 50 });
    expect(hrefs(viewer)).not.toContain("/products/new");
    // ...but the read-only page is still offered.
    expect(hrefs(viewer)).toContain("/products");
  });

  it("offers write actions to an editor", () => {
    const editor = searchLocalRegistry("product", { role: "editor", limit: 50 });
    expect(hrefs(editor)).toContain("/products/new");
  });

  it("hides invite from a viewer but not from an editor", () => {
    expect(
      hrefs(searchLocalRegistry("invite", { role: "viewer", limit: 50 })),
    ).not.toContain("/settings/team#invite");
    expect(
      hrefs(searchLocalRegistry("invite", { role: "editor", limit: 50 })),
    ).toContain("/settings/team#invite");
  });

  it("hides every gated action when the role is unknown", () => {
    // Fail closed: no role resolved yet means no privileged suggestion.
    const anonymous = searchLocalRegistry("product", { role: null, limit: 50 });
    expect(hrefs(anonymous)).not.toContain("/products/new");
  });
});

describe("local search registry — deep links land somewhere", () => {
  /** Every `id="…"` written anywhere under src/components/settings. */
  function settingsAnchors(): Set<string> {
    const root = join(process.cwd(), "src/components/settings");
    const found = new Set<string>();
    const walk = (dir: string) => {
      for (const item of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, item.name);
        if (item.isDirectory()) walk(path);
        else if (item.name.endsWith(".tsx")) {
          for (const match of readFileSync(path, "utf8").matchAll(
            /\bid=(?:"([^"]+)"|\{"([^"]+)"\})/g,
          )) {
            found.add(match[1] ?? match[2]);
          }
        }
      }
    };
    walk(root);
    return found;
  }

  it("every settings hash the registry points at exists as an anchor", () => {
    // Without this, renaming a section id silently turns "change my username"
    // into a link to the top of a long page — the exact failure the deep links
    // were added to avoid, and one nothing else would catch.
    const anchors = settingsAnchors();
    const hashed = rows(searchLocalRegistry("", { role: "owner", limit: 500 }))
      .concat(
        // The empty query only returns pages, so sweep the fields too.
        ...["username", "email", "vat", "export", "delete", "invite", "sign out",
            "password", "avatar", "display name", "country", "business",
            "sales emails", "marketing"].map((q) =>
          rows(searchLocalRegistry(q, { role: "owner", limit: 500 })),
        ),
      )
      .map((result) => result.href)
      .filter((href): href is string => Boolean(href?.includes("#")));

    expect(hashed.length).toBeGreaterThan(8);
    for (const href of new Set(hashed)) {
      const hash = href.split("#")[1];
      expect(anchors, `${href} points at an id that does not exist`).toContain(hash);
    }
  });
});

describe("local search registry — shape", () => {
  it("never returns an empty group", () => {
    for (const query of ["", "product", "settings", "zzzz"]) {
      const groups = searchLocalRegistry(query, AS_OWNER);
      expect(groups.every((group) => group.results.length > 0)).toBe(true);
    }
  });

  it("respects the limit across all groups combined", () => {
    expect(rows(searchLocalRegistry("e", { role: "owner", limit: 3 })).length)
      .toBeLessThanOrEqual(3);
  });

  it("gives every result a title and an href", () => {
    for (const result of rows(searchLocalRegistry("a", AS_OWNER))) {
      expect(result.title).toBeTruthy();
      expect(result.href).toBeTruthy();
    }
  });
});
