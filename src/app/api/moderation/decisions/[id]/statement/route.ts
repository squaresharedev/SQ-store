import { getLocale, getTranslations } from "next-intl/server";
import type { Locale } from "@/i18n/locales";
import { createClient } from "@/lib/supabase/server";
import { getActiveAccount } from "@/lib/team/account-context";
import { RATE_LIMITS, rateLimit } from "@/lib/rate-limit";
import { uuidField } from "@/lib/validation/inputs";
import {
  renderStatement,
  statementFileName,
  type StatementAppeal,
  type StatementStatus,
} from "@/lib/moderation/statement";

/**
 * GET /api/moderation/decisions/:id/statement: the statement of reasons for
 * one moderation decision, as a PDF the seller keeps.
 *
 * WHO MAY HAVE IT. Anyone who can read the store the decision is about: the
 * owner, and team members of that store (moderation_decisions_select_member).
 * Read with the SELLER'S session and scoped to the active account explicitly,
 * so a member of two stores gets the statement of the store they are looking
 * at and nothing from the other. Every refusal is a 404: whether a decision
 * exists is nobody else's business.
 *
 * NOT CACHED. It is personal, and its "status today" line changes when staff
 * decide something new.
 */

const idSchema = uuidField("moderationDecision");

function notFound(): Response {
  return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!idSchema.safeParse(id).success) return notFound();

  const account = await getActiveAccount();
  if (!account) {
    return new Response("Sign in to download this.", {
      status: 401,
      headers: { "Cache-Control": "no-store" },
    });
  }

  if (!(await rateLimit("moderation_statement", RATE_LIMITS.moderationStatement))) {
    return new Response("Too many downloads. Try again later.", {
      status: 429,
      headers: { "Retry-After": "3600", "Cache-Control": "no-store" },
    });
  }

  const supabase = await createClient();
  const { data: decision, error } = await supabase
    .from("moderation_decisions")
    .select(
      "id, target_type, target_id, target_title, action, ground, note, fields, report_count, report_reasons, decided_at",
    )
    .eq("id", id)
    .eq("owner_id", account.accountId)
    .maybeSingle();
  if (error) {
    console.error("[moderation] statement read failed", error.message);
    return new Response("Could not load this decision.", { status: 503 });
  }
  if (!decision) return notFound();

  const targetType = decision.target_type === "storefront" ? "storefront" : "product";
  const [{ data: content }, { data: appealRow }] = await Promise.all([
    supabase
      .from(targetType === "storefront" ? "storefronts" : "products")
      .select("moderation_status, moderation_decision_id")
      .eq("id", decision.target_id)
      .eq("owner_id", account.accountId)
      .maybeSingle(),
    supabase
      .from("moderation_appeals")
      .select("status, created_at, decided_at, decision_note, message")
      .eq("decision_id", decision.id)
      .eq("owner_id", account.accountId)
      .maybeSingle(),
  ]);

  const locale = (await getLocale()) as Locale;
  const resolve = await getTranslations();
  const pdf = renderStatement(
    {
      decision: {
        id: decision.id,
        targetType,
        targetId: decision.target_id,
        targetTitle: decision.target_title,
        action: decision.action === "paused" ? "paused" : "removed",
        ground: decision.ground,
        note: decision.note,
        fields: decision.fields,
        reportCount: decision.report_count,
        reportReasons: decision.report_reasons,
        decidedAt: decision.decided_at,
      },
      appeal: appealRow
        ? ({
            status:
              appealRow.status === "upheld" || appealRow.status === "overturned"
                ? appealRow.status
                : "open",
            filedAt: appealRow.created_at,
            decidedAt: appealRow.decided_at,
            note: appealRow.decision_note,
            message: appealRow.message,
          } satisfies StatementAppeal)
        : null,
      status: statusToday(decision.id, content),
      locale,
      generatedAt: new Date(),
    },
    (ref) => resolve(ref.key, ref.values),
  );

  return new Response(pdf as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${statementFileName(decision.id)}"`,
      "Content-Length": String(pdf.length),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/**
 * Where the decision stands now. In force while the content still points at
 * it; replaced once a later decision took its place; reversed once the content
 * is live again; deleted once the seller has deleted it.
 */
function statusToday(
  decisionId: string,
  content: { moderation_status: string; moderation_decision_id: string | null } | null,
): StatementStatus {
  if (!content) return "deleted";
  if (content.moderation_decision_id === decisionId && content.moderation_status !== "ok") {
    return "inForce";
  }
  if (content.moderation_decision_id && content.moderation_decision_id !== decisionId) {
    return "replaced";
  }
  return content.moderation_status === "ok" ? "reversed" : "inForce";
}
