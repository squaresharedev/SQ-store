"use client";

import * as React from "react";
import { Flag } from "lucide-react";
import { useTranslations } from "next-intl";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AnimatedCheck } from "@/components/ui/animated-check";
import type { MessageRef } from "@/i18n/types";
import {
  REPORT_DETAILS_MAX,
  REPORT_REASONS,
  REPORT_REASON_COPY,
  type ReportReason,
} from "@/lib/validation/reports";

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
 * THE CONFIRMATION IS ALWAYS THE SAME. A duplicate report, a first report and
 * a report on something already removed all end here. The endpoint is built
 * the same way, for the same reason: what happened underneath is not the
 * reporter's to know.
 *
 * INERT IN THE EDITOR (`preview`). The seller previewing their own page gets
 * the link rendered, so they can see what a buyer sees, and clicking it does
 * nothing. A live dialog there would let someone report their own product and
 * would put a stranger's accusation vocabulary in the middle of their design
 * surface.
 */
export function ReportDialog({
  targetType,
  targetId,
  preview = false,
}: {
  targetType: "product" | "storefront";
  targetId: string;
  /** Editor preview: render the link, do nothing on click. */
  preview?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
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

  function close() {
    setOpen(false);
    // Reset a beat later so the fields do not visibly empty during the close
    // transition. A reporter who reopens starts clean either way.
    window.setTimeout(() => {
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
          targetType,
          targetId,
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
        data-report-trigger={targetType}
      >
        <Flag aria-hidden="true" className="size-3" />
        {t("trigger", { target: targetType })}
      </button>

      <Modal
        open={open}
        onClose={close}
        // The first control is a radio that RECORDS a choice, and the first
        // radio is "Illegal goods or activity": a habitual Space on open would
        // silently file the most serious category. Land on the inert panel so
        // choosing a reason is always deliberate.
        initialFocus="dialog"
        title={state === "sent" ? t("sentTitle") : t("title", { target: targetType })}
        description={state === "sent" ? undefined : t("description")}
      >
        {state === "sent" ? (
          <div className="flex flex-col items-center gap-4 py-2 text-center">
            {/* Remounted fresh every time `state` becomes "sent" (this whole
                branch only exists then), so the draw-in replays on every
                submission rather than sitting fully-drawn from a previous
                one. That is the actual confirmation a person reacts to: the
                words say it happened, this is what makes it FEEL like it
                did. */}
            <span
              aria-hidden="true"
              className="flex size-12 items-center justify-center rounded-full bg-success/15 text-success"
            >
              <AnimatedCheck className="size-6" />
            </span>
            <p className="text-sm text-muted-foreground">
              {t("sentBody", { target: targetType })}
            </p>
            <Button type="button" onClick={close} className="w-full sm:w-auto">
              {tActions("close")}
            </Button>
          </div>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-5">
            <fieldset className="flex flex-col gap-2">
              <legend className="pb-2 text-sm font-medium">{t("reasonsLegend")}</legend>
              {REPORT_REASONS.map((value) => (
                <label
                  key={value}
                  className="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3 hover:bg-muted/40 has-[:checked]:border-foreground"
                >
                  <input
                    type="radio"
                    name="reason"
                    value={value}
                    checked={reason === value}
                    onChange={() => setReason(value)}
                    className="mt-0.5 size-4 shrink-0 accent-foreground"
                    required
                  />
                  <span className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium">
                      {resolve(REPORT_REASON_COPY[value].label)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {resolve(REPORT_REASON_COPY[value].hint)}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>

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
              <p className="text-xs text-muted-foreground">{t("emailHelp")}</p>
            </div>

            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}

            <div className="flex items-center justify-end gap-3">
              <Button type="button" variant="ghost" onClick={close}>
                {tActions("cancel")}
              </Button>
              <Button type="submit" disabled={!reason || state === "sending"}>
                {state === "sending" ? tActions("sending") : t("send")}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}
