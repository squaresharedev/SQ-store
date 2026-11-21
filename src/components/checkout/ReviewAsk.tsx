"use client";

import { useId, useState, type CSSProperties, type ReactNode } from "react";
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
import type { BuyerOrder, BuyerReviewItem } from "@/types/checkout";
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
 *
 * AN ORDER OF SEVERAL PRODUCTS (a cart's) is reviewed product by product: a
 * row of the products, pictured, picks which one the stars are for, and each
 * keeps its own review (one per order and product). One product at a time,
 * so the card asks one question, as it does for a single product.
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
    | "ref"
    | "productId"
    | "productTitle"
    | "photo"
    | "firstName"
    | "isDigital"
    | "review"
    | "reviewRating"
    | "reviewReminder"
    | "reviewItems"
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
  // Every product of the order that has a review to give or one given: a
  // single product is described by the order's own fields.
  const items = reviewItemsOf(order);
  const [active, setActive] = useState(
    () => (items.find((item) => item.review === "open") ?? items[0])?.productId ?? null,
  );
  // Reviews sent on this visit, so a chip shows its tick at once.
  const [reviewed, setReviewed] = useState<ReadonlySet<string>>(() => new Set());
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

  async function stop() {
    if (await reminder.set(false)) setStopped(true);
  }

  // Shipped is not arrived: under the stars, a buyer still waiting can be
  // reminded.
  const reminderLine = waiting && (
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
  );

  // The stars, one card per product, only the chosen one shown, and each
  // card owns the dialog the reminder email opens for it. Before the goods
  // are here, only a review already given shows (as given).
  const visible = hasGoods ? items : items.filter((item) => item.review === "done");
  const shownActive = visible.some((item) => item.productId === active) ? active : (visible[0]?.productId ?? null);
  const cards = asks && visible.length > 0 && (
    <div className="flex flex-col gap-3">
      {visible.length > 1 && (
        <ReviewProductPicker items={visible} active={shownActive} reviewed={reviewed} theme={theme} onPick={setActive} />
      )}
      {visible.map((item) => (
        <ProductReview
          key={item.productId}
          order={order}
          item={item}
          active={item.productId === shownActive}
          many={items.length > 1}
          hasGoods={hasGoods}
          writing={writing}
          reminderLine={reminderLine}
          theme={theme}
          preview={preview}
          onSent={() => setReviewed((current) => new Set(current).add(item.productId))}
          onCloseWriting={() => setWriting(false)}
        />
      ))}
    </div>
  );

  let inline: ReactNode = cards;
  if (asks && !hasGoods && waiting && visible.length === 0) {
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

/** The order's products with a review to give, or one given. */
function reviewItemsOf(
  order: Pick<BuyerOrder, "productId" | "productTitle" | "photo" | "review" | "reviewRating" | "reviewItems">,
): BuyerReviewItem[] {
  const all =
    order.reviewItems ??
    (order.productId
      ? [
          {
            productId: order.productId,
            title: order.productTitle,
            photo: order.photo,
            review: order.review ?? "closed",
            ...(order.reviewRating !== undefined ? { rating: order.reviewRating } : {}),
          },
        ]
      : []);
  return all.filter((item) => item.review !== "closed");
}

/**
 * One product's review: its own draft (useReviewDraft), its card on the page
 * while it is the chosen one, and the dialog the reminder email's "write your
 * review" link opens for it.
 */
function ProductReview({
  order,
  item,
  active,
  many,
  hasGoods,
  writing,
  reminderLine,
  theme,
  preview,
  onSent,
  onCloseWriting,
}: {
  order: Pick<BuyerOrder, "ref" | "firstName">;
  item: BuyerReviewItem;
  active: boolean;
  /** One of several products: the card names it. */
  many: boolean;
  hasGoods: boolean;
  writing: boolean;
  reminderLine: ReactNode;
  theme: CheckoutTheme;
  preview: boolean;
  onSent: () => void;
  onCloseWriting: () => void;
}) {
  const t = useTranslations("ProductPage.order.review");
  const draft = useReviewDraft({
    orderRef: order.ref,
    productId: item.productId,
    defaultName: order.firstName,
    state: item.review === "done" ? "done" : "open",
    givenRating: item.rating ?? null,
    preview,
    onSent,
  });
  const overlay = storefrontOverlayVars(theme.ink, theme.cornerRadius);
  const shown = !writing && (hasGoods || draft.stage === "done");

  function closeWriting() {
    onCloseWriting();
    draft.settle();
  }

  return (
    <>
      {shown && (
        <div hidden={!active} className="flex flex-col gap-3" data-order-review-item={item.productId}>
          <ReviewPanel draft={draft} theme={theme} subject={many ? item.title : undefined} />
          {draft.stage === "ask" && reminderLine}
        </div>
      )}

      {/* From the reminder email's "write your review" link. */}
      <Modal
        open={writing && active}
        onClose={closeWriting}
        title={t("title")}
        description={item.title}
        visual={
          item.photo ? (
            // eslint-disable-next-line @next/next/no-img-element -- a presigned R2 URL, like the order summary's
            <img
              src={item.photo.url}
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
    </>
  );
}

/**
 * Which product the stars are for, on an order of several: each one's photo
 * and name, a tick once it is reviewed. A toggle group (one pressed), on the
 * shop's own ink and corners.
 */
function ReviewProductPicker({
  items,
  active,
  reviewed,
  theme,
  onPick,
}: {
  items: readonly BuyerReviewItem[];
  active: string | null;
  reviewed: ReadonlySet<string>;
  theme: CheckoutTheme;
  onPick: (productId: string) => void;
}) {
  const t = useTranslations("ProductPage.order.review");
  const label = useId();
  return (
    <div role="group" aria-labelledby={label} className="flex flex-wrap gap-2" data-order-review-picker="">
      <span id={label} className="sr-only">
        {t("pickLegend")}
      </span>
      {items.map((item) => {
        const pressed = item.productId === active;
        const done = item.review === "done" || reviewed.has(item.productId);
        return (
          <button
            key={item.productId}
            type="button"
            aria-pressed={pressed}
            onClick={() => onPick(item.productId)}
            className={cn(
              "flex min-h-11 max-w-full items-center gap-2 border py-1.5 pr-3 pl-1.5 text-left text-sm",
              "transition-colors duration-base ease-standard",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
              pressed ? "font-semibold" : "opacity-75 hover:opacity-100",
            )}
            style={{
              borderColor: pressed ? theme.ink : theme.rule,
              borderRadius: `${theme.controlRadius}px`,
              backgroundColor: pressed ? subtleFill(theme.ink) : undefined,
              outlineColor: theme.ink,
            }}
            data-order-review-pick={item.productId}
            data-done={done || undefined}
          >
            <span
              className="relative size-8 shrink-0 overflow-hidden"
              style={{ borderRadius: `${theme.controlRadius}px`, backgroundColor: subtleFill(theme.ink) }}
            >
              {item.photo && (
                // eslint-disable-next-line @next/next/no-img-element -- a presigned R2 URL, like the order summary's
                <img src={item.photo.url} alt="" className="size-full object-cover" />
              )}
            </span>
            <span className="min-w-0 truncate">{item.title}</span>
            {done && (
              <>
                <Check className="size-4 shrink-0" strokeWidth={2.5} aria-hidden="true" />{" "}
                <span className="sr-only">{t("reviewed")}</span>
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}
