import type { MessageKeys, NestedKeyOf } from "next-intl";
import type { Locale } from "@/i18n/locales";
import type { Messages } from "@/i18n/messages";
import { msg, type MessageRef, type MessageValues } from "@/i18n/types";
import { formatList } from "@/lib/format/intl";
import { LEGAL_LINKS } from "@/lib/legal/links";
import { PDF_MUTED, PdfDocument } from "@/lib/pdf/document";
import { INTER_REGULAR, INTER_SEMIBOLD } from "@/lib/pdf/font-data";
import { fixFieldLabel, fixFieldsFor, type FixTarget } from "@/lib/moderation/fix-fields";
import {
  REMOVAL_APPEAL_EMAIL,
  decisionReference,
  formatTakedownDate,
  removalStatement,
} from "@/lib/moderation/removal";
import { REPORT_REASONS, REPORT_REASON_COPY, type ReportReason } from "@/lib/validation/reports";

/**
 * THE STATEMENT OF REASONS, as a document the seller keeps.
 *
 * EU Digital Services Act Art. 17(3) lists what a statement of reasons must
 * say when a platform restricts someone's content, and this lays them out in
 * that order: what was decided and its reach and duration; the facts and
 * circumstances (including whether it followed a notice, and whether anything
 * automated was involved); the legal or contractual ground with an
 * explanation; and every route to challenge it. Built from the immutable
 * moderation_decisions row, so it says the same thing next month as the day
 * it was issued, plus the one thing that can change: where it stands now.
 *
 * In the SELLER'S language (the caller resolves every key in their locale).
 * The staff note, the content's title and the seller's appeal are data, in
 * whatever language their authors wrote them, and go in verbatim.
 *
 * Pure: the route handler (app/api/moderation/decisions/[id]/statement) does
 * the reads and the auth; this only turns facts into bytes.
 */

export type StatementDecision = {
  id: string;
  targetType: FixTarget;
  targetId: string;
  targetTitle: string;
  action: "paused" | "removed";
  ground: string;
  note: string | null;
  fields: readonly string[];
  reportCount: number;
  reportReasons: readonly string[];
  decidedAt: string;
};

export type StatementAppeal = {
  status: "open" | "upheld" | "overturned";
  filedAt: string;
  decidedAt: string | null;
  note: string | null;
  message: string;
};

/** Where the decision stands today, which the stored row cannot say itself. */
export type StatementStatus = "inForce" | "replaced" | "reversed" | "deleted";

export type StatementInput = {
  decision: StatementDecision;
  appeal: StatementAppeal | null;
  status: StatementStatus;
  locale: Locale;
  /** When this copy was generated, printed on it. */
  generatedAt: Date;
};

/** Resolves a message in the seller's language. */
export type Resolve = (ref: MessageRef) => string;

type StatementCatalogue = Messages["Products"]["statement"];
/** A key under Products.statement, checked against the catalogue. */
type StatementKey = MessageKeys<StatementCatalogue, NestedKeyOf<StatementCatalogue>>;

/** The file name a download is saved under. */
export function statementFileName(decisionId: string): string {
  return `squareshare-${decisionReference(decisionId).toLowerCase()}.pdf`;
}

export function renderStatement(input: StatementInput, resolve: Resolve): Uint8Array {
  const { decision, appeal, status, locale } = input;
  const target = decision.targetType;
  const reference = decisionReference(decision.id);
  const date = (iso: string) => formatTakedownDate(iso, locale);
  const t = (key: StatementKey, values?: MessageValues) =>
    resolve(msg(`Products.statement.${key}`, values));

  const pdf = new PdfDocument(
    {
      title: t("fileTitle", { reference }),
      lang: locale,
      author: "SquareShare",
      subject: t("subtitle", { action: decision.action, target }),
      createdAt: input.generatedAt,
    },
    { regular: INTER_REGULAR, bold: INTER_SEMIBOLD },
  );

  // ── Heading ──────────────────────────────────────────────────────────
  pdf.text("SquareShare", { size: 9, weight: "bold", grey: PDF_MUTED, after: 10 });
  pdf.text(t("title"), { size: 22, weight: "bold", after: 2 });
  pdf.text(t("subtitle", { action: decision.action, target }), { size: 12, after: 10 });
  pdf.text(t("intro"), { size: 9.5, grey: PDF_MUTED, after: 4 });
  pdf.field(t("labels.reference"), reference);
  pdf.field(t("labels.issued"), date(input.generatedAt.toISOString()));

  // ── 1. The decision ──────────────────────────────────────────────────
  section(pdf, t("sections.decision"));
  pdf.field(t("labels.content"), t("content", { target, title: decision.targetTitle }));
  pdf.field(t("labels.contentId"), decision.targetId);
  pdf.field(t("labels.decision"), t(`decision.${decision.action}`));
  pdf.field(t("labels.decidedOn"), date(decision.decidedAt));
  pdf.field(t("labels.scope"), t("scope"));
  pdf.field(t("labels.duration"), t(`duration.${decision.action}`));
  pdf.field(t("labels.status"), t(`status.${status}`));

  // ── 2. Why ───────────────────────────────────────────────────────────
  section(pdf, t("sections.reasons"));
  pdf.field(t("labels.ground"), resolve(removalStatement(decision.ground, null)));
  pdf.field(t("labels.note"), decision.note?.trim() || t("noNote"));
  // A removal has nothing left to fix, but the parts it concerned are still
  // part of the reasons (a pause lists them under "What to change" below).
  const fields = fixFieldsFor(target, decision.fields);
  const fieldLabels = fields.map((field) => resolve(fixFieldLabel(target, field)));
  if (decision.action === "removed" && fields.length > 0) {
    pdf.field(
      resolve(msg("Products.removal.concerned")),
      formatList(fieldLabels, locale, { englishSeparator: ", " }),
    );
  }
  const reasons = decision.reportReasons
    .filter((reason): reason is ReportReason => (REPORT_REASONS as readonly string[]).includes(reason))
    .map((reason) => resolve(REPORT_REASON_COPY[reason].label));
  pdf.field(
    t("labels.facts"),
    `${t("facts.notices", {
      count: decision.reportCount,
      reasons: formatList(reasons, locale, { englishSeparator: ", " }),
    })} ${t("facts.review")}`,
  );
  pdf.field(t("labels.automated"), t("automated"));
  const basis = [t("legalBasis.contract", { url: LEGAL_LINKS.terms.href })];
  if (decision.ground === "illegal") basis.push(t("legalBasis.illegal"));
  pdf.field(t("labels.legalBasis"), basis.join("\n"), { url: LEGAL_LINKS.terms.href });

  // ── 3. What to change (a pause only) ─────────────────────────────────
  if (decision.action === "paused") {
    section(pdf, t("sections.fix"));
    pdf.text(t("fixIntro", { target }), { size: 10, after: 4 });
    pdf.bullets(fieldLabels.length > 0 ? fieldLabels : [decision.note?.trim() || t("noNote")]);
  }

  // ── 4. How to challenge it ───────────────────────────────────────────
  section(pdf, t("sections.redress"));
  pdf.bullets([
    t("redress.appeal", { target }),
    t("redress.settlement"),
    t("redress.court"),
    t("redress.contact", { email: REMOVAL_APPEAL_EMAIL, reference }),
  ]);

  // ── 5. The appeal, when there is one ─────────────────────────────────
  if (appeal) {
    section(pdf, t("sections.appeal"));
    const filed = date(appeal.filedAt);
    const decided = appeal.decidedAt ? date(appeal.decidedAt) : "";
    pdf.text(
      appeal.status === "open"
        ? t("appeal.open", { date: filed })
        : t(`appeal.${appeal.status}`, { date: filed, decided }),
      { size: 10, after: 4 },
    );
    pdf.text(t("appeal.message", { message: appeal.message }), {
      size: 9.5,
      grey: PDF_MUTED,
      after: 4,
    });
    if (appeal.note?.trim()) pdf.text(t("appeal.answer", { note: appeal.note.trim() }));
  }

  pdf.text(t("generated", { date: date(input.generatedAt.toISOString()) }), {
    size: 8.5,
    grey: PDF_MUTED,
    before: 18,
  });

  return pdf.render((page, total) => t("footer", { reference, page, total }));
}

/** A section heading over a rule, kept with at least its first lines. */
function section(pdf: PdfDocument, heading: string): void {
  pdf.keepTogether(90);
  pdf.rule({ before: 14, after: 10 });
  pdf.text(heading, { size: 13, weight: "bold", after: 2 });
}
