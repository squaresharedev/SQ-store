// THE SETUP CHECKLIST, derived rather than stored.
//
// What a seller still has to do before something of theirs is live on a page a
// buyer can open, worked out on every render from facts that already have a
// home: the trader identity (the publish gate), the products, and the blocks
// placed on each storefront. Overview's "Get set up" card renders it, the
// welcome flow's closing button reads its next step, and the card publishes it
// as data-setup-* attributes.
//
// NOTHING HERE IS STORED. Progress kept in a column would be a second copy of
// those facts, and a second copy drifts: a seller who sets their last product
// back to draft must see the publish step come back, not a tick that lies.
//
// PURE ON PURPOSE, like lib/dashboard/attention.ts beside it, so every branch
// and every destination can be asserted without a database.
//
// "LIVE" MIRRORS THE PUBLIC READ GATE (lib/products/public.ts): a product page
// answers only when its storefront has product pages switched on, the product
// has a block on that storefront, the product is active, and the trader
// identity is complete. Calling a page live on any looser rule would hand the
// seller a link to copy that 404s.

import type { StorefrontConfig } from "@/types/storefront";
import { msg, type MessageRef } from "@/i18n/types";
import {
  traderIdentityHref,
  type TraderIdentityField,
} from "@/lib/settings/trader-identity";
import { resolveProductPage } from "@/lib/storefront/product-page";
import { productPagePath } from "@/lib/storefront/product-page-url";

/** The steps, in the order a seller takes them. */
export const SETUP_STEP_IDS = ["seller-details", "product", "storefront", "publish"] as const;
export type SetupStepId = (typeof SETUP_STEP_IDS)[number];

/** Every piece of copy on a step is a MessageRef, resolved where it renders. */
export type SetupStep = {
  id: SetupStepId;
  label: MessageRef;
  done: boolean;
  /** One line under the label: what done means, or what is in the way. */
  detail: MessageRef;
  /**
   * Where to go to take the step. Absent while the step is waiting on an
   * EARLIER one, so a row never offers a link to a surface that cannot help
   * yet (publishing before there is anything placed to publish).
   */
  action?: { href: string; label: MessageRef };
  /** The same destination phrased as a call to action, for the welcome flow's
   *  closing button ("Add your first product"). */
  cta: MessageRef;
};

/** Where the trader identity stands: not typed yet, typed but the contact
 *  email is unconfirmed, or complete. */
export type SellerSetupState = "done" | "missing" | "unconfirmed";

export type SetupFacts = {
  /** getTraderIdentityStatus(accountId).missing: the gate's own answer. */
  traderMissing: readonly TraderIdentityField[];
  /** Every product the account owns, drafts included. */
  productCount: number;
  activeProductIds: readonly string[];
  /** The product ids referenced by storefront blocks that still exist. */
  existingProductIds: readonly string[];
  /** Newest edited first, as listStorefronts returns them. */
  storefronts: readonly {
    id: string;
    config: Pick<StorefrontConfig, "blocks" | "productPage">;
  }[];
};

export type LivePage = { storefrontId: string; productId: string; path: string };

export type SetupChecklistData = {
  steps: SetupStep[];
  doneCount: number;
  total: number;
  complete: boolean;
  seller: SellerSetupState;
  /** The first product page a buyer can actually open, when there is one. */
  livePage: LivePage | null;
  /**
   * The first unfinished step the seller can take RIGHT NOW. A confirmation
   * link waiting in their inbox is skipped while anything else is left to do:
   * sending someone to a settings page to wait for an email is not a step.
   */
  next: SetupStep | null;
};

/** The fields a seller TYPES. `emailVerified` is a click, not a field. */
const TYPED_TRADER_FIELDS: readonly TraderIdentityField[] = [
  "businessName",
  "address",
  "email",
];

function sellerState(missing: readonly TraderIdentityField[]): SellerSetupState {
  if (missing.some((field) => TYPED_TRADER_FIELDS.includes(field))) return "missing";
  return missing.includes("emailVerified") ? "unconfirmed" : "done";
}

type Placement = { storefrontId: string; productId: string; pagesOn: boolean };

export function buildSetupSteps(facts: SetupFacts): SetupChecklistData {
  const seller = sellerState(facts.traderMissing);
  const existing = new Set(facts.existingProductIds);
  const active = new Set(facts.activeProductIds);

  // Every product block that points at a product which still exists, in the
  // order the storefronts arrive, so the first match is on the storefront the
  // seller edited last. A block whose product was deleted is not a placement:
  // its page cannot open.
  const placed: Placement[] = facts.storefronts.flatMap((storefront) => {
    const pagesOn = resolveProductPage(storefront.config).enabled;
    return storefront.config.blocks.flatMap((block) =>
      block.type === "product" && existing.has(block.productId)
        ? [{ storefrontId: storefront.id, productId: block.productId, pagesOn }]
        : [],
    );
  });
  const placedActive = placed.filter((placement) => active.has(placement.productId));
  const live =
    seller === "done" ? placedActive.find((placement) => placement.pagesOn) : undefined;

  const steps: SetupStep[] = [
    sellerStep(seller, facts.traderMissing),
    productStep(facts.productCount),
    storefrontStep(placed.length > 0, facts.storefronts[0]?.id ?? null),
    publishStep({ seller, live: live !== undefined, placed, placedActive }),
  ];
  const doneCount = steps.filter((step) => step.done).length;

  return {
    steps,
    doneCount,
    total: steps.length,
    complete: doneCount === steps.length,
    seller,
    livePage: live
      ? {
          storefrontId: live.storefrontId,
          productId: live.productId,
          path: productPagePath(live.storefrontId, live.productId),
        }
      : null,
    next:
      steps.find(
        (step) =>
          !step.done &&
          step.action !== undefined &&
          !(step.id === "seller-details" && seller === "unconfirmed"),
      ) ??
      steps.find((step) => !step.done && step.action !== undefined) ??
      null,
  };
}

function sellerStep(
  seller: SellerSetupState,
  missing: readonly TraderIdentityField[],
): SetupStep {
  const base = {
    id: "seller-details",
    label: msg("Onboarding.steps.seller.label"),
  } as const;
  if (seller === "done") {
    return {
      ...base,
      done: true,
      detail: msg("Onboarding.steps.seller.detailDone"),
      cta: msg("Onboarding.steps.seller.cta"),
    };
  }
  // The gate's own deep link lands on the first field still missing, or on the
  // contact email when all that is left is the confirmation click.
  const href = traderIdentityHref(missing);
  if (seller === "unconfirmed") {
    return {
      ...base,
      done: false,
      detail: msg("Onboarding.steps.seller.detailUnconfirmed"),
      action: { href, label: msg("Onboarding.steps.seller.actionUnconfirmed") },
      cta: msg("Onboarding.steps.seller.ctaUnconfirmed"),
    };
  }
  return {
    ...base,
    done: false,
    detail: msg("Onboarding.steps.seller.detail"),
    action: { href, label: msg("Onboarding.steps.seller.action") },
    cta: msg("Onboarding.steps.seller.cta"),
  };
}

function productStep(productCount: number): SetupStep {
  const base = {
    id: "product",
    label: msg("Onboarding.steps.product.label"),
    cta: msg("Onboarding.steps.product.cta"),
  } as const;
  if (productCount > 0) {
    return {
      ...base,
      done: true,
      detail: msg("Onboarding.steps.product.detailDone", { count: productCount }),
    };
  }
  return {
    ...base,
    done: false,
    detail: msg("Onboarding.steps.product.detail"),
    action: { href: "/products/new", label: msg("Onboarding.steps.product.action") },
  };
}

function storefrontStep(anyPlaced: boolean, newestStorefrontId: string | null): SetupStep {
  const base = {
    id: "storefront",
    label: msg("Onboarding.steps.storefront.label"),
  } as const;
  if (anyPlaced) {
    return {
      ...base,
      done: true,
      detail: msg("Onboarding.steps.storefront.detailDone"),
      cta: msg("Onboarding.steps.storefront.cta"),
    };
  }
  if (newestStorefrontId === null) {
    return {
      ...base,
      done: false,
      detail: msg("Onboarding.steps.storefront.detailNone"),
      action: { href: "/storefront", label: msg("Onboarding.steps.storefront.actionCreate") },
      cta: msg("Onboarding.steps.storefront.ctaCreate"),
    };
  }
  return {
    ...base,
    done: false,
    detail: msg("Onboarding.steps.storefront.detailEmpty"),
    action: {
      href: `/storefront/${newestStorefrontId}`,
      label: msg("Onboarding.steps.storefront.actionOpen"),
    },
    cta: msg("Onboarding.steps.storefront.cta"),
  };
}

function publishStep({
  seller,
  live,
  placed,
  placedActive,
}: {
  seller: SellerSetupState;
  live: boolean;
  placed: readonly Placement[];
  placedActive: readonly Placement[];
}): SetupStep {
  const base = { id: "publish", label: msg("Onboarding.steps.publish.label") } as const;
  const cta = msg("Onboarding.steps.publish.cta");
  if (live) {
    return { ...base, done: true, detail: msg("Onboarding.steps.publish.detailDone"), cta };
  }
  // Blocked on an earlier step: say which, and offer no link of its own, since
  // that step's row already carries the way to fix it.
  if (seller !== "done") {
    return {
      ...base,
      done: false,
      detail: msg("Onboarding.steps.publish.detailNeedsSeller"),
      cta,
    };
  }
  if (placed.length === 0) {
    return {
      ...base,
      done: false,
      detail: msg("Onboarding.steps.publish.detailNeedsStorefront"),
      cta,
    };
  }
  if (placedActive.length === 0) {
    return {
      ...base,
      done: false,
      detail: msg("Onboarding.steps.publish.detailNeedsActive"),
      action: {
        href: `/products/${placed[0].productId}/edit`,
        label: msg("Onboarding.steps.publish.actionEdit"),
      },
      cta,
    };
  }
  return {
    ...base,
    done: false,
    detail: msg("Onboarding.steps.publish.detailPagesOff"),
    action: {
      href: `/storefront/${placedActive[0].storefrontId}`,
      label: msg("Onboarding.steps.publish.actionOpen"),
    },
    cta: msg("Onboarding.steps.publish.ctaPagesOff"),
  };
}
