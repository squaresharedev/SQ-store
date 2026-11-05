"use client";

import { useState, type CSSProperties } from "react";
import { Check, MailX, Star } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { Modal, ModalActions } from "@/components/ui/modal";
import {
  CTA_BUTTON_CLASS,
  ctaStyle,
  storefrontOverlayVars,
  subtleFill,
} from "@/components/product-page/product-page-maps";
import { ORDER_REVIEW_REMINDER_API_PATH } from "@/lib/checkout/paths";
import { REVIEW_RATING_MAX } from "@/lib/reviews/limits";
import type { ReviewDialog } from "@/lib/reviews/reminders";
import type { BuyerOrder } from "@/types/checkout";
import { ReviewPanel, useReviewDraft } from "./ReviewPanel";
import type { CheckoutTheme } from "./checkout-theme";

type Reminder = NonNullable<BuyerOrder["reviewReminder"]>;

/** The reminder route's refusals the page says something specific about. */
type ReminderError = "closed" | "rateLimited" | "failed";

/** The quiet text button the reminder's switches are, beside their sentence. */
const TEXT_BUTTON_CLASS = "font-medium underline underline-offset-2 disabled:opacity-50";

/** The order's one review reminder email, as the buyer switches it on and off
 *  (app/api/orders/review-reminder). In the editor's preview it switches
 *  without sending anything. */
function useReviewReminder(orderRef: string, initial: Reminder | null, preview: boolean) {
  const [state, setState] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ReminderError | null>(null);
  const [previewed, setPreviewed] = useState(false);

  async function set(want: boolean): Promise<boolean> {
    if (preview) {
      setState({ status: want ? "on" : "off", dueAt: null });
      setPreviewed(true);
      return true;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(ORDER_REVIEW_REMINDER_API_PATH, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderRef: orderRef, want }),
      });
      const result = (await response.json().catch(() => null)) as
        | { ok: boolean; status?: Reminder["status"]; dueAt?: string | null; error?: string }
        | null;
      if (result?.ok && result.status) {
        const status = result.status;
        // A stop from the email's link may land on a page that shows no
        // reminder at all (the review is in already): nothing to update then.
        setState((current) => (current ? { status, dueAt: result.dueAt ?? null } : current));
        return true;
      }
      setError(result?.error === "closed" ? "closed" : result?.error === "rate_limited" ? "rateLimited" : "failed");
    } catch {
      setError("failed");
    } finally {
      setBusy(false);
    }
    return false;
  }

  return { state, busy, error, previewed, set };
}

/**
 * THE REVIEW, ASKED FOR AT THE RIGHT TIME, on a buyer's order page.
 *
 * Until the buyer has what they bought (a parcel not yet shipped, or the
 * thank-you straight after paying for a download), the page does not ask for
 * a review: it offers ONE reminder email instead, which nothing sends unless
 * the buyer presses for it (lib/reviews/reminders.ts says why it must be
 * opt-in). Once they have it, the stars (ReviewPanel), and under them, for a
 * buyer whose parcel has not actually arrived, the same reminder.
 *
 * The reminder email's two links open this page with a dialog: `write` holds
 * the same review as the card (one draft, so closing it loses nothing), and
 * `stop` takes the reminder back. Stopping works whatever else is true, so it
 * is offered even where the page shows no review at all (`asks` false).
 */
export function ReviewAsk({
  order,
  asks,
  hasGoods,
  dialog,
  storeName,
  theme,
  preview,
}: {
  order: Pick<
    BuyerOrder,
    "ref" | "productId" | "productTitle" | "photo" | "firstName" | "isDigital" | "review" | "reviewRating" | "reviewReminder"
  >;
  /** The review belongs on this page: the shop shows reviews, and the order
   *  is open to one or has one. */
  asks: boolean;
  /** lib/reviews/reminders.ts buyerHasGoods. */
  hasGoods: boolean;
  dialog: ReviewDialog | null;
  storeName: string;
  theme: CheckoutTheme;
  preview: boolean;
}) {
  const t = useTranslations("ProductPage.order.review");
  const tActions = useTranslations("Common.actions");
  const format = useFormatter();
  const draft = useReviewDraft({
    orderRef: order.ref,
    productId: order.productId ?? "",
    defaultName: order.firstName,
    state: order.review === "done" ? "done" : "open",
    givenRating: order.reviewRating ?? null,
    preview,
  });
  const reminder = useReviewReminder(order.ref, order.reviewReminder ?? null, preview);
  const canWrite = asks && order.review === "open" && hasGoods;
  const [writing, setWriting] = useState(dialog === "write" && canWrite && !preview);
  const [stopping, setStopping] = useState(dialog === "stop" && !preview);
  const [stopped, setStopped] = useState(false);

  const kind = order.isDigital ? "download" : "parcel";
  const overlay = storefrontOverlayVars(theme.ink, theme.cornerRadius);
  const cta = ctaStyle(theme.cta);
  const waiting = reminder.state && reminder.state.status !== "sent" ? reminder.state : null;
  const onText = (state: Reminder) =>
    state.dueAt
      ? t("later.onDate", {
          store: storeName,
          // UTC, so the server's render and the browser's agree; "around" a
          // day either way is what it promises anyway.
          date: format.dateTime(new Date(state.dueAt), { day: "numeric", month: "long", timeZone: "UTC" }),
        })
      : t("later.onLater", { store: storeName, kind });
  const errorText = reminder.error && (
    <p role="alert" className="text-sm font-medium text-destructive">
      {t(`later.errors.${reminder.error}`)}
    </p>
  );
  const previewNote = preview && reminder.previewed && <p className="text-xs opacity-70">{t("later.preview")}</p>;

  function closeWriting() {
    setWriting(false);
    draft.settle();
  }

  async function stop() {
    if (await reminder.set(false)) setStopped(true);
  }

  let inline = null;
  if (asks && !writing && (hasGoods || draft.stage === "done")) {
    inline = (
      <div className="flex flex-col gap-3">
        <ReviewPanel draft={draft} theme={theme} />
        {/* Shipped is not arrived: a buyer still waiting can be reminded. */}
        {draft.stage === "ask" && waiting && (
          <div className="flex flex-col items-center gap-1 text-center text-sm" data-order-review-reminder={waiting.status}>
            {waiting.status === "off" ? (
              <>
                <p>
                  <span className="opacity-75">{t("later.notYet", { kind })}</span>{" "}
                  <button type="button" className={TEXT_BUTTON_CLASS} disabled={reminder.busy} onClick={() => reminder.set(true)}>
                    {t("later.remind")}
                  </button>
                </p>
                <p className="text-xs opacity-70">{t("later.once", { store: storeName })}</p>
              </>
            ) : (
              <p className="opacity-75">
                <Check className="mr-1 inline size-4 align-text-bottom" strokeWidth={2.5} aria-hidden="true" />
                {onText(waiting)}{" "}
                <button type="button" className={TEXT_BUTTON_CLASS} disabled={reminder.busy} onClick={() => reminder.set(false)}>
                  {t("later.stop")}
                </button>
              </p>
            )}
            {errorText}
            {previewNote}
          </div>
        )}
      </div>
    );
  } else if (asks && !hasGoods && waiting) {
    // Not yet theirs: no stars to give, the reminder instead.
    inline = (
      <section
        className="flex flex-col items-center gap-3 border p-6 text-center @md:p-8"
        style={
          {
            borderColor: theme.rule,
            borderRadius: `${theme.surfaceRadius}px`,
            backgroundColor: subtleFill(theme.ink),
          } as CSSProperties
        }
        data-order-review="later"
        data-order-review-reminder={waiting.status}
        data-setting-skip=""
      >
        {/* The stars still to come: the card's one picture. */}
        <span className="flex gap-1" aria-hidden="true">
          {Array.from({ length: REVIEW_RATING_MAX }, (_, index) => (
            <Star key={index} className="size-6 opacity-30" strokeWidth={1.5} fill="none" />
          ))}
        </span>
        <h2 className="text-lg font-semibold">{t("later.title", { kind })}</h2>
        {waiting.status === "off" ? (
          <>
            <p className="max-w-sm text-sm opacity-75">
              {t("later.body", { store: storeName, kind })}
            </p>
            <button
              type="button"
              disabled={reminder.busy}
              onClick={() => reminder.set(true)}
              className={cn(CTA_BUTTON_CLASS, "mt-1 hover:opacity-90 disabled:opacity-50")}
              style={cta}
              data-review-reminder-ask=""
            >
              {t("later.remind")}
            </button>
          </>
        ) : (
          <>
            <p className="flex max-w-sm items-center gap-1.5 text-sm" role="status">
              <Check className="size-4 shrink-0" strokeWidth={2.5} aria-hidden="true" />
              {onText(waiting)}
            </p>
            <button type="button" className={cn(TEXT_BUTTON_CLASS, "text-sm")} disabled={reminder.busy} onClick={() => reminder.set(false)}>
              {t("later.stop")}
            </button>
          </>
        )}
        {errorText}
        {previewNote}
      </section>
    );
  }

  return (
    <>
      {inline}

      {/* From the reminder email's "write your review" link. */}
      <Modal
        open={writing}
        onClose={closeWriting}
        title={t("title")}
        description={order.productTitle}
        visual={
          order.photo ? (
            // eslint-disable-next-line @next/next/no-img-element -- a presigned R2 URL, like the order summary's
            <img
              src={order.photo.url}
              alt=""
              className="size-20 object-cover"
              style={{ borderRadius: `${theme.controlRadius}px` }}
            />
          ) : undefined
        }
        size="lg"
        // The first control is a star: a stray Space would rate the product.
        initialFocus="dialog"
        themeVars={overlay}
      >
        <div data-order-review-dialog="">
          <ReviewPanel draft={draft} theme={theme} bare onDone={closeWriting} />
        </div>
      </Modal>

      {/* From the reminder email's stop link. */}
      <Modal
        open={stopping}
        onClose={() => setStopping(false)}
        title={stopped ? t("stopDialog.doneTitle") : t("stopDialog.title")}
        description={stopped ? t("stopDialog.doneBody") : t("stopDialog.body", { store: storeName })}
        visual={
          <span
            className="flex size-14 items-center justify-center rounded-full"
            style={{ backgroundColor: subtleFill(theme.ink) }}
            aria-hidden="true"
          >
            <MailX className="size-7" strokeWidth={1.75} />
          </span>
        }
        initialFocus="dialog"
        themeVars={overlay}
      >
        <div className="flex flex-col gap-3" data-order-review-stop={stopped ? "done" : "ask"}>
          {errorText}
          <ModalActions>
            <button
              type="button"
              disabled={reminder.busy}
              onClick={stopped ? () => setStopping(false) : stop}
              className={cn(CTA_BUTTON_CLASS, "hover:opacity-90 disabled:opacity-50 sm:w-auto")}
              style={cta}
            >
              {stopped ? tActions("close") : t("stopDialog.confirm")}
            </button>
          </ModalActions>
        </div>
      </Modal>
    </>
  );
}
