"use client";

import { useId, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { Star } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { fieldBaseClass } from "@/components/ui/control-styles";
import {
  CTA_BUTTON_CLASS,
  ctaStyle,
  storefrontOverlayVars,
  subtleFill,
} from "@/components/product-page/product-page-maps";
import { productReviewsApiPath } from "@/lib/reviews/paths";
import { REVIEW_AUTHOR_MAX, REVIEW_BODY_MAX, REVIEW_RATING_MAX, REVIEW_TITLE_MAX } from "@/lib/reviews/limits";
import type { CheckoutTheme } from "./checkout-theme";

const RATINGS = Array.from({ length: REVIEW_RATING_MAX }, (_, index) => index + 1);

/** Star sizes: the ones a buyer picks from, the ones that land on "thanks",
 *  and the quiet row a returning buyer sees. */
const STAR_SIZE = { pick: "size-10 @md:size-11", landed: "size-10", done: "size-6" } as const;

/** The card's fields: the app's field, square-cornered whatever the shop's
 *  corner radius, so they read as boxes to write in. */
const reviewFieldClass = cn(fieldBaseClass, "rounded-none");

/** The route's refusals this card says something specific about. */
type ReviewError = "notEligible" | "rateLimited" | "failed";

/**
 * THE REVIEW ASK on a buyer's order page: the thank-you straight after paying,
 * and the same page whenever the buyer comes back to it from their email.
 *
 * WHY HERE. Buyers have no accounts, and the order page is the one place a
 * buyer proves what they bought: its address is the order's credential, and
 * the review is sent with it (app/api/products/[id]/reviews). So every review
 * written here is from a paid order and carries the "Verified buyer" badge.
 *
 * ONE QUESTION FIRST. The card is a heading and five big yellow stars.
 * Choosing one pops it and opens the rest in place: a title, the words, and
 * the name to show (prefilled with the first name on the order). Sent, the
 * stars they gave land one after another above the thank-you, and the card
 * stays a thank-you when the page is opened again.
 *
 * In the editor's preview it works the same, so a seller can try it, but
 * sends nothing and says so.
 */
export function ReviewPanel({
  orderRef,
  productId,
  defaultName,
  state,
  givenRating,
  theme,
  preview,
}: {
  orderRef: string;
  productId: string;
  defaultName: string | null;
  state: "open" | "done";
  /** The stars of the review this order already has. */
  givenRating: number | null;
  theme: CheckoutTheme;
  preview: boolean;
}) {
  const t = useTranslations("ProductPage.order.review");
  const tReviews = useTranslations("ProductPage.reviews");
  const tActions = useTranslations("Common.actions");
  const ids = { heading: useId(), stars: useId(), title: useId(), body: useId(), name: useId(), nameHelp: useId() };
  const [stage, setStage] = useState<"ask" | "sent" | "done">(state === "done" ? "done" : "ask");
  const [rating, setRating] = useState(givenRating ?? 0);
  const [hovered, setHovered] = useState(0);
  // Bumped on every choice, so the chosen star remounts and pops again.
  const [taps, setTaps] = useState(0);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [name, setName] = useState(defaultName ?? "");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<ReviewError | null>(null);

  // The fields sit on the page's own colour inside the tinted card, so they
  // read as places to type rather than as more of the card.
  const cardStyle = {
    ...storefrontOverlayVars(theme.ink, theme.cornerRadius),
    "--background": theme.surface,
    borderColor: theme.rule,
    borderRadius: `${theme.surfaceRadius}px`,
    backgroundColor: subtleFill(theme.ink),
  } as CSSProperties;
  const starsLabel = (value: number) => tReviews("stars", { rating: value });

  function choose(value: number) {
    setRating(value);
    setTaps((count) => count + 1);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (sending || rating === 0 || !body.trim() || !name.trim()) return;
    if (preview) {
      setStage("sent");
      return;
    }
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
        setStage("sent");
        return;
      }
      setError(result?.error === "not_eligible" ? "notEligible" : result?.error === "rate_limited" ? "rateLimited" : "failed");
    } catch {
      setError("failed");
    } finally {
      setSending(false);
    }
  }

  if (stage === "done") {
    return (
      <section
        className="flex flex-col items-center gap-2 border p-6 text-center"
        style={cardStyle}
        data-order-review="done"
        data-setting-skip=""
        role="status"
      >
        {rating > 0 && <GivenStars rating={rating} label={starsLabel(rating)} size={STAR_SIZE.done} />}
        <p className="text-sm">{t("done")}</p>
      </section>
    );
  }

  if (stage === "sent") {
    return (
      <section
        className="flex flex-col items-center gap-3 border px-6 py-8 text-center @md:py-10"
        style={cardStyle}
        data-order-review="sent"
        data-setting-skip=""
        role="status"
      >
        <GivenStars rating={rating} label={starsLabel(rating)} size={STAR_SIZE.landed} land />
        <h2 className="mt-2 text-lg font-semibold">{t("sentTitle")}</h2>
        <p className="max-w-sm text-sm opacity-75">{t("sentBody")}</p>
        {preview && <p className="text-xs opacity-70">{t("previewSent")}</p>}
      </section>
    );
  }

  const shown = hovered || rating;
  return (
    <section
      className="flex flex-col items-center gap-5 border p-6 text-center @md:p-8"
      style={cardStyle}
      aria-labelledby={ids.heading}
      data-order-review="ask"
      data-setting-skip=""
    >
      <h2 id={ids.heading} className="text-lg font-semibold">
        {t("title")}
      </h2>

      <fieldset className="flex flex-col items-center gap-2">
        <legend className="sr-only">{t("ratingLegend")}</legend>
        <div className="flex gap-0.5" onMouseLeave={() => setHovered(0)}>
          {RATINGS.map((value) => {
            const lit = value <= shown;
            const popped = value === rating && taps > 0;
            return (
              <label
                key={value}
                className="group cursor-pointer rounded-sm p-1 has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-ring"
                onMouseEnter={() => setHovered(value)}
              >
                <input
                  type="radio"
                  name={ids.stars}
                  value={value}
                  checked={rating === value}
                  onChange={() => choose(value)}
                  className="sr-only"
                  data-review-star={value}
                />
                <span className="sr-only">{t("ratingOption", { rating: value })}</span>
                <span
                  // A new key on each choice replays the pop.
                  key={popped ? `pop-${taps}` : "rest"}
                  className={cn(
                    "inline-flex transition-[scale] duration-base ease-standard motion-safe:group-hover:scale-110",
                    popped && "review-star-tap",
                  )}
                  aria-hidden="true"
                >
                  <Star
                    className={cn(STAR_SIZE.pick, lit ? "text-rating" : "opacity-30")}
                    strokeWidth={1.5}
                    fill={lit ? "currentColor" : "none"}
                  />
                </span>
              </label>
            );
          })}
        </div>
        <p className="min-h-5 text-sm font-medium opacity-80" aria-hidden="true">
          {shown > 0 ? t("ratingWords", { rating: shown }) : t("ratingPrompt")}
        </p>
      </fieldset>

      {rating > 0 && (
        <form
          onSubmit={submit}
          noValidate
          className="flex w-full flex-col gap-4 text-left transition-opacity duration-slow ease-standard starting:opacity-0"
          data-order-review-form=""
        >
          <Field id={ids.title} label={t("titleLabel")}>
            <input
              id={ids.title}
              maxLength={REVIEW_TITLE_MAX}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={t("titlePlaceholder")}
              className={reviewFieldClass}
            />
          </Field>
          <Field id={ids.body} label={t("bodyLabel")}>
            <textarea
              id={ids.body}
              rows={4}
              required
              maxLength={REVIEW_BODY_MAX}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder={t("bodyPlaceholder")}
              className={cn(reviewFieldClass, "resize-y")}
            />
          </Field>
          <Field id={ids.name} label={t("nameLabel")} hint={{ id: ids.nameHelp, text: t("nameHelp") }}>
            <input
              id={ids.name}
              required
              autoComplete="given-name"
              maxLength={REVIEW_AUTHOR_MAX}
              value={name}
              onChange={(event) => setName(event.target.value)}
              aria-describedby={ids.nameHelp}
              className={reviewFieldClass}
            />
          </Field>

          {error && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {t(`errors.${error}`)}
            </p>
          )}

          <button
            type="submit"
            disabled={!body.trim() || !name.trim() || sending}
            className={cn(CTA_BUTTON_CLASS, "mt-1 hover:opacity-90 disabled:opacity-50")}
            style={ctaStyle(theme.cta)}
            data-order-review-send=""
          >
            {sending ? tActions("sending") : t("send")}
          </button>
        </form>
      )}
    </section>
  );
}

/**
 * The stars a buyer gave, in the review yellow, read as one image ("Rated 4
 * stars out of 5"). With `land`, each given star drops into its outlined slot
 * in turn with a ring bursting out behind it (globals.css review-star-*).
 */
function GivenStars({
  rating,
  label,
  size,
  land = false,
}: {
  rating: number;
  label: string;
  size: string;
  land?: boolean;
}) {
  return (
    <span role="img" aria-label={label} className="flex gap-1.5" data-review-stars={rating}>
      {RATINGS.map((value, index) => {
        const given = value <= rating;
        return (
          <span
            key={value}
            className="relative inline-flex"
            style={{ "--star-index": index } as CSSProperties}
            aria-hidden="true"
          >
            <Star className={cn(size, "opacity-30")} strokeWidth={1.5} fill="none" />
            {given && (
              <>
                {land && <span className="review-star-burst absolute inset-0 rounded-full border-2 border-rating" />}
                <span className={cn("absolute inset-0 inline-flex", land && "review-star-land")}>
                  <Star className={cn(size, "text-rating")} strokeWidth={1.5} fill="currentColor" />
                </span>
              </>
            )}
          </span>
        );
      })}
    </span>
  );
}

/** A labelled field on the card: the label, the control, one short hint. */
function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: { id: string; text: string };
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && (
        <p id={hint.id} className="text-xs opacity-70">
          {hint.text}
        </p>
      )}
    </div>
  );
}
