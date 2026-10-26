"use client";

import { useId, useState, type FormEvent } from "react";
import { Star } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { Modal, ModalActions } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { HeroMark } from "@/components/ui/HeroMark";
import { AnimatedCheck } from "@/components/ui/animated-check";
import { infoTextClass } from "@/components/ui/control-styles";
import { CTA_BUTTON_CLASS, ctaGhostStyle, type CtaAppearance } from "@/components/product-page/product-page-maps";
import { productReviewsApiPath } from "@/lib/reviews/paths";
import { REVIEW_AUTHOR_MAX, REVIEW_BODY_MAX, REVIEW_RATING_MAX, REVIEW_TITLE_MAX } from "@/lib/reviews/limits";

const RATINGS = Array.from({ length: REVIEW_RATING_MAX }, (_, index) => index + 1);

/** The route's refusals this dialog says something specific about. */
type ReviewError = "notEligible" | "rateLimited" | "failed";

/**
 * "Review this product" on a buyer's order page, and the dialog behind it.
 *
 * WHY HERE. Buyers have no accounts, and the order page is the one place a
 * buyer proves what they bought: its address is the order's credential, and
 * the review is sent with it (app/api/products/[id]/reviews). So every review
 * written here is from a paid order and carries the "Verified buyer" badge.
 *
 * The dialog asks for what a review is, in the order a person answers: the
 * stars, then the words, then the name to show (prefilled with the first name
 * on the order, and theirs to change). A title is optional.
 */
export function ReviewPanel({
  orderRef,
  productId,
  productTitle,
  defaultName,
  state: initialState,
  ink,
  rule,
  cta,
  preview,
}: {
  orderRef: string;
  productId: string;
  productTitle: string;
  defaultName: string | null;
  state: "open" | "done";
  ink: string;
  rule: string;
  cta: CtaAppearance;
  preview: boolean;
}) {
  const t = useTranslations("ProductPage.order.review");
  const tActions = useTranslations("Common.actions");
  const ids = { title: useId(), body: useId(), name: useId() };
  const [state, setState] = useState(initialState);
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(0);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [name, setName] = useState(defaultName ?? "");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<ReviewError | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (preview || sending || rating === 0) return;
    setSending(true);
    setError(null);
    try {
      const response = await fetch(productReviewsApiPath(productId), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderRef, rating, title: title.trim(), body: body.trim(), authorName: name.trim() }),
      });
      const result = (await response.json().catch(() => null)) as { ok: boolean; error?: string } | null;
      if (result?.ok || result?.error === "already_reviewed") {
        setSent(true);
        setState("done");
        return;
      }
      setError(result?.error === "not_eligible" ? "notEligible" : result?.error === "rate_limited" ? "rateLimited" : "failed");
    } catch {
      setError("failed");
    } finally {
      setSending(false);
    }
  }

  if (state === "done" && !open) {
    return (
      <section className="border-t pt-6 text-sm" style={{ borderColor: rule }} data-order-review="done" role="status">
        <p>{t("done")}</p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-4 border-t pt-6" style={{ borderColor: rule }} data-order-review="">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">{t("title")}</h2>
        <p className="text-sm opacity-80">{t("body", { product: productTitle })}</p>
      </div>
      <button
        type="button"
        onClick={preview ? undefined : () => setOpen(true)}
        aria-disabled={preview || undefined}
        className={cn(CTA_BUTTON_CLASS, "w-auto self-start hover:opacity-90")}
        style={ctaGhostStyle(cta, ink)}
        data-order-review-open=""
      >
        {t("open")}
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        // The first control is a star that RECORDS a rating: land on the panel
        // so a stray keystroke cannot rate the product.
        initialFocus="dialog"
        visual={sent ? <HeroMark tone="success" icon={AnimatedCheck} /> : <HeroMark icon={Star} />}
        title={sent ? t("sentTitle") : t("dialogTitle")}
        description={sent ? t("sentBody") : productTitle}
      >
        {sent ? (
          <ModalActions>
            <Button type="button" onClick={() => setOpen(false)}>
              {tActions("close")}
            </Button>
          </ModalActions>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-4" data-order-review-form="">
            <fieldset className="flex flex-col items-center gap-2">
              <legend className="sr-only">{t("ratingLegend")}</legend>
              <div className="flex gap-1">
                {RATINGS.map((value) => (
                  <label key={value} className="cursor-pointer rounded-sm p-1 has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-ring">
                    <input
                      type="radio"
                      name="rating"
                      value={value}
                      checked={rating === value}
                      onChange={() => setRating(value)}
                      className="sr-only"
                      data-review-star={value}
                    />
                    <span className="sr-only">{t("ratingOption", { rating: value })}</span>
                    <Star
                      aria-hidden="true"
                      className={cn("size-8 text-foreground transition-opacity duration-base ease-standard", value > rating && "opacity-30")}
                      strokeWidth={1.5}
                      fill={value <= rating ? "currentColor" : "none"}
                    />
                  </label>
                ))}
              </div>
              <p className={infoTextClass} aria-live="polite">
                {rating > 0 ? t("ratingWords", { rating }) : t("ratingPrompt")}
              </p>
            </fieldset>

            <div className="flex flex-col gap-2">
              <Label htmlFor={ids.body}>{t("bodyLabel")}</Label>
              <Textarea
                id={ids.body}
                rows={4}
                required
                maxLength={REVIEW_BODY_MAX}
                value={body}
                onChange={(event) => setBody(event.target.value)}
                placeholder={t("bodyPlaceholder")}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor={ids.title}>{t("titleLabel")}</Label>
              <Input
                id={ids.title}
                maxLength={REVIEW_TITLE_MAX}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor={ids.name}>{t("nameLabel")}</Label>
              <Input
                id={ids.name}
                required
                autoComplete="given-name"
                maxLength={REVIEW_AUTHOR_MAX}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
              <p className={infoTextClass}>{t("nameHelp")}</p>
            </div>

            {error && (
              <p role="alert" className="text-sm text-destructive">
                {t(`errors.${error}`)}
              </p>
            )}

            <ModalActions>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                {tActions("cancel")}
              </Button>
              <Button type="submit" disabled={rating === 0 || !body.trim() || !name.trim() || sending}>
                {sending ? tActions("sending") : t("send")}
              </Button>
            </ModalActions>
          </form>
        )}
      </Modal>
    </section>
  );
}
