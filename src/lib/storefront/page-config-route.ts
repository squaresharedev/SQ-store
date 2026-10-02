// SERVER ONLY. THE PAGE SETTINGS ROUTE, once, for every hosted page a
// storefront designs: GET and PATCH on /api/storefronts/[id]/<page>.
//
// WHY A ROUTE AT ALL. Server Actions cannot be an agent transport (see
// docs/agent-surface.md, B1): their ids are build-specific and their shapes
// are private. A plain URL that reads and merges ONE config member is the
// contract an agent (and a test) can hold on to, and a future MCP server is a
// change of AUTH on these routes, not a new contract.
//
// THE RULES, the same for every page:
//   - session cookie for now; the active account's store only (owner_id);
//     `store.read` to read, `storefront.write` to write; rate limited;
//   - PATCH merges a JSON object over the RESOLVED member, where `null`
//     deletes a key (the only way to say "back to inheriting"), then the
//     member's own schema judges the WHOLE result;
//   - a member left at its defaults is stored as NO member, the rule the
//     designer's save follows, so reading and writing back never grows a key;
//   - errors are the app's ActionError envelope, in the reader's language.

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import type { z } from "zod";
import { msg, type MessageKey, type MessageRef } from "@/i18n/types";
import {
  invalidInput,
  notFound,
  permissionDenied,
  rateLimited,
  serverError,
  sessionExpired,
  type ActionError,
  type ActionErrorCode,
  type RateLimitedOperation,
  type ServerErrorOperation,
} from "@/lib/errors";
import { RATE_LIMITS, rateLimit } from "@/lib/rate-limit";
import { evictObject, settlePagePhotos } from "@/lib/storefront/uploads";
import { createClient } from "@/lib/supabase/server";
import { getActiveAccount } from "@/lib/team/account-context";
import { can } from "@/lib/team/permissions";
import { parseStoredStorefrontConfig, storefrontIdSchema } from "@/lib/validation/storefront";
import { firstIssue } from "@/lib/validation/messages";
import type { PagePhoto, StorefrontConfig } from "@/types/storefront";

/** HTTP status for each ActionError code. */
const STATUS: Record<ActionErrorCode, number> = {
  session_expired: 401,
  permission_denied: 403,
  not_found: 404,
  invalid_input: 400,
  upload_failed: 400,
  rate_limited: 429,
  server_error: 500,
  trader_identity_required: 409,
  // The account's plan caps this; a bigger plan lifts it.
  plan_limit: 402,
  unexpected: 500,
};

async function fail(error: ActionError) {
  const t = await getTranslations();
  const text = (ref: MessageRef) => t(ref.key, ref.values);
  return Response.json(
    {
      error: {
        code: error.code,
        message: text(error.message),
        ...(error.fix ? { fix: text(error.fix) } : {}),
        ...(error.action ? { action: { href: error.action.href, label: text(error.action.label) } } : {}),
      },
    },
    { status: STATUS[error.code] },
  );
}

type Member = "productPage" | "checkoutPage";

export type PageConfigRouteSpec<Name extends Member> = {
  /** The StorefrontConfig member this route reads and writes. */
  member: Name;
  schema: z.ZodType;
  resolve: (config: StorefrontConfig) => NonNullable<StorefrontConfig[Name]>;
  isDefault: (value: NonNullable<StorefrontConfig[Name]>) => boolean;
  /** What both verbs answer with: the resolved member and whatever an agent
   *  needs beside it (resolved paint, limits). */
  payload: (storefrontId: string, config: StorefrontConfig) => unknown;
  /** Log prefix. */
  log: string;
  operations: { read: RateLimitedOperation; load: ServerErrorOperation; save: ServerErrorOperation };
  messages: {
    notJson: MessageKey;
    notJsonFix: MessageKey;
    notObject: MessageKey;
    notObjectFix: MessageKey;
    invalid: MessageKey;
    invalidFix: MessageKey;
  };
};

type Handler = (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response>;

export function pageConfigRoute<Name extends Member>(
  spec: PageConfigRouteSpec<Name>,
): { GET: Handler; PATCH: Handler } {
  async function loadConfig(
    id: string,
    accountId: string,
  ): Promise<{ config: StorefrontConfig } | { error: ActionError }> {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("storefronts")
      .select("config")
      .eq("id", id)
      .eq("owner_id", accountId)
      .maybeSingle();
    if (error) {
      console.error(`[${spec.log}] read failed`, error.message);
      return { error: serverError(spec.operations.load) };
    }
    if (!data) return { error: notFound("storefront") };
    const config = parseStoredStorefrontConfig(data.config);
    if (!config) {
      console.warn(`[${spec.log}] stored config failed to parse`, id);
      return { error: serverError(spec.operations.load) };
    }
    return { config };
  }

  const GET: Handler = async (_request, { params }) => {
    const { id } = await params;
    if (!storefrontIdSchema.safeParse(id).success) return fail(notFound("storefront"));
    const account = await getActiveAccount();
    if (!account) return fail(sessionExpired());
    if (!can(account.role, "store.read")) return fail(permissionDenied(account.role, "viewStorefronts"));
    if (!(await rateLimit("product_page_read", RATE_LIMITS.productPageRead))) {
      return fail(rateLimited(spec.operations.read));
    }
    const loaded = await loadConfig(id, account.accountId);
    if ("error" in loaded) return fail(loaded.error);
    return Response.json(spec.payload(id, loaded.config));
  };

  const PATCH: Handler = async (request, { params }) => {
    const { id } = await params;
    if (!storefrontIdSchema.safeParse(id).success) return fail(notFound("storefront"));
    const account = await getActiveAccount();
    if (!account) return fail(sessionExpired());
    if (!can(account.role, "storefront.write")) return fail(permissionDenied(account.role, "editStorefronts"));
    if (!(await rateLimit("storefront_write", RATE_LIMITS.storefrontWrite))) {
      return fail(rateLimited("saveStorefronts"));
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return fail(invalidInput(msg(spec.messages.notJson), msg(spec.messages.notJsonFix)));
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return fail(invalidInput(msg(spec.messages.notObject), msg(spec.messages.notObjectFix)));
    }

    const loaded = await loadConfig(id, account.accountId);
    if ("error" in loaded) return fail(loaded.error);

    // Merge, then let the schema judge the WHOLE thing. A `null` deletes
    // rather than sets: for an optional field that is the only way to say "go
    // back to inheriting", and for a required one the schema refuses it by
    // name, which is a better answer than storing a null.
    const merged: Record<string, unknown> = { ...spec.resolve(loaded.config) };
    for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
      if (value === null) delete merged[key];
      else merged[key] = value;
    }
    const parsed = spec.schema.safeParse(merged);
    if (!parsed.success) {
      // The schema's own message names the field and the bound it broke,
      // which is what a caller needs to correct the call. It carries no
      // stored data, so returning it leaks nothing.
      return fail(invalidInput(firstIssue(parsed.error, msg(spec.messages.invalid)), msg(spec.messages.invalidFix)));
    }
    const value = parsed.data as NonNullable<StorefrontConfig[Name]>;

    const config: StorefrontConfig = { ...loaded.config };
    if (spec.isDefault(value)) delete config[spec.member];
    else (config as Record<Member, unknown>)[spec.member] = value;

    // A page photo is an upload by key, so the same boundary the designer's
    // save applies applies here: a key new to this storefront must be one this
    // account's user uploaded, really an image, really within the size cap.
    // Without it this route would link anyone's object to a public page.
    const photos = await settlePagePhotos(loaded.config, config, account.userId);
    if (!photos.ok) return fail(photos.error);

    const supabase = await createClient();
    const { data: row, error } = await supabase
      .from("storefronts")
      .update({ config, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("owner_id", account.accountId)
      .select("id")
      .maybeSingle();
    if (error) {
      console.error(`[${spec.log}] save failed`, error.message);
      return fail(serverError(spec.operations.save));
    }
    if (!row) return fail(notFound("storefront"));

    // Photos this write let go of go with it, once it is safely saved.
    for (const key of photos.released) await evictObject(key);

    revalidatePath(`/storefront/${id}`);
    return Response.json(spec.payload(id, config));
  };

  return { GET, PATCH };
}

/**
 * A page member as the routes REPORT it: the photo's object key is withheld
 * (docs/agent-surface.md, B6) and only whether a photo is set is said. A write
 * can still clear it (`backgroundImage: null`); setting one needs a key from
 * the upload flow, which a caller of these routes does not hold.
 */
export function withoutObjectKeys<T extends { backgroundImage?: PagePhoto }>(
  page: T,
): Omit<T, "backgroundImage"> & { hasBackgroundImage: boolean } {
  const { backgroundImage, ...rest } = page;
  return { ...rest, hasBackgroundImage: backgroundImage !== undefined };
}
