"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Plus, TicketPercent } from "lucide-react";
import { useTranslations } from "next-intl";
import { fieldBaseClass } from "@/components/ui/control-styles";
import { checkoutDiscountApiPath } from "@/lib/checkout/paths";
import { DISCOUNT_CODE_MAX } from "@/types/discount";
import type { DiscountCheckResponse } from "@/types/checkout";
import { useAppliedCode } from "./DiscountCodeContext";
import { checkoutTextButtonClass } from "./checkout-theme";

type Notice = "invalid" | "rateLimited" | null;

/**
 * "Add a discount code": closed by default (most buyers have none), then one
 * field and Apply. Apply asks the check route for the code's terms; the totals
 * re-price from them at once (DiscountCodeContext), and the order route checks
 * the code again when the buyer pays.
 *
 * It sits INSIDE the order form, so Enter in the field applies the code
 * instead of placing the order.
 *
 * In the editor (`preview`) it opens and takes typing, so a seller sees how it
 * sits, but never asks the server.
 */
export function DiscountCodeField({
  storefrontId,
  productId,
  preview,
  outdone,
  ink,
}: {
  storefrontId: string;
  productId: string;
  preview: boolean;
  /** The applied code works, but the running sale is the better price. */
  outdone: boolean;
  ink: string;
}) {
  const t = useTranslations("ProductPage.checkout.discount");
  const id = useId();
  const noticeId = `${id}-notice`;
  const { terms, setTerms } = useAppliedCode();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [checking, setChecking] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Opened on purpose, so the typing starts in the field.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  async function apply() {
    const code = typed.trim();
    if (!code || checking || preview) return;
    setChecking(true);
    setNotice(null);
    try {
      const response = await fetch(checkoutDiscountApiPath(storefrontId, productId), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const result = (await response.json().catch(() => null)) as DiscountCheckResponse | null;
      if (result?.ok) {
        setTerms(result.terms);
        setTyped("");
      } else {
        setNotice(result?.error === "rate_limited" ? "rateLimited" : "invalid");
      }
    } catch {
      setNotice("invalid");
    }
    setChecking(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    void apply();
  }

  if (terms) {
    return (
      <div className="flex flex-col gap-1" data-checkout-discount="applied" data-setting-skip="">
        <div className="flex items-center justify-between gap-3 text-sm">
          <span className="flex items-center gap-1.5 font-medium">
            <TicketPercent className="size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
            {terms.code}
          </span>
          <button
            type="button"
            className={checkoutTextButtonClass}
            onClick={() => {
              setTerms(null);
              setNotice(null);
            }}
          >
            {t("remove")}
          </button>
        </div>
        <p className="text-xs opacity-75" role="status">
          {outdone ? t("saleBetter", { code: terms.code }) : t("applied", { code: terms.code })}
        </p>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        className={checkoutTextButtonClass}
        onClick={() => setOpen(true)}
        data-checkout-discount="closed"
        data-setting-skip=""
      >
        <Plus className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
        {t("add")}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-1.5" data-checkout-discount="open" data-setting-skip="">
      <label htmlFor={id} className="text-sm font-medium">
        {t("label")}
      </label>
      <div className="flex gap-2">
        <input
          id={id}
          className={fieldBaseClass}
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          onKeyDown={onKeyDown}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={DISCOUNT_CODE_MAX}
          aria-invalid={notice === "invalid"}
          aria-describedby={notice ? noticeId : undefined}
          ref={inputRef}
        />
        <button
          type="button"
          // rounded-sm: the same corner as the field beside it (the page sets
          // the token from the storefront's own radius).
          className="shrink-0 rounded-sm border px-4 text-sm font-medium transition-opacity duration-base ease-standard hover:opacity-80 disabled:opacity-50"
          style={{ borderColor: ink }}
          onClick={() => void apply()}
          disabled={checking || !typed.trim()}
          aria-busy={checking || undefined}
        >
          {checking ? t("applying") : t("apply")}
        </button>
      </div>
      {notice && (
        <p id={noticeId} className="text-xs font-medium text-destructive" role="alert">
          {notice === "rateLimited" ? t("rateLimited") : t("invalid")}
        </p>
      )}
    </div>
  );
}
