import { describe, expect, it } from "vitest";
import {
  allowedFor,
  entryTerms,
  searchCatalog,
  type SearchEntry,
} from "@/lib/search/catalog";
import { searchLocalRegistry } from "@/lib/search/registry";
import { searchEditor, editorEntries } from "@/components/storefront/editor-search";
import { STOREFRONT_SETTINGS, settingIndexFields } from "@/lib/storefront/setting-ref";

type Thing = { note: string };

function make(
  id: string,
  title: string,
  section: string,
  extra: Partial<SearchEntry<Thing>> = {},
): SearchEntry<Thing> {
  return { id, title, section, payload: { note: id }, ...extra };
}

const SECTIONS = [
  { key: "alpha", label: "Alpha" },
  { key: "beta", label: "Beta" },
];

describe("entryTerms", () => {
  it("is title, then subtitle, then keywords, in that order", () => {
    // The order is the contract: the ranker weights the first term highest,
    // and every surface puts its display name there.
    expect(
      entryTerms(
        make("x", "Background", "alpha", {
          subtitle: "Storefront / Theme",
          keywords: ["wallpaper", "backdrop"],
        }),
      ),
    ).toEqual(["Background", "Storefront / Theme", "wallpaper", "backdrop"]);
  });

  it("omits what is not there rather than leaving a hole", () => {
    expect(entryTerms(make("x", "Layers", "alpha"))).toEqual(["Layers"]);
  });

  it("returns the same array for the same entry", () => {
    // Memoised: the palette's entries are module constants matched on every
    // keystroke, and rebuilding these is pure waste.
    const entry = make("x", "Background", "alpha", { keywords: ["wallpaper"] });
    expect(entryTerms(entry)).toBe(entryTerms(entry));
  });
});

describe("allowedFor", () => {
  const entries = [
    make("open", "Open to all", "alpha"),
    make("gated", "Write something", "alpha", { permission: "products.write" }),
  ];

  it("keeps ungated entries for every role", () => {
    expect(allowedFor(entries, "viewer").map((e) => e.id)).toEqual(["open"]);
    expect(allowedFor(entries, "owner").map((e) => e.id)).toEqual([
      "open",
      "gated",
    ]);
  });

  it("fails closed when no role has resolved yet", () => {
    expect(allowedFor(entries, null).map((e) => e.id)).toEqual(["open"]);
    expect(allowedFor(entries, undefined).map((e) => e.id)).toEqual(["open"]);
  });
});

describe("searchCatalog", () => {
  const entries = [
    make("a1", "Refund policy", "alpha"),
    make("b1", "Refunds", "beta"),
    make("b2", "Payments", "beta"),
    make("a2", "Secret", "alpha", { permission: "products.write" }),
  ];

  it("groups hits under the section each entry declared", () => {
    const sections = searchCatalog(entries, "refund", {
      sections: SECTIONS,
      limit: 10,
    });
    expect(
      Object.fromEntries(
        sections.map((s) => [s.label, s.hits.map((h) => h.entry.id)]),
      ),
    ).toEqual({ Alpha: ["a1"], Beta: ["b1"] });
  });

  it("leads with the section holding the best row, not the declared order", () => {
    // Beta is declared second, and "refunds" is answered there exactly.
    const sections = searchCatalog(entries, "refunds", {
      sections: SECTIONS,
      limit: 10,
    });
    expect(sections.map((s) => s.key)).toEqual(["beta", "alpha"]);
  });

  it("falls back to the declared order for a genuine tie", () => {
    const tied = [make("a", "Widget", "alpha"), make("b", "Widget", "beta")];
    expect(
      searchCatalog(tied, "widget", { sections: SECTIONS, limit: 10 }).map(
        (s) => s.key,
      ),
    ).toEqual(["alpha", "beta"]);
  });

  it("drops empty sections rather than rendering a heading over nothing", () => {
    const sections = searchCatalog(entries, "payments", {
      sections: SECTIONS,
      limit: 10,
    });
    expect(sections.map((s) => s.key)).toEqual(["beta"]);
  });

  it("applies the limit across all sections combined", () => {
    const sections = searchCatalog(entries, "refund", {
      sections: SECTIONS,
      limit: 1,
    });
    expect(sections.flatMap((s) => s.hits)).toHaveLength(1);
  });

  it("gates on the role before ranking anything", () => {
    const asViewer = searchCatalog(entries, "secret", {
      sections: SECTIONS,
      limit: 10,
      role: "viewer",
    });
    expect(asViewer).toEqual([]);
    const asOwner = searchCatalog(entries, "secret", {
      sections: SECTIONS,
      limit: 10,
      role: "owner",
    });
    expect(asOwner.flatMap((s) => s.hits.map((h) => h.entry.id))).toEqual(["a2"]);
  });

  it("drops an entry whose section was never declared", () => {
    // A typo in a section key should be a missing group in development, never
    // an unlabelled one in front of a seller.
    const orphan = [make("lost", "Refunds", "gamma")];
    expect(searchCatalog(orphan, "refunds", { sections: SECTIONS, limit: 10 }))
      .toEqual([]);
  });

  it("says why a row matched, so a surface can explain itself", () => {
    const withSynonym = [
      make("bg", "Background", "alpha", { keywords: ["wallpaper"] }),
    ];
    const [section] = searchCatalog(withSynonym, "wallpaper", {
      sections: SECTIONS,
      limit: 10,
    });
    expect(section?.hits[0]?.matchedTerm).toBe("wallpaper");
  });

  it("returns nothing for an empty query rather than everything", () => {
    expect(searchCatalog(entries, "", { sections: SECTIONS, limit: 10 })).toEqual(
      [],
    );
    expect(searchCatalog(entries, "  ", { sections: SECTIONS, limit: 10 })).toEqual(
      [],
    );
  });
});

describe("the two surfaces agree about a setting", () => {
  // The bug this whole module exists to make unrepresentable: the palette
  // matched a storefront setting on [label, subtitle, ...keywords] and the
  // editor on [label, ...keywords], so the SAME setting ranked differently
  // depending on where you typed, while both files carried a comment
  // promising they could never disagree.

  it("indexes every setting on identical terms in both", () => {
    // With a page out, which is the state where the editor lists everything:
    // the product page's settings are gated on the page being on the canvas
    // (see editor-search), and that is a question of WHEN a row is offered,
    // never of what its terms are once it is.
    const editorBySetting = new Map(
      editorEntries([], new Map(), { pageOpen: true })
        .filter((entry) => entry.payload.kind === "setting")
        .map((entry) => [entry.title, entryTerms(entry)]),
    );

    for (const setting of STOREFRONT_SETTINGS) {
      const { title, subtitle, keywords } = settingIndexFields(setting);
      expect(editorBySetting.get(title), title).toEqual([
        title,
        subtitle,
        ...keywords,
      ]);
    }
  });

  it("hands the gated settings' whole vocabulary to the row standing in", () => {
    // The gate must cost the seller no query. Every term that would have found
    // a product page setting still has to find the row that opens the page.
    const closed = editorEntries([], new Map());
    const standIn = closed.find((entry) => entry.title === "Open the product page");
    expect(standIn).toBeDefined();
    const terms = new Set(entryTerms(standIn!));

    const open = editorEntries([], new Map(), { pageOpen: true });
    const gated = open.filter(
      (entry) =>
        entry.payload.kind === "setting" &&
        entry.payload.ref.kind === "productPage",
    );
    expect(gated.length).toBeGreaterThan(0);
    for (const entry of gated) {
      // Gone while the page is closed...
      expect(closed.some((row) => row.title === entry.title), entry.title).toBe(false);
      // ...but every word it answered to is still answered.
      for (const term of entryTerms(entry)) {
        expect(terms, `${entry.title}: ${term}`).toContain(term);
      }
    }
  });

  it("answers the same setting first for the same query", () => {
    for (const query of [
      "store bg colour",
      "corner rondness",
      "wallpaper",
      "space between products",
      "where is the price",
      "how many columns",
    ]) {
      const palette = searchLocalRegistry(query, { role: "owner", limit: 12 })
        .flatMap((group) => group.results)
        .find((result) => result.href?.includes("?setting="))?.title;
      const editor = searchEditor(editorEntries([], new Map()), query)
        .flatMap((section) => section.hits)
        .find((hit) => hit.entry.payload.kind === "setting")?.entry.title;
      expect(editor, query).toBe(palette);
    }
  });
});
