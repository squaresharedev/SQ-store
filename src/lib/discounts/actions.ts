"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getActiveAccount, type ActiveAccount } from "@/lib/team/account-context";
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
import { RATE_LIMITS, rateLimit } from "@/lib/rate-limit";
import { uuidField } from "@/lib/validation/inputs";
import { firstIssue } from "@/lib/validation/messages";
import { discountInputSchema, type DiscountInput } from "@/lib/validation/discounts";
import { getDiscount } from "@/lib/discounts/queries";
import { saleHasStarted } from "@/lib/discounts/status";
import { DISCOUNTS_PATH } from "@/lib/discounts/paths";
import { msg } from "@/i18n/types";
import { LIVE_DISCOUNTS_MAX, type DiscountView } from "@/types/discount";

// The seller's writes to their store's discounts. Each one runs the same gate
// as every store write (lib/orders/actions.ts): session -> role -> budget ->
// parse -> active-store scope, then the write under RLS, where the database's
// own guard (guard_discount_rules, 20261004_discounts.sql) re-checks the rules
// that keep a sale's history true even for a write that skipped this file.

export type DiscountActionResult = { ok: true; id: string } | ActionFailure;

/** Clock slack between this server and the database, as the guard allows. */
const CLOCK_SLACK_MS = 5 * 60 * 1000;

const INVALID = invalidInput(msg("Errors.discounts.invalid.message"), msg("Errors.discounts.invalid.fix"));
const CODE_TAKEN = invalidInput(msg("Errors.discounts.codeTaken.message"), msg("Errors.discounts.codeTaken.fix"));
const STARTED = invalidInput(msg("Errors.discounts.started.message"), msg("Errors.discounts.started.fix"));
const TOO_MANY = invalidInput(msg("Errors.discounts.tooMany.message"), msg("Errors.discounts.tooMany.fix"));

/** Session, role and budget: every write starts here. */
async function authorizeDiscountWrite(): Promise<{ ok: true; account: ActiveAccount } | ActionFailure> {
  const account = await getActiveAccount();
  if (!account) return failure(sessionExpired());
  if (!can(account.role, "products.write")) return failure(permissionDenied(account.role, "manageDiscounts"));
  if (!(await rateLimit("discount_write", RATE_LIMITS.discountWrite))) return failure(rateLimited("saveDiscounts"));
  return { ok: true, account };
}

/** The input as columns. Kind-specific columns are cleared for the other kind. */
function toColumns(input: DiscountInput, now: Date) {
  const isCode = input.kind === "code";
  return {
    code: isCode ? input.code : null,
    share_channel: isCode ? input.shareChannel || null : null,
    value_type: input.value.type,
    percent_off: input.value.type === "percent" ? input.value.percentOff : null,
    amount_off_cents: input.value.type === "amount" ? input.value.amountOffCents : null,
    currency: input.value.type === "amount" ? input.value.currency : null,
    applies_to: input.appliesTo,
    product_ids: input.appliesTo === "products" ? input.productIds : [],
    starts_at: input.startsAt ?? now.toISOString(),
    ends_at: input.endsAt,
    usage_limit: isCode ? input.usageLimit : null,
    enabled: isCode ? input.enabled : true,
  };
}

/** The checks that need the clock, and the store's own products. */
async function checkInput(
  supabase: Awaited<ReturnType<typeof createClient>>,
  account: ActiveAccount,
  input: DiscountInput,
  now: Date,
  { startMayBePast }: { startMayBePast: boolean },
): Promise<ActionFailure | null> {
  const past = now.getTime() - CLOCK_SLACK_MS;
  if (!startMayBePast && input.startsAt && Date.parse(input.startsAt) < past) {
    return failure(invalidInput(msg("Validation.discount.startInPast")));
  }
  if (input.endsAt && Date.parse(input.endsAt) < past) {
    return failure(invalidInput(msg("Validation.discount.endInPast")));
  }
  if (input.appliesTo === "products") {
    // Only this store's products. A stray id would be inert (discounts only
    // ever match their own store's products), but it would also be a lie in
    // the list, so it is refused here.
    const { count, error } = await supabase
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", account.accountId)
      .in("id", input.productIds);
    if (error) return failure(serverError("saveDiscount"));
    if (count !== input.productIds.length) return failure(invalidInput(msg("Validation.uuid.product")));
  }
  return null;
}

/** Whether two instants are the same moment, however each is spelled: the
 *  database prints "+00:00" and microseconds, a browser prints "Z". */
function sameInstant(a: string, b: string): boolean {
  return Date.parse(a) === Date.parse(b);
}

/** A failed write, in the seller's words. */
function writeFailure(error: { code?: string; message?: string }): ActionFailure {
  if (error.code === "23505") return failure(CODE_TAKEN);
  if (error.code === "42501" && error.message?.includes("discount_started")) return failure(STARTED);
  if (error.code === "23514" || error.code === "42501") return failure(INVALID);
  console.error("[discounts] write failed", error.code, error.message);
  return failure(serverError("saveDiscount"));
}

function parse(raw: unknown): { ok: true; input: DiscountInput } | ActionFailure {
  const parsed = discountInputSchema.safeParse(raw);
  return parsed.success ? { ok: true, input: parsed.data } : failure(invalidInput(firstIssue(parsed.error)));
}

/** Create a sale or a code in the active store. */
export async function createDiscount(raw: unknown): Promise<DiscountActionResult> {
  const gated = await authorizeDiscountWrite();
  if (!gated.ok) return gated;
  const parsed = parse(raw);
  if (!parsed.ok) return parsed;
  const { account } = gated;
  const { input } = parsed;
  const now = new Date();

  const supabase = await createClient();
  const invalid = await checkInput(supabase, account, input, now, { startMayBePast: false });
  if (invalid) return invalid;

  const { count, error: countError } = await supabase
    .from("discounts")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", account.accountId)
    .is("archived_at", null);
  if (countError) return failure(serverError("saveDiscount"));
  if ((count ?? 0) >= LIVE_DISCOUNTS_MAX) return failure(TOO_MANY);

  const { data, error } = await supabase
    .from("discounts")
    .insert({ owner_id: account.accountId, kind: input.kind, ...toColumns(input, now) })
    .select("id")
    .single();
  if (error || !data) return writeFailure(error ?? {});

  revalidatePath(DISCOUNTS_PATH);
  return { ok: true, id: data.id };
}

/**
 * Change a discount. A sale that has started keeps its terms (they are part of
 * the price history the EU's 30-day rule reads): only its end can move, and
 * not into the past. Anything else is "end it and start a new one".
 */
export async function updateDiscount(id: string, raw: unknown): Promise<DiscountActionResult> {
  const gated = await authorizeDiscountWrite();
  if (!gated.ok) return gated;
  if (!uuidField().safeParse(id).success) return failure(notFound("discount"));
  const parsed = parse(raw);
  if (!parsed.ok) return parsed;
  const { account } = gated;
  const { input } = parsed;
  const now = new Date();

  const existing = await getDiscount(id);
  if (!existing) return failure(notFound("discount"));
  if (existing.kind !== input.kind) return failure(INVALID);

  const started = saleHasStarted(existing, now);
  const supabase = await createClient();
  // A discount keeps a start it already had, past or not (a running code is
  // edited with its start untouched); a start that MOVES may not move back.
  const invalid = await checkInput(supabase, account, input, now, {
    startMayBePast: input.startsAt !== null && sameInstant(input.startsAt, existing.startsAt),
  });
  if (invalid) return invalid;

  let columns: Partial<ReturnType<typeof toColumns>> = toColumns(input, now);
  if (started) {
    if (changesTerms(existing, input)) return failure(STARTED);
    columns = { ends_at: input.endsAt };
  }

  const { data, error } = await supabase
    .from("discounts")
    .update(columns)
    .eq("id", id)
    .eq("owner_id", account.accountId)
    .is("archived_at", null)
    .select("id")
    .maybeSingle();
  if (error) return writeFailure(error);
  if (!data) return failure(notFound("discount"));

  revalidatePath(DISCOUNTS_PATH);
  return { ok: true, id };
}

/** Whether `input` asks to change anything but the end of a started sale. */
function changesTerms(existing: DiscountView, input: DiscountInput): boolean {
  const value = input.value;
  const sameValue =
    value.type === existing.value.type &&
    (value.type === "percent"
      ? existing.value.type === "percent" && value.percentOff === existing.value.percentOff
      : existing.value.type === "amount" &&
        value.amountOffCents === existing.value.amountOffCents &&
        value.currency === existing.value.currency);
  const sameProducts =
    input.appliesTo === existing.appliesTo &&
    input.productIds.length === existing.productIds.length &&
    input.productIds.every((productId) => existing.productIds.includes(productId));
  return !sameValue || !sameProducts || (input.startsAt !== null && !sameInstant(input.startsAt, existing.startsAt));
}

/** Switch a code on or off. A sale has no switch: it ends (endSale). */
export async function setCodeEnabled(id: string, enabled: boolean): Promise<DiscountActionResult> {
  const gated = await authorizeDiscountWrite();
  if (!gated.ok) return gated;
  if (!uuidField().safeParse(id).success || typeof enabled !== "boolean") return failure(notFound("discount"));
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("discounts")
    .update({ enabled })
    .eq("id", id)
    .eq("owner_id", gated.account.accountId)
    .eq("kind", "code")
    .is("archived_at", null)
    .select("id")
    .maybeSingle();
  if (error) return writeFailure(error);
  if (!data) return failure(notFound("discount"));
  revalidatePath(DISCOUNTS_PATH);
  return { ok: true, id };
}

/** End a sale now. Its run so far stays in the price history. */
export async function endSale(id: string): Promise<DiscountActionResult> {
  const gated = await authorizeDiscountWrite();
  if (!gated.ok) return gated;
  if (!uuidField().safeParse(id).success) return failure(notFound("discount"));
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("discounts")
    .update({ ends_at: new Date().toISOString() })
    .eq("id", id)
    .eq("owner_id", gated.account.accountId)
    .eq("kind", "automatic")
    .is("archived_at", null)
    .select("id")
    .maybeSingle();
  if (error) return writeFailure(error);
  if (!data) return failure(notFound("discount"));
  revalidatePath(DISCOUNTS_PATH);
  return { ok: true, id };
}

/**
 * Delete a discount, as the seller sees it. The row is ARCHIVED, never
 * removed: its orders stay credited to it, and a sale's run stays in the price
 * history (archiving a running sale ends it now, in the database's guard).
 */
export async function deleteDiscount(id: string): Promise<DiscountActionResult> {
  const gated = await authorizeDiscountWrite();
  if (!gated.ok) return gated;
  if (!uuidField().safeParse(id).success) return failure(notFound("discount"));
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("discounts")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id)
    .eq("owner_id", gated.account.accountId)
    .is("archived_at", null)
    .select("id")
    .maybeSingle();
  if (error) return writeFailure(error);
  if (!data) return failure(notFound("discount"));
  revalidatePath(DISCOUNTS_PATH);
  return { ok: true, id };
}
