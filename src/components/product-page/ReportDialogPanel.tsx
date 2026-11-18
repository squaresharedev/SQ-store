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
// report-constants.ts is zod-free; never import from reports.ts here.
import {
  REPORT_DETAILS_MAX,
  REPORT_REASONS,
  REPORT_REASON_COPY,
  type ReportReason,
} from "@/lib/validation/report-constants";

/** What the dialog can report. `seller` is filed against the seller's account,
 *  resolved from the storefront on the server (app/api/report). */
type ReportScope = "product" | "storefront" | "seller";

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
 * The lazy-loaded dialog body for ReportDialog.
 *
 * Split from ReportDialog.tsx so that the buyer page's initial bundle never
 * loads this module (and therefore never loads report-constants.ts or
 * the lucide icons inside). ReportDialog.tsx loads it via next/dynamic only
 * after the trigger is clicked.
 *
 * SEE ALSO: ReportDialog.tsx (the trigger + open state that wraps this).
 */
export function ReportDialogPanel({
  open,
  product,
  storefront,
  sellerName,
  scopes = NO_WIDER_SCOPES,
  onClose,
}: {
  open: boolean;
  product?: { id: string; title: string };
  storefront: { id: string; name: string };
  sellerName: string;
  scopes?: ProductPageReportScopes;
  onClose: () => void;
}) {
  const primary: ReportScope = product ? "product" : "storefront";
  const [scope, setScope] = React.useState<ReportScope>(primary);
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
    primary,
    ...(product && scopes.storefront ? (["storefront"] as const) : []),
    ...(scopes.seller ? (["seller"] as const) : []),
  ];
  const choosing = available.length > 1;
  const scopeHints: Record<ReportScope, string> = {
    product: product ? t("scopes.product.hint", { title: product.title }) : "",
    storefront: t("scopes.storefront.hint", { name: storefront.name }),
    seller: t("scopes.seller.hint", { name: sellerName }),
  };

  function close() {
    onClose();
    // Reset a beat later so the fields do not visibly empty during the close
    // transition. A reporter who reopens starts clean either way.
    window.setTimeout(() => {
      setScope(primary);
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
          targetId: scope === "product" && product ? product.id : storefront.id,
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
  );
}
