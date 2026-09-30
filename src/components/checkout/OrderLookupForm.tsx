"use client";

import { useId, useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { fieldBaseClass } from "@/components/ui/control-styles";
import {
  CTA_BUTTON_CLASS,
  ctaStyle,
  storefrontOverlayVars,
  type CtaAppearance,
} from "@/components/product-page/product-page-maps";
import { ORDER_LOOKUP_API_PATH } from "@/lib/checkout/paths";

/**
 * "Email me my order link": the email the order was placed with, and the
 * number on it. The answer is always the same sentence, match or not (see the
 * route for why), and the link only ever goes to the inbox.
 */
export function OrderLookupForm({
  storefrontId,
  ink,
  cornerRadius,
  cta,
}: {
  storefrontId: string;
  ink: string;
  cornerRadius: number;
  cta: CtaAppearance;
}) {
  const t = useTranslations("ProductPage.order.lookup");
  const locale = useLocale();
  const emailId = useId();
  const numberId = useId();
  const [email, setEmail] = useState("");
  const [number, setNumber] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done" | "limited">("idle");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (state === "sending") return;
    setState("sending");
    try {
      const response = await fetch(ORDER_LOOKUP_API_PATH, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ storefrontId, email: email.trim(), number: number.trim(), locale }),
      });
      setState(response.status === 429 ? "limited" : "done");
    } catch {
      setState("idle");
    }
  }

  if (state === "done") {
    return (
      <p role="status" className="text-sm" data-order-lookup="done">
        {t("done")}
      </p>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-4"
      style={storefrontOverlayVars(ink, cornerRadius)}
      data-order-lookup=""
    >
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
      <div className="flex flex-col gap-1.5">
        <label htmlFor={numberId} className="text-sm font-medium">
          {t("number")}
        </label>
        <input
          id={numberId}
          className={cn(fieldBaseClass, "uppercase")}
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={20}
          required
          value={number}
          onChange={(event) => setNumber(event.target.value)}
        />
      </div>
      {state === "limited" && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {t("rateLimited")}
        </p>
      )}
      <button
        type="submit"
        disabled={state === "sending" || !email.trim() || !number.trim()}
        className={cn(CTA_BUTTON_CLASS, "disabled:opacity-60")}
        style={ctaStyle(cta)}
      >
        {state === "sending" ? t("sending") : t("submit")}
      </button>
    </form>
  );
}
