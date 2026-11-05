import { notFound } from "next/navigation";
import { buildSetupSteps, type SetupFacts, type SetupStepId } from "@/lib/onboarding/steps";
import { DEFAULT_PRODUCT_PAGE_CONFIG, type StorefrontConfig } from "@/types/storefront";
import { OnboardingGallery } from "./OnboardingGallery";

// Living reference for onboarding (components/onboarding): the welcome flow at
// each of its steps with faked saves, the setup checklist in every state
// buildSetupSteps can produce, and the seller-details banner as an owner and as
// a team member. No account and no database. Dev-only: the route 404s in
// production builds.

export const metadata = { title: "Onboarding: dev gallery" };

type Block = StorefrontConfig["blocks"][number];

const block = (productId: string) => ({ type: "product", productId }) as Block;
const pagesOn = { ...DEFAULT_PRODUCT_PAGE_CONFIG, enabled: true };
const pagesOff = { ...DEFAULT_PRODUCT_PAGE_CONFIG, enabled: false };

const NEW_SELLER: SetupFacts = {
  traderMissing: ["businessName", "address", "email"],
  productCount: 0,
  activeProductIds: [],
  existingProductIds: [],
  storefronts: [],
};

const PLACED: SetupFacts = {
  traderMissing: [],
  productCount: 1,
  activeProductIds: ["p-demo"],
  existingProductIds: ["p-demo"],
  storefronts: [{ id: "sf-demo", config: { blocks: [block("p-demo")], productPage: pagesOn } }],
};

// Built here, on the server, from the real builder: the gallery shows exactly
// what Overview would, never a hand-written imitation of it.
const HALFWAY: SetupFacts = {
  ...NEW_SELLER,
  traderMissing: [],
  productCount: 2,
  storefronts: [{ id: "sf-demo", config: { blocks: [] } }],
};

const CHECKLISTS: {
  name: string;
  facts: SetupFacts;
  celebrate?: boolean;
  wide?: boolean;
  /** Steps played as just done (Overview works these out from the setup-seen
   *  cookie; here they are given). */
  fresh?: SetupStepId[];
}[] = [
  // Overview gives the card its full width, and the trail beside the steps
  // widens with the card, so one fixture shows it at that size.
  { name: "Halfway, full width (as on Overview)", facts: HALFWAY, wide: true },
  {
    name: "Just added a product (plays its moment)",
    facts: HALFWAY,
    fresh: ["product"],
    wide: true,
  },
  {
    name: "Details and a product since last visit (plays both, in order)",
    facts: HALFWAY,
    fresh: ["seller-details", "product"],
  },
  {
    name: "Just placed on a storefront (plays its moment)",
    facts: { ...PLACED, activeProductIds: [] },
    fresh: ["storefront"],
  },
  { name: "New seller", facts: NEW_SELLER },
  {
    name: "Details typed, email unconfirmed, one draft",
    facts: { ...NEW_SELLER, traderMissing: ["emailVerified"], productCount: 1 },
  },
  {
    name: "Storefront created, nothing placed",
    facts: {
      ...NEW_SELLER,
      traderMissing: [],
      productCount: 2,
      storefronts: [{ id: "sf-demo", config: { blocks: [] } }],
    },
  },
  { name: "Placed, but still a draft", facts: { ...PLACED, activeProductIds: [] } },
  {
    name: "Active, product pages switched off",
    facts: {
      ...PLACED,
      storefronts: [{ id: "sf-demo", config: { blocks: [block("p-demo")], productPage: pagesOff } }],
    },
  },
  { name: "Complete, not shown yet", facts: PLACED, celebrate: true },
  // The card has been shown once already, so nothing renders: the fixture's
  // caption over an empty space is the thing to check.
  { name: "Complete, already shown (renders nothing)", facts: PLACED, celebrate: false },
];

export default function OnboardingDevPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <OnboardingGallery
      checklists={CHECKLISTS.map(({ name, facts, celebrate, wide, fresh }) => ({
        name,
        setup: buildSetupSteps(facts),
        celebrate: celebrate ?? true,
        wide: wide ?? false,
        fresh: fresh ?? [],
      }))}
    />
  );
}
