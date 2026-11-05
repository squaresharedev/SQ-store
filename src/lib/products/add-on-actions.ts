"use server";

import { getActiveAccount } from "@/lib/team/account-context";
import { can } from "@/lib/team/permissions";
import {
  failure,
  invalidInput,
  notFound,
  permissionDenied,
  rateLimited,
  serverError,
  sessionExpired,
  type ActionFailure,
} from "@/lib/errors";
import { msg } from "@/i18n/types";
import { RATE_LIMITS, rateLimit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { toCurrency } from "@/lib/format/money";
import { settleAfterWrite } from "@/lib/moderation/auto/check";
import { addOnIdsSchema, productIdSchema } from "@/lib/validation/product";
import {
  getAddOnHabits,
  listAddOnChoices,
  listHiddenAddOns,
  type AddOnChoice,
} from "@/lib/products/add-on-choices";
import type { AddOnHabits } from "@/lib/predictions";
import { addOnRefusal } from "@/lib/products/add-on-refusal";
import { loadAddOnCards } from "@/lib/products/add-ons";
import { parseAddOnIds } from "@/lib/products/detail";
import type { AddOnCard, Currency, HiddenAddOn } from "@/types/product";

/** What the storefront editor's "Add to your order" panel needs for one product. */
export type AddOnPicker = {
  choices: AddOnChoice[];
  /** Stored, in the seller's order. */
  addOnIds: string[];
  isDigital: boolean;
  currency: Currency;
  /** Buy now goes to the seller's own link, whose page shows no add-ons. */
  ownBuyLink: boolean;
  /** What the store's history says goes with it, for the picker's guess. */
  habits: AddOnHabits;
};

/**
 * The store's products and what one of them offers now. Read when the panel
 * opens rather than with the editor, which is a presign per product that most
 * editing sessions never need.
 */
export async function getAddOnPicker(
  productId: unknown,
): Promise<{ ok: true; picker: AddOnPicker } | ActionFailure> {
  const account = await getActiveAccount();
  if (!account) return failure(sessionExpired());
  if (!can(account.role, "store.read")) {
    return failure(permissionDenied(account.role, "previewProductPages"));
  }
  const id = productIdSchema.safeParse(productId);
  if (!id.success) return failure(notFound("product"));
  if (!(await rateLimit("product_preview", RATE_LIMITS.productPreview))) {
    return failure(rateLimited("previewProductPages"));
  }

  const supabase = await createClient();
  const { data: row, error } = await supabase
    .from("products")
    .select("add_on_ids, digital_file_key, currency, purchase_url")
    .eq("id", id.data)
    .eq("owner_id", account.accountId)
    .maybeSingle();
  if (error) {
    console.error("[products] add-on picker read failed", error);
    return failure(serverError("loadProductPagePreview"));
  }
  if (!row) return failure(notFound("product"));

  const [choices, habits] = await Promise.all([listAddOnChoices(), getAddOnHabits(id.data)]);
  return {
    ok: true,
    picker: {
      choices,
      addOnIds: parseAddOnIds(row.add_on_ids),
      isDigital: row.digital_file_key !== null,
      currency: toCurrency(row.currency),
      ownBuyLink: Boolean(row.purchase_url?.trim()),
      habits,
    },
  };
}

/**
 * Replace what one product offers: the storefront editor's picker. Only
 * products.add_on_ids changes, so this never needs the whole product form, and
 * it saves at once because it belongs to the product and not to the storefront
 * being edited. Answers with the cards a buyer would now be offered, and the
 * chosen ones they would not (the preview draws those faded).
 */
export async function setProductAddOns(
  productId: unknown,
  addOnIds: unknown,
): Promise<{ ok: true; addOnIds: string[]; addOns: AddOnCard[]; hidden: HiddenAddOn[] } | ActionFailure> {
  const account = await getActiveAccount();
  if (!account) return failure(sessionExpired());
  if (!can(account.role, "products.write")) {
    return failure(permissionDenied(account.role, "editProducts"));
  }
  if (!(await rateLimit("product_write", RATE_LIMITS.productWrite))) {
    return failure(rateLimited("editProducts"));
  }
  const id = productIdSchema.safeParse(productId);
  if (!id.success) return failure(notFound("product"));
  const ids = addOnIdsSchema.safeParse(addOnIds);
  if (!ids.success) {
    return failure(
      invalidInput(msg("Errors.products.invalid.message"), msg("Errors.products.invalid.fix")),
    );
  }

  const supabase = await createClient();
  const refused = await addOnRefusal(supabase, account.accountId, ids.data, id.data);
  if (refused) return failure(refused);

  const { data: row, error } = await supabase
    .from("products")
    .update({ add_on_ids: ids.data })
    .eq("id", id.data)
    .eq("owner_id", account.accountId)
    .select("id, moderation_status, digital_file_key, currency")
    .maybeSingle();
  if (error) {
    console.error("[products] add-ons write failed", error);
    return failure(serverError("saveProduct"));
  }
  if (!row) return failure(notFound("product"));
  // No words or photos changed, so there is nothing to judge ahead of the write.
  await settleAfterWrite("product", row.id, row.moderation_status);

  // Exactly what the buyer's page would offer, like the editor's preview.
  const host = { isDigital: row.digital_file_key !== null, currency: toCurrency(row.currency) };
  const addOns = await loadAddOnCards(createAdminClient(), {
    ownerId: account.accountId,
    ids: ids.data,
    ...host,
    now: new Date(),
    unreadableSales: "regular",
    withRatings: true,
  });
  const hidden = await listHiddenAddOns(
    ids.data,
    addOns.map((card) => card.id),
    host,
  );
  return { ok: true, addOnIds: ids.data, addOns, hidden };
}
