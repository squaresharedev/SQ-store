import { withholdObjectKeys } from "@/lib/agent/object-refs";
import type { OrderView } from "@/types/order-view";
import type { DiscountView } from "@/types/discount";
import type { Product, ProductDetail } from "@/types/product";

/**
 * WHAT AN ASSISTANT SEES of a record: built field by field, never passed
 * through, so a column added later cannot leak by default (docs/agent-surface.md,
 * B6). Money is integer cents with the unit in the name (B3). Image URLs are
 * signed and short-lived (B4), which the tool descriptions say.
 */

function priceCents(price: number): number {
  return Math.round(price * 100);
}

export function presentProduct(product: Product) {
  return {
    id: product.id,
    title: product.title,
    description: product.description,
    priceCents: priceCents(product.price),
    currency: product.currency,
    status: product.status,
    imageUrl: product.imageUrl,
    digitalFileName: product.digitalFileName,
    trackStock: product.trackStock,
    stockQuantity: product.stockQuantity,
    lowStockThreshold: product.lowStockThreshold,
    maxPerOrder: product.maxPerOrder,
    ...(product.removal ? { takenDown: product.removal } : {}),
  };
}

/** A whole product. Gallery and document files are named by handle, not by key,
 *  so they can be sent back on an update without anyone having seen a key. */
export async function presentProductDetail(product: ProductDetail) {
  return {
    ...presentProduct(product),
    gallery: await withholdObjectKeys(product.gallery),
    documents: await withholdObjectKeys(product.documents),
    optionGroups: await withholdObjectKeys(product.optionGroups),
    details: await withholdObjectKeys(product.details),
    purchaseUrl: product.purchaseUrl,
    shippingProfileId: product.shippingProfileId,
  };
}

export function presentOrder(order: OrderView) {
  return {
    id: order.id,
    productTitle: order.productTitle,
    selection: order.selection,
    quantity: order.quantity,
    amountCents: order.amountCents,
    platformFeeCents: order.platformFeeCents,
    platformFeeBps: order.platformFeeBps,
    currency: order.currency,
    channel: order.channel,
    status: order.status,
    fulfilment: order.fulfilment,
    buyerEmail: order.buyerEmail,
    shipTo: order.shipTo,
    giftMessage: order.giftMessage,
    withdrawalRequestedAt: order.withdrawalRequestedAt,
    discount: order.discount,
    refund: order.refund,
    stockReserved: order.stockReserved,
    paidThroughProvider: order.paidThroughProvider,
    createdAt: order.createdAt,
  };
}

export function presentDiscount(discount: DiscountView) {
  return {
    id: discount.id,
    kind: discount.kind,
    code: discount.code,
    shareChannel: discount.shareChannel,
    value: discount.value,
    appliesTo: discount.appliesTo,
    productIds: discount.productIds,
    startsAt: discount.startsAt,
    endsAt: discount.endsAt,
    usageLimit: discount.usageLimit,
    enabled: discount.enabled,
    createdAt: discount.createdAt,
  };
}
