"use client";

import { ReportDialog } from "@/components/product-page/ReportDialog";
import { BuyButtonDialog } from "@/components/products/BuyButtonDialog";
import { DecisionActions } from "@/components/products/DecisionActions";
import { ShippingTermsModal } from "@/components/products/ShippingTermsModal";
import { InviteModal } from "@/components/settings/team/InviteModal";
import { InvitePromptModal } from "@/components/settings/team/InvitePromptModal";
import { UnsavedChangesDialog } from "@/components/ui/UnsavedChangesDialog";
import type { Product } from "@/types/product";
import { EMPTY_SHIPPING_POLICY } from "@/types/shipping-policy";
import { PressOnMount, SAMPLE_PHOTO, type Specimen } from "./types";

const PRODUCT: Product = {
  id: "00000000-0000-4000-9000-000000000001",
  title: "Field camera",
  description: "",
  price: 240,
  currency: "EUR",
  status: "active",
  imageUrl: SAMPLE_PHOTO,
  digitalFileName: null,
  trackStock: false,
  stockQuantity: null,
  lowStockThreshold: 3,
  maxPerOrder: 10,
};

const STOREFRONT = { id: "00000000-0000-4000-9000-0000000000a1", name: "Parallel Goods" };

/** The buyer's report dialog owns its trigger (the footer link), so the
 *  specimen presses it. */
const report = (id: string, label: string, wider: boolean): Specimen => ({
  id: `report-${id}`,
  group: "Report (buyer)",
  label,
  kind: "dialog",
  render: () => (
    <PressOnMount selector="[data-report-trigger]">
      <div className="px-6 font-inter text-xs text-muted-foreground">
        <ReportDialog
          product={{ id: PRODUCT.id, title: PRODUCT.title }}
          storefront={STOREFRONT}
          sellerName="Parallel Goods e.U."
          scopes={{ storefront: wider, seller: wider }}
        />
      </div>
    </PressOnMount>
  ),
});

export const PRODUCTS: readonly Specimen[] = [
  report("product", "Report this product", false),
  report("any", "Report (product, storefront or seller)", true),
  {
    id: "guard-unsaved",
    group: "Leaving unsaved work",
    label: "Product form / designer",
    kind: "dialog",
    render: ({ onClose }) => (
      <UnsavedChangesDialog
        open
        title="Discard your changes?"
        description="The edits you've made to this product haven't been saved yet."
        saveLabel="Save and leave"
        savingLabel="Saving…"
        discardLabel="Discard changes"
        stayLabel="Keep editing"
        onSave={onClose}
        onDiscard={onClose}
        onStay={onClose}
      />
    ),
  },
  {
    id: "shipping-terms",
    group: "Shipping & returns (from the product form)",
    label: "Folded cards",
    kind: "dialog",
    render: ({ onClose }) => <ShippingTermsModal open onClose={onClose} policy={EMPTY_SHIPPING_POLICY} />,
  },
  {
    id: "appeal",
    group: "Moderation",
    label: "Appeal this decision",
    kind: "dialog",
    render: () => (
      <PressOnMount selector="[data-appeal-open]">
        <div className="px-6">
          <DecisionActions decisionId="00000000-0000-4000-9000-0000000000d1" appeal={null} canAppeal />
        </div>
      </PressOnMount>
    ),
  },
  {
    id: "buy-button",
    group: "Buy button",
    label: "Ready",
    kind: "dialog",
    render: ({ onClose }) => (
      <BuyButtonDialog
        product={PRODUCT}
        placements={[STOREFRONT]}
        canWrite
        missingTraderDetails={[]}
        onClose={onClose}
      />
    ),
  },
  {
    id: "buy-button-two",
    group: "Buy button",
    label: "Ready (on two storefronts)",
    kind: "dialog",
    render: ({ onClose }) => (
      <BuyButtonDialog
        product={PRODUCT}
        placements={[STOREFRONT, { id: "00000000-0000-4000-9000-0000000000a2", name: "Winter drop" }]}
        canWrite
        missingTraderDetails={[]}
        onClose={onClose}
      />
    ),
  },
  {
    id: "buy-button-draft",
    group: "Buy button",
    label: "Blocked (draft)",
    kind: "dialog",
    render: ({ onClose }) => (
      <BuyButtonDialog
        product={{ ...PRODUCT, status: "draft" }}
        placements={[STOREFRONT]}
        canWrite
        missingTraderDetails={[]}
        onClose={onClose}
      />
    ),
  },
  {
    id: "buy-button-unplaced",
    group: "Buy button",
    label: "Blocked (on no storefront)",
    kind: "dialog",
    render: ({ onClose }) => (
      <BuyButtonDialog product={PRODUCT} placements={[]} canWrite missingTraderDetails={[]} onClose={onClose} />
    ),
  },
  {
    id: "team-invite",
    group: "Team",
    label: "Invite a member",
    kind: "dialog",
    render: ({ onClose }) => (
      <InviteModal accountOwnerId="00000000-0000-4000-9000-0000000000b1" actorRole="owner" open onClose={onClose} />
    ),
  },
  {
    id: "team-invited",
    group: "Team",
    label: "You have a team invite",
    kind: "dialog",
    render: () => (
      <InvitePromptModal
        invites={[
          {
            id: "00000000-0000-4000-9000-0000000000c1",
            account_owner_id: "00000000-0000-4000-9000-0000000000b1",
            role: "editor",
            invited_at: "2026-10-01T10:00:00Z",
            store_name: "Parallel Goods",
          },
        ]}
      />
    ),
  },
];
