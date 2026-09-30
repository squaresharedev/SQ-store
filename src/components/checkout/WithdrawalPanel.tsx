"use client";

import { useId, useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { fieldBaseClass } from "@/components/ui/control-styles";
import { CTA_BUTTON_CLASS, ctaGhostStyle, type CtaAppearance } from "@/components/product-page/product-page-maps";
import { ORDER_WITHDRAW_API_PATH } from "@/lib/checkout/paths";
import type { BuyerWithdrawal } from "@/types/checkout";

type Stage = "closed" | "form" | "sending";

/**
 * THE WITHDRAWAL FUNCTION (Consumer Rights Directive art. 11a): the button that
 * lets a buyer withdraw from a purchase as easily as they made it.
 *
 * The law sets its shape, so this is not designable: a button labelled to say
 * exactly what it does ("Withdraw from contract here"), then a short form for
 * the buyer's name and the email they ordered with, then a second button that
 * confirms ("Confirm withdrawal"). The email is asked for rather than
 * prefilled: the order page is reachable by anyone holding its link, and the
 * address the order was placed with is the one thing such a person would not
 * know. Once sent, the page says when, and the buyer gets a confirmation by
 * email.
 *
 * Drawn in the page's own ink with the button's shape but not its fill (the
 * ghost style): available and findable, never the loudest thing on a page
 * that has just said thank you.
 */
export function WithdrawalPanel({
  orderRef,
  withdrawal,
  sellerName,
  ink,
  rule,
  cta,
  preview,
}: {
  orderRef: string;
  withdrawal: BuyerWithdrawal;
  sellerName: string;
  ink: string;
  rule: string;
  cta: CtaAppearance;
  preview: boolean;
}) {
  const t = useTranslations("ProductPage.order.withdraw");
  const locale = useLocale();
  const nameId = useId();
  const emailId = useId();
  const [stage, setStage] = useState<Stage>("closed");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [requestedAt, setRequestedAt] = useState(withdrawal.requestedAt);

  const date = (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(new Date(iso));

  if (requestedAt) {
    return (
      <section
        className="border-t pt-6 text-sm"
        style={{ borderColor: rule }}
        data-order-withdrawal="done"
        role="status"
      >
        <p>{t("done", { date: date(requestedAt), seller: sellerName })}</p>
      </section>
    );
  }
  if (!withdrawal.available) return null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (preview || stage === "sending") return;
    setStage("sending");
    setError(null);
    try {
      const response = await fetch(ORDER_WITHDRAW_API_PATH, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderRef, name: name.trim(), email: email.trim(), locale }),
      });
      const result = (await response.json().catch(() => null)) as
        | { ok: true; requestedAt: string }
        | { ok: false; error: string }
        | null;
      if (result?.ok) {
        setRequestedAt(result.requestedAt);
        return;
      }
      setError(result?.error === "email" ? t("emailMismatch") : t("failed", { seller: sellerName }));
    } catch {
      setError(t("failed", { seller: sellerName }));
    }
    setStage("form");
  }

  return (
    <section className="flex flex-col gap-4 border-t pt-6" style={{ borderColor: rule }} data-order-withdrawal="">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">{t("title")}</h2>
        <p className="text-sm opacity-80">
          {withdrawal.until
            ? t("body", { date: date(withdrawal.until) })
            : t("bodyOpen", { days: withdrawal.days })}
        </p>
      </div>

      {stage === "closed" ? (
        <button
          type="button"
          onClick={() => setStage("form")}
          className={cn(CTA_BUTTON_CLASS, "w-auto self-start hover:opacity-90")}
          style={ctaGhostStyle(cta, ink)}
          data-order-withdraw-open=""
        >
          {t("open")}
        </button>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate data-order-withdraw-form="">
          <p className="text-sm opacity-80">{t("formBody", { seller: sellerName })}</p>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={nameId} className="text-sm font-medium">
              {t("name")}
            </label>
            <input
              id={nameId}
              className={fieldBaseClass}
              autoComplete="name"
              maxLength={100}
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={emailId} className="text-sm font-medium">
              {t("email")}
            </label>
            <input
              id={emailId}
              type="email"
              className={fieldBaseClass}
              autoComplete="email"
              inputMode="email"
              maxLength={254}
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          {error && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {error}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={stage === "sending" || !name.trim() || !email.trim()}
              className={cn(CTA_BUTTON_CLASS, "w-auto disabled:opacity-60")}
              style={ctaGhostStyle(cta, ink)}
              data-order-withdraw-confirm=""
            >
              {stage === "sending" ? t("sending") : t("confirm")}
            </button>
            <button
              type="button"
              onClick={() => setStage("closed")}
              className="text-sm underline underline-offset-4 opacity-80 hover:opacity-100"
            >
              {t("cancel")}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
