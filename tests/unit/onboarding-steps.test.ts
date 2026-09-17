// @vitest-environment node
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  buildSetupSteps,
  SETUP_STEP_IDS,
  type SetupChecklistData,
  type SetupFacts,
  type SetupStepId,
} from "@/lib/onboarding/steps";
import { resolveProductPage } from "@/lib/storefront/product-page";
import { DEFAULT_PRODUCT_PAGE_CONFIG, type StorefrontConfig } from "@/types/storefront";

/**
 * The setup checklist is derived, never stored, so these tests are the only
 * record of what "done" means for each step. The one that matters most is the
 * last: "live" must use the public page's own rules, or the checklist hands a
 * seller a link to copy that 404s.
 */

const APP_DIR = join(process.cwd(), "src", "app");

/** Same resolver as dashboard-attention.test.ts: route groups are transparent,
 *  "[param]" matches any one segment, a route needs a page.tsx. */
function routeExists(href: string): boolean {
  const segments = href.split(/[?#]/)[0].split("/").filter(Boolean);
  const walk = (dir: string, rest: string[]): boolean => {
    if (rest.length === 0 && existsSync(join(dir, "page.tsx"))) return true;
    const [head, ...tail] = rest;
    for (const entry of readdirSync(dir)) {
      if (!statSync(join(dir, entry)).isDirectory()) continue;
      if (entry.startsWith("(") && entry.endsWith(")")) {
        if (walk(join(dir, entry), rest)) return true;
        continue;
      }
      if (rest.length === 0) continue;
      if ((entry === head || /^\[.+\]$/.test(entry)) && walk(join(dir, entry), tail)) {
        return true;
      }
    }
    return false;
  };
  return walk(APP_DIR, segments);
}

type Block = StorefrontConfig["blocks"][number];

function productBlock(productId: string): Block {
  return { type: "product", productId } as Block;
}

function storefront(
  id: string,
  blocks: Block[],
  pagesEnabled?: boolean,
): SetupFacts["storefronts"][number] {
  return {
    id,
    config: {
      blocks,
      ...(pagesEnabled === undefined
        ? {}
        : { productPage: { ...DEFAULT_PRODUCT_PAGE_CONFIG, enabled: pagesEnabled } }),
    },
  };
}

const NEW_SELLER: SetupFacts = {
  traderMissing: ["businessName", "address", "email"],
  productCount: 0,
  activeProductIds: [],
  existingProductIds: [],
  storefronts: [],
};

/** A seller one step from done: identity complete, one product placed. */
function placedSeller(overrides: Partial<SetupFacts> = {}): SetupFacts {
  return {
    traderMissing: [],
    productCount: 1,
    activeProductIds: ["p-1"],
    existingProductIds: ["p-1"],
    storefronts: [storefront("sf-1", [productBlock("p-1")], true)],
    ...overrides,
  };
}

function step(data: SetupChecklistData, id: SetupStepId) {
  const found = data.steps.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`no ${id} step`);
  return found;
}

describe("buildSetupSteps", () => {
  it("lists the four steps in the order a seller takes them", () => {
    expect(buildSetupSteps(NEW_SELLER).steps.map((s) => s.id)).toEqual([
      ...SETUP_STEP_IDS,
    ]);
  });

  it("starts a new seller at their seller details, with nothing done", () => {
    const data = buildSetupSteps(NEW_SELLER);

    expect(data.doneCount).toBe(0);
    expect(data.complete).toBe(false);
    expect(data.seller).toBe("missing");
    expect(data.livePage).toBeNull();

    const seller = step(data, "seller-details");
    // The gate's own deep link: the first field that is actually blank.
    expect(seller.action).toEqual({
      href: "/settings/tax#business-name",
      label: "Add details",
    });
    expect(data.next?.id).toBe("seller-details");

    expect(step(data, "product").action?.href).toBe("/products/new");
    expect(step(data, "storefront").action?.href).toBe("/storefront");
  });

  it("asks for the confirmation click, not more typing, when only that is left", () => {
    const data = buildSetupSteps({ ...NEW_SELLER, traderMissing: ["emailVerified"] });
    const seller = step(data, "seller-details");

    expect(data.seller).toBe("unconfirmed");
    expect(seller.done).toBe(false);
    expect(seller.action).toEqual({
      href: "/settings/tax#contact-email",
      label: "Confirm email",
    });
    expect(seller.cta).toBe("Confirm your email");
  });

  it("counts drafts as products", () => {
    expect(step(buildSetupSteps({ ...NEW_SELLER, productCount: 1 }), "product").detail).toBe(
      "You have 1 product.",
    );
    expect(step(buildSetupSteps({ ...NEW_SELLER, productCount: 3 }), "product").detail).toBe(
      "You have 3 products.",
    );
  });

  it("sends a seller with an empty storefront into its designer, newest first", () => {
    const data = buildSetupSteps({
      ...NEW_SELLER,
      storefronts: [storefront("sf-newest", []), storefront("sf-older", [])],
    });
    expect(step(data, "storefront").action).toEqual({
      href: "/storefront/sf-newest",
      label: "Open designer",
    });
  });

  it("does not count a block whose product was deleted as a placement", () => {
    const data = buildSetupSteps(
      placedSeller({ existingProductIds: [], activeProductIds: [] }),
    );
    expect(step(data, "storefront").done).toBe(false);
    expect(step(data, "publish").done).toBe(false);
  });

  it("ignores blocks that are not products", () => {
    const data = buildSetupSteps(
      placedSeller({
        storefronts: [storefront("sf-1", [{ type: "text" } as Block], true)],
      }),
    );
    expect(step(data, "storefront").done).toBe(false);
  });

  it("points a placed draft at its editor to publish it", () => {
    const data = buildSetupSteps(placedSeller({ activeProductIds: [] }));
    const publish = step(data, "publish");
    expect(publish.done).toBe(false);
    expect(publish.action).toEqual({ href: "/products/p-1/edit", label: "Edit product" });
    expect(publish.cta).toBe("Publish your product");
  });

  it("points at the designer when the only placement has product pages switched off", () => {
    const data = buildSetupSteps(
      placedSeller({ storefronts: [storefront("sf-1", [productBlock("p-1")], false)] }),
    );
    const publish = step(data, "publish");
    expect(publish.done).toBe(false);
    expect(publish.action).toEqual({ href: "/storefront/sf-1", label: "Open designer" });
    expect(publish.cta).toBe("Turn on product pages");
  });

  it("calls a page live only when the public gate would open it", () => {
    const data = buildSetupSteps(placedSeller());
    expect(step(data, "publish").done).toBe(true);
    expect(data.complete).toBe(true);
    expect(data.next).toBeNull();
    expect(data.livePage).toEqual({
      storefrontId: "sf-1",
      productId: "p-1",
      path: "/s/sf-1/p/p-1",
    });
  });

  it("holds the publish step while the contact email is unconfirmed, with no link of its own", () => {
    // An unconfirmed address 404s every product page, so nothing is live yet,
    // and the seller-details row already carries the way to fix it.
    const data = buildSetupSteps(placedSeller({ traderMissing: ["emailVerified"] }));
    const publish = step(data, "publish");
    expect(publish.done).toBe(false);
    expect(publish.action).toBeUndefined();
    expect(data.livePage).toBeNull();
    expect(data.next?.id).toBe("seller-details");
  });

  it("treats a storefront with no stored product page options as the defaults", () => {
    const data = buildSetupSteps(
      placedSeller({ storefronts: [storefront("sf-1", [productBlock("p-1")])] }),
    );
    expect(step(data, "publish").done).toBe(resolveProductPage({}).enabled);
  });

  it("does not send a seller off to wait for an email while there is something else to do", () => {
    const waiting = buildSetupSteps({ ...NEW_SELLER, traderMissing: ["emailVerified"] });
    expect(waiting.next?.id).toBe("product");
  });

  it("offers the first unfinished step that has somewhere to go as next", () => {
    const data = buildSetupSteps({ ...NEW_SELLER, traderMissing: [] });
    expect(data.next?.id).toBe("product");
    expect(data.next?.cta).toBe("Add your first product");
  });

  it("only ever links to routes that exist", () => {
    const branches = [
      buildSetupSteps(NEW_SELLER),
      buildSetupSteps({ ...NEW_SELLER, traderMissing: ["emailVerified"] }),
      buildSetupSteps({ ...NEW_SELLER, storefronts: [storefront("sf-1", [])] }),
      buildSetupSteps(placedSeller({ activeProductIds: [] })),
      buildSetupSteps(
        placedSeller({ storefronts: [storefront("sf-1", [productBlock("p-1")], false)] }),
      ),
    ];
    const broken = branches
      .flatMap((data) => data.steps)
      .flatMap((s) => (s.action ? [s.action.href] : []))
      .filter((href) => !routeExists(href));
    expect(broken).toEqual([]);
  });
});
