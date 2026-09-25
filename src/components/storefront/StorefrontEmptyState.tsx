"use client";

import { useTranslations } from "next-intl";
import { emptyShowcaseClass } from "@/components/ui/surface-styles";
import { AddShowcase } from "@/components/ui/AddShowcase";
import type { Product } from "@/types/product";
import {
  DEFAULT_STOREFRONT_CONFIG,
  EMPTY_STOREFRONT_HEADER,
  type StorefrontConfig,
} from "@/types/storefront";
import { StorefrontPreview } from "./StorefrontPreview";

/**
 * The two storefronts either side of the create card. Kept deliberately plain:
 * three clean studio shots each (real product photos from /public/empty-state,
 * taken from the marketing site) on a light grey canvas with softly rounded
 * tiles, and no words, so they read as "a shop" at a glance and nothing on them
 * competes with the card. Drawn by the real StorefrontPreview, so they can
 * never drift from how a storefront actually renders.
 *
 * Mirrored: each board's big tile is on its OUTER side, away from the card, so
 * the part tucked under the card is small tiles rather than the hero picture.
 *
 * The products are display-only stand-ins: nothing reads them but the preview.
 */
const PHOTOS = ["camera", "headphones", "mouse", "succulent-photo", "watch-photo", "watch-white"] as const;
type Photo = (typeof PHOTOS)[number];

const PRODUCTS = new Map<Photo, Product>(
  PHOTOS.map((key, index) => [
    key,
    {
      id: `e5a3e1d2-0c4f-4b6e-9a61-${String(index + 1).padStart(12, "0")}`,
      title: key,
      description: "",
      price: 0,
      currency: "EUR",
      status: "active",
      imageUrl: `/empty-state/tile-${key}.webp`,
      digitalFileName: null,
      trackStock: false,
      stockQuantity: null,
      lowStockThreshold: 3,
      maxPerOrder: 10,
    },
  ]),
);
const PRODUCTS_BY_ID: ReadonlyMap<string, Product> = new Map(
  [...PRODUCTS.values()].map((product) => [product.id, product]),
);

const tile = (key: Photo, x: number, y: number, w: number, h: number) =>
  ({ type: "product", productId: PRODUCTS.get(key)!.id, x, y, w, h }) as const;

function board(blocks: StorefrontConfig["blocks"]): StorefrontConfig {
  return {
    ...DEFAULT_STOREFRONT_CONFIG,
    theme: {
      ...DEFAULT_STOREFRONT_CONFIG.theme,
      background: { kind: "solid", color: "#f4f4f5" },
      cornerRadius: 8,
      gridGap: 6,
      columns: 3,
      rows: 2,
    },
    header: EMPTY_STOREFRONT_HEADER,
    blocks,
  };
}

const LEFT_SHOP = board([
  tile("camera", 0, 0, 2, 2),
  tile("headphones", 2, 0, 1, 1),
  tile("mouse", 2, 1, 1, 1),
]);

const RIGHT_SHOP = board([
  tile("watch-white", 0, 0, 1, 1),
  tile("watch-photo", 0, 1, 1, 1),
  tile("succulent-photo", 1, 0, 2, 2),
]);

function Board({ config }: { config: StorefrontConfig }) {
  return (
    // The rounding and the clip live here, not on the showcase's side slot.
    <div className="size-full overflow-hidden rounded-lg shadow-lg ring-1 ring-black/5">
      <StorefrontPreview config={config} productsById={PRODUCTS_BY_ID} textless />
    </div>
  );
}

/**
 * The storefront list with nothing in it. The create card is the call to
 * action. `data-tour` goes on that card: it is one of the list's two create
 * buttons.
 */
export function StorefrontEmptyState({
  canWrite,
  onCreate,
  creating = false,
  "data-tour": dataTour,
}: {
  canWrite: boolean;
  onCreate: () => void;
  /** The setup flow has handed back an id and the route change is under way. */
  creating?: boolean;
  "data-tour"?: string;
}) {
  const t = useTranslations("Storefront.list");
  return (
    <div className={emptyShowcaseClass}>
      <div className="flex flex-col items-center">
        <AddShowcase
          card={
            canWrite
              ? {
                  onClick: onCreate,
                  disabled: creating,
                  label: creating ? t("creating") : t("create"),
                  className: "h-32 w-28 rounded-md sm:h-40 sm:w-44",
                  "data-tour": dataTour,
                }
              : undefined
          }
          className="[--showcase-tuck:1.25rem] sm:[--showcase-tuck:2rem]"
          exampleClassName="mt-10 aspect-[3/2] w-28 sm:w-56"
          left={<Board config={LEFT_SHOP} />}
          right={<Board config={RIGHT_SHOP} />}
        />
        <h2 className="mt-10 text-lg font-semibold text-foreground">
          {t("emptyHeading")}
        </h2>
        <p className="mt-1 max-w-sm font-inter text-sm text-muted-foreground">
          {canWrite ? t("emptyHintOwner") : t("emptyHintGuest")}
        </p>
      </div>
    </div>
  );
}
