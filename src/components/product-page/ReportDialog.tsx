"use client";

import * as React from "react";
import {
  Copyright,
  Ellipsis,
  EyeOff,
  Flag,
  Gavel,
  HandCoins,
  MailWarning,
  MessageCircleWarning,
  Package,
  Store,
  Swords,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Modal, ModalActions } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ChoiceCards } from "@/components/ui/ChoiceCards";
import { AnimatedCheck } from "@/components/ui/animated-check";
import { infoTextClass } from "@/components/ui/control-styles";
import { HeroMark } from "@/components/ui/HeroMark";
import type { MessageRef } from "@/i18n/types";
import type { ProductPageReportScopes } from "@/types/product-page";
import {
  REPORT_DETAILS_MAX,
  REPORT_REASONS,
  REPORT_REASON_COPY,
  type ReportReason,
} from "@/lib/validation/reports";

/** What the dialog can report. `seller` is filed against the seller's account,
 *  resolved from the storefront on the server (app/api/report). */
type ReportScope = "product" | ReportScopeOption;
type ReportScopeOption = keyof ProductPageReportScopes;

const NO_WIDER_SCOPES: ProductPageReportScopes = { storefront: false, seller: false };

/** A category as a picture. Eight tiles can be told apart at a glance where
 *  eight sentences have to be read; the words stay under each, and what the
 *  chosen one covers is spelled out once it is picked. */
const REASON_ICONS: Record<ReportReason, LucideIcon> = {
  illegal: Gavel,
  sexual: EyeOff,
  violence: Swords,
  hate: MessageCircleWarning,
  counterfeit: Copyright,
  scam: HandCoins,
  spam: MailWarning,
  other: Ellipsis,
};

const SCOPE_ICONS: Record<ReportScope, LucideIcon> = {
  product: Package,
  storefront: Store,
  seller: UserRound,
};

/** The "(optional)" after a field label, a step quieter than the label. */
function optionalMarker(chunks: React.ReactNode) {
  return <span className="font-normal text-muted-foreground">{chunks}</span>;
}

/**
 * "Report this product" and the dialog behind it.
 *
 * WHERE IT SITS AND WHY IT IS QUIET. In the footer, at the muted size the rest
 * of that row uses. A report link is not a call to action: it has to be
 * findable by someone who came looking for it and invisible to someone who did
 * not. Making it prominent on a seller's page would be a permanent accusation
 * printed under every honest listing.
 *
 * WHAT IT ASKS FOR, in the order a person can answer it:
 *
 *   1. A category. Required, because it is the only field staff can triage on
 *      and the only one the ranking penalty can count.
 *   2. What is wrong, in their own words. Optional: someone who has spotted
 *      something illegal should not have to write a paragraph before they can
 *      tell anyone.
 *   3. Their email. Optional, and labelled as such. It is how we confirm
 *      receipt and come back with a question, and under the EU Digital
 *      Services Act (Art. 16) a notice carrying contact details is the form
 *      that gives the platform actual knowledge. Requiring it would stop most
 *      people reporting anything, which is the worse failure.
 *
 * The dialog OPENS AS ONE QUESTION. The categories are tiles (a glyph over a
 * few words), told apart at a glance, and what the chosen one covers is spelled
 * out under them once it is picked. 2 and 3 only appear then: someone who has
 * not said what is wrong has nothing to add to it yet.
 *
 * THE CONFIRMATION IS ALWAYS THE SAME. A duplicate report, a first report and
 * a report on something already removed all end here. The endpoint is built
 * the same way, for the same reason: what happened underneath is not the
 * reporter's to know.
 *
 * WHAT IS BEING REPORTED comes first, when there is a choice. A buyer who has
 * found one bad listing may have found a bad shop, or a bad seller running
 * several; the dialog offers the wider targets only when they differ from the
 * product (the storefront once the seller sells more than one thing, the
 * seller once they run more than one storefront; see reportScopesFor). The
 * seller is reported through the storefront's id and resolved to their
 * account on the server, so this page never learns the account id.
 *
 * INERT IN THE EDITOR (`preview`). The seller previewing their own page gets
 * the link rendered, so they can see what a buyer sees, and clicking it does
 * nothing. A live dialog there would let someone report their own product and
 * would put a stranger's accusation vocabulary in the middle of their design
 * surface.
 */
export function ReportDialog({
  product,
  storefront,
  sellerName,
  scopes = NO_WIDER_SCOPES,
  preview = false,
}: {
  product: { id: string; title: string };
  /** The storefront this page hangs off, as its buyers know it. */
  storefront: { id: string; name: string };
  /** Who the buyer is contracting with, as the page names them. */
  sellerName: string;
  /** Which wider targets this seller warrants. */
  scopes?: ProductPageReportScopes;
  /** Editor preview: render the link, do nothing on click. */
  preview?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [scope, setScope] = React.useState<ReportScope>("product");
  const [reason, setReason] = React.useState<ReportReason | "">("");
  const [details, setDetails] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [state, setState] = React.useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = React.useState<string | null>(null);
  // The buyer's language, from their own request: this is their dialog, not
  // the seller's page copy.
  const t = useTranslations("ProductPage.report");
  const tAll = useTranslations();
  const tActions = useTranslations("Common.actions");
  const resolve = (ref: MessageRef) => tAll(ref.key, ref.values);
  const available: ReportScope[] = [
    "product",
    ...(scopes.storefront ? (["storefront"] as const) : []),
    ...(scopes.seller ? (["seller"] as const) : []),
  ];
  const choosing = available.length > 1;
  const scopeHints: Record<ReportScope, string> = {
    product: t("scopes.product.hint", { title: product.title }),
    storefront: t("scopes.storefront.hint", { name: storefront.name }),
    seller: t("scopes.seller.hint", { name: sellerName }),
  };

  function close() {
    setOpen(false);
    // Reset a beat later so the fields do not visibly empty during the close
    // transition. A reporter who reopens starts clean either way.
    window.setTimeout(() => {
      setScope("product");
      setReason("");
      setDetails("");
      setEmail("");
      setState("idle");
      setError(null);
    }, 200);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!reason || state === "sending") return;

    setState("sending");
    setError(null);
    try {
      const response = await fetch("/api/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetType: scope,
          // The storefront names both the storefront and, resolved on the
          // server, the seller behind it.
          targetId: scope === "product" ? product.id : storefront.id,
          reason,
          details,
          reporterEmail: email,
        }),
      });
      if (!response.ok) {
        // Already in the reporter's language: the endpoint resolves its
        // refusals from this same request.
        const body = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        setError(body?.error ?? t("submitFailed"));
        setState("idle");
        return;
      }
      setState("sent");
    } catch {
      setError(t("offline"));
      setState("idle");
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={preview ? undefined : () => setOpen(true)}
        // Inert rather than hidden in the editor: the seller should see the
        // link exactly where a buyer will.
        aria-disabled={preview || undefined}
        className="inline-flex items-center gap-1.5 underline-offset-2 hover:underline"
        data-report-trigger="product"
      >
        <Flag aria-hidden="true" className="size-3" />
        {choosing ? t("triggerAny") : t("trigger", { target: "product" })}
      </button>

      <Modal
        open={open}
        onClose={close}
        // The first control is a radio that RECORDS a choice, and the first
        // radio is "Illegal goods or activity": a habitual Space on open would
        // silently file the most serious category. Land on the inert panel so
        // choosing a reason is always deliberate.
        initialFocus="dialog"
        // The flag they pressed, then a tick once it is sent. The tick only
        // exists in that state, so it draws itself in on every submission
        // rather than sitting fully drawn from a previous one. That is the
        // confirmation a person reacts to: the words say it happened, this is
        // what makes it FEEL like it did.
        visual={
          state === "sent" ? (
            <HeroMark tone="success" icon={AnimatedCheck} />
          ) : (
            <HeroMark icon={Flag} />
          )
        }
        title={state === "sent" ? t("sentTitle") : t("title", { target: scope })}
        description={state === "sent" ? t("sentBody", { target: scope }) : t("description")}
      >
        {state === "sent" ? (
          <ModalActions>
            <Button type="button" onClick={close}>
              {tActions("close")}
            </Button>
          </ModalActions>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-4">
            {choosing && (
              <div className="flex flex-col gap-2">
                <ChoiceCards
                  name="scope"
                  legend={t("scopeLegend")}
                  variant="tiles"
                  columns={3}
                  options={available.map((value) => {
                    const Icon = SCOPE_ICONS[value];
                    return {
                      value,
                      label: t(`scopes.${value}.label`),
                      icon: <Icon className="size-5" strokeWidth={1.75} aria-hidden />,
                    };
                  })}
                  value={scope}
                  onChange={setScope}
                  optionDataAttribute="data-report-scope"
                  fieldsetData={{ "data-report-scopes": "" }}
                />
                {/* Which one, by name: one line for the chosen target. */}
                <p className={`${infoTextClass} truncate text-center`} aria-live="polite" data-report-scope-hint>
                  {scopeHints[scope]}
                </p>
              </div>
            )}

            <div className="flex flex-col gap-2">
              <ChoiceCards
                name="reason"
                legend={t("reasonsLegend")}
                // Alone, the dialog's own sentence already asks it. Beside the
                // "what" group above, each group needs its question in view.
                legendHidden={!choosing}
                variant="tiles"
                columns={2}
                options={REPORT_REASONS.map((value) => {
                  const Icon = REASON_ICONS[value];
                  return {
                    value,
                    label: resolve(REPORT_REASON_COPY[value].label),
                    icon: <Icon className="size-5" strokeWidth={1.75} aria-hidden />,
                  };
                })}
                value={reason || null}
                onChange={setReason}
                required
              />
              {/* What the chosen category covers: one definition on screen,
                  not eight to read past. */}
              {reason && (
                <p className={`${infoTextClass} text-center`} aria-live="polite" data-report-reason-hint>
                  {resolve(REPORT_REASON_COPY[reason].hint)}
                </p>
              )}
            </div>

            {/* The rest is asked only once there is a reason to say more
                about, so the dialog opens as one question. */}
            {reason && (
              <>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="report-details">
                    {t.rich("detailsLabel", { muted: optionalMarker })}
                  </Label>
                  <Textarea
                    id="report-details"
                    name="details"
                    rows={3}
                    maxLength={REPORT_DETAILS_MAX}
                    value={details}
                    onChange={(event) => setDetails(event.target.value)}
                    placeholder={t("detailsPlaceholder")}
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <Label htmlFor="report-email">
                    {t.rich("emailLabel", { muted: optionalMarker })}
                  </Label>
                  <Input
                    id="report-email"
                    name="reporterEmail"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder={t("emailPlaceholder")}
                  />
                  {/* Kept in view: it is the promise that makes an address safe to give. */}
                  <p className={infoTextClass}>{t("emailHelp")}</p>
                </div>
              </>
            )}

            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}

            <ModalActions>
              <Button type="button" variant="ghost" onClick={close}>
                {tActions("cancel")}
              </Button>
              <Button type="submit" disabled={!reason || state === "sending"}>
                {state === "sending" ? tActions("sending") : t("send")}
              </Button>
            </ModalActions>
          </form>
        )}
      </Modal>
    </>
  );
}
