import { Check, Download, ExternalLink, MapPin } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { formatCents } from "@/lib/format/money";
import { regionName } from "@/lib/format/country";
import { orderDownloadApiPath } from "@/lib/checkout/paths";
import { AnimatedCheck } from "@/components/ui/animated-check";
import { CTA_BUTTON_CLASS, ctaStyle, subtleFill } from "@/components/product-page/product-page-maps";
import { PageShell } from "@/components/product-page/PageShell";
import { PoweredByFooter } from "@/components/product-page/PoweredByFooter";
import type { OrderPageData } from "@/types/checkout";
import { CelebrationConfetti } from "./Celebration";
import { CELEBRATION_ORIGIN } from "./confetti";
import { MakerNote } from "./CheckoutShowcase";
import { EditableText } from "./EditableText";
import { CHECKOUT_HEADLINE_MAX, CHECKOUT_THANKS_MESSAGE_MAX } from "@/types/storefront";
import { QuantityMark } from "./QuantityMark";
import { VersionChips } from "./VersionChips";
import { WithdrawalPanel } from "./WithdrawalPanel";
import { resolveCheckoutTheme } from "./checkout-theme";

type Step = {
  key: string;
  title: string;
  detail: string | null;
  done: boolean;
  /** Somewhere to go from this step: the carrier's page for the parcel. */
  link?: { href: string; label: string };
};

/**
 * THE ORDER PAGE: the thank-you a buyer lands on straight after paying, and
 * the status page the same link opens later.
 *
 * What the seller designs here is the welcome: the heading, their own words,
 * the celebration, all in the checkout's colours. Everything below that is the
 * ORDER, stated from the order row itself: what was bought, what it cost, what
 * happens next (from the seller's real dispatch line and the shipment when it
 * exists), the download, and the right to withdraw. None of it is invented
 * and none of it is the seller's to remove.
 *
 * Server-compatible, like the checkout: the public route renders it for a
 * buyer, and the editor's thank-you artboard renders it from a sample order
 * built from the product being previewed.
 */
export function OrderStatusView({
  page,
  mode,
  placed,
}: {
  page: OrderPageData;
  mode: "public" | "preview";
  /** Straight after paying (`?placed=1`): play the celebration. */
  placed: boolean;
}) {
  const { storefront, order } = page;
  const { checkoutPage, productPage, seller } = storefront;
  const preview = mode === "preview";
  const t = useTranslations("ProductPage.order");
  const locale = useLocale();
  const theme = resolveCheckoutTheme(storefront);

  const sellerName = seller.businessName || storefront.name;
  const storeName =
    storefront.header?.show && storefront.header.name ? storefront.header.name : storefront.name;
  const date = (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(new Date(iso));
  // What the heading reads as while the seller has not written their own.
  const defaultHeadline = order.firstName ? t("thanksNamed", { name: order.firstName }) : t("thanks");

  // WHAT HAPPENS NEXT, from what is actually true of this order.
  const steps: Step[] = [
    { key: "paid", title: t("timeline.paid"), detail: t("timeline.paidDetail", { date: date(order.placedAt) }), done: true },
  ];
  if (order.isDigital) {
    steps.push({ key: "ready", title: t("timeline.ready"), detail: t("timeline.readyDetail"), done: true });
  } else {
    const shipped = order.fulfilment === "shipped";
    steps.push({
      key: "preparing",
      title: t("timeline.preparing"),
      detail: order.dispatch ?? t("timeline.preparingDetail", { seller: sellerName }),
      done: shipped,
    });
    steps.push({
      key: "shipped",
      title: t("timeline.shipped"),
      detail: shipped
        ? [
            order.shippedAt ? t("timeline.shippedDetail", { date: date(order.shippedAt) }) : null,
            order.trackingNumber ? t("timeline.tracking", { number: order.trackingNumber }) : null,
          ]
            .filter(Boolean)
            .join(" · ") || null
        : t("timeline.notYet"),
      done: shipped,
      // Only when the seller named the carrier: a number alone says nothing
      // about whose site it belongs to, and a guessed link is worse than none.
      ...(shipped && order.trackingLink
        ? {
            link: {
              href: order.trackingLink.url,
              label: t("timeline.track", { carrier: order.trackingLink.carrier }),
            },
          }
        : {}),
    });
  }
  const current = steps.findIndex((step) => !step.done);

  return (
    <PageShell
      storefront={storefront}
      backgroundColor={theme.surface}
      photo={storefront.pagePhotoUrl ? { url: storefront.pagePhotoUrl, tint: theme.surface } : null}
      font={productPage.font}
      ink={theme.ink}
      preview={preview}
      rootAttributes={{
        "data-order-page": mode,
        "data-page-ink": theme.ink,
        "data-order-fulfilment": order.fulfilment,
      }}
      footer={
        <PoweredByFooter
          ruleColor={theme.rule}
          sellerName={sellerName}
          product={{ id: order.productId ?? "", title: order.productTitle }}
          storefront={{ id: storefront.id, name: storeName }}
          preview={preview}
        />
      }
    >
      {/* Full width and positioned, so the confetti (which bursts from the
          check mark below and falls across the whole page) has the page to
          fill on the editor's artboard; a buyer's covers the screen. */}
      <div className="relative">
      {checkoutPage.celebrate === "confetti" && (
        <CelebrationConfetti
          play={placed}
          contained={preview}
          accent={storefront.theme.accent}
          button={theme.cta.fill}
          surface={theme.surface}
        />
      )}
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10 @md:px-6 @3xl:py-16">
        {/* THE WELCOME: the one part of this page the seller designs. */}
        <section
          className="flex flex-col items-center gap-4 text-center"
          data-setting-hotspot="thanks"
          data-order-hero=""
        >
          <span
            className="flex size-14 items-center justify-center rounded-full"
            style={{ backgroundColor: theme.cta.fill, color: theme.cta.text }}
            {...{ [CELEBRATION_ORIGIN]: "" }}
          >
            {placed ? <AnimatedCheck className="size-7" /> : <Check className="size-7" strokeWidth={2.5} aria-hidden="true" />}
          </span>
          <EditableText
            as="h1"
            field="thanksHeadline"
            value={checkoutPage.thanksHeadline}
            fallback={defaultHeadline}
            maxLength={CHECKOUT_HEADLINE_MAX}
            ariaLabel={t("editHeadline")}
            className="text-3xl font-semibold leading-tight @md:text-4xl"
          />
          <p className="text-sm opacity-75">
            {t("number", { number: order.number })}
            {order.maskedEmail && (
              <>
                {" · "}
                {t("confirmationSent", { email: order.maskedEmail })}
              </>
            )}
          </p>
          {(checkoutPage.thanksMessage || preview) && (
            <div className="w-full text-left">
              <MakerNote
                field="thanksMessage"
                note={checkoutPage.thanksMessage}
                signature={sellerName}
                ink={theme.ink}
                radius={theme.controlRadius}
                preview={preview}
                maxLength={CHECKOUT_THANKS_MESSAGE_MAX}
              />
            </div>
          )}
        </section>

        {/* WHAT WAS BOUGHT. */}
        <section
          className="flex items-center gap-4 border p-4"
          style={{ borderColor: theme.rule, borderRadius: `${theme.surfaceRadius}px` }}
          data-order-summary=""
        >
          {order.photo && (
            <div className="relative size-20 shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element -- a presigned R2 URL, like the product gallery's */}
              <img
                src={order.photo.url}
                alt={order.photo.alt}
                className={cn("size-full", productPage.imageFit === "cover" ? "object-cover" : "object-contain")}
                style={{ borderRadius: `${theme.controlRadius}px` }}
              />
              <QuantityMark quantity={order.quantity} cta={theme.cta} />
            </div>
          )}
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <p className="font-semibold leading-tight">{order.productTitle}</p>
            {/* The words the order was sold in, verbatim (never re-read from
                the product, which may have changed since), as chips. */}
            <VersionChips chips={order.selection} ink={theme.ink} cornerRadius={theme.cornerRadius} />
            {/* In words where there is no photo to badge, and for assistive
                tech either way (the badge is silent). */}
            {order.quantity > 1 && (
              <p className={order.photo ? "sr-only" : "text-sm opacity-80"}>
                {t("quantity", { quantity: order.quantity })}
              </p>
            )}
            {order.destination && (
              <p className="flex items-center gap-1.5 text-sm opacity-70">
                <MapPin className="size-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
                {t("deliverTo", {
                  place: `${order.destination.city}, ${regionName(order.destination.country, locale) ?? order.destination.country}`,
                })}
              </p>
            )}
          </div>
          <div className="shrink-0 text-right">
            <p className="text-xs opacity-70">{t("total")}</p>
            <p className="font-semibold tabular-nums" data-order-total={order.amountCents}>
              {formatCents(order.amountCents, order.currency, locale)}
            </p>
          </div>
        </section>

        {/* WHAT HAPPENS NEXT. */}
        <section className="flex flex-col gap-4" aria-labelledby="order-timeline" data-order-timeline="">
          <h2 id="order-timeline" className="text-base font-semibold">
            {t("timeline.label")}
          </h2>
          <ol className="flex flex-col">
            {steps.map((step, index) => (
              <li key={step.key} className="relative flex gap-4 pb-5 last:pb-0" data-order-step={step.key} data-done={step.done}>
                {index < steps.length - 1 && (
                  <span
                    className="absolute top-7 left-3.5 h-[calc(100%-1.75rem)] w-px"
                    style={{ backgroundColor: theme.rule }}
                    aria-hidden="true"
                  />
                )}
                <span
                  className={cn(
                    "relative flex size-7 shrink-0 items-center justify-center rounded-full border text-xs",
                    index === current && "font-semibold",
                  )}
                  style={
                    step.done
                      ? { backgroundColor: theme.cta.fill, color: theme.cta.text, borderColor: theme.cta.fill }
                      : { borderColor: index === current ? theme.ink : theme.rule, backgroundColor: subtleFill(theme.ink) }
                  }
                  aria-hidden="true"
                >
                  {step.done ? <Check className="size-3.5" strokeWidth={3} /> : index + 1}
                </span>
                {/* A step still to come reads quieter, at ONE muted level
                    (opacity-70, the page's proven-legible one) rather than a
                    dimmed block holding dimmed text, which compounds past what
                    small print can take. */}
                <div className="flex flex-col gap-0.5 pt-1">
                  <p className={cn("text-sm font-medium", !step.done && index !== current && "opacity-70")}>
                    {step.title}
                  </p>
                  {step.detail && <p className="text-sm opacity-70">{step.detail}</p>}
                  {step.link && (
                    // The carrier's own site, in a new tab so the order page
                    // stays open. noreferrer: this page's address is the
                    // buyer's credential and must not travel with the click.
                    <a
                      href={preview ? undefined : step.link.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex w-fit items-center gap-1 text-sm font-medium underline underline-offset-2"
                      data-order-track=""
                      data-setting-skip=""
                    >
                      {step.link.label}
                      <ExternalLink className="size-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </section>

        {order.isDigital && (
          <a
            href={preview ? undefined : orderDownloadApiPath(order.ref)}
            aria-disabled={preview || undefined}
            className={cn(CTA_BUTTON_CLASS, "hover:opacity-90")}
            style={ctaStyle(theme.cta)}
            data-order-download=""
            data-setting-skip=""
          >
            <Download className="size-4" strokeWidth={2.25} aria-hidden="true" />
            {order.digitalFormat ? t("download", { format: order.digitalFormat }) : t("downloadPlain")}
          </a>
        )}

        <WithdrawalPanel
          orderRef={order.ref}
          withdrawal={order.withdrawal}
          sellerName={sellerName}
          ink={theme.ink}
          rule={theme.rule}
          cta={theme.cta}
          preview={preview}
        />

        {seller.email && (
          <p className="text-sm opacity-75" data-setting-skip="">
            {t("contact", { seller: sellerName })}{" "}
            <a href={`mailto:${seller.email}`} className="underline underline-offset-2">
              {seller.email}
            </a>
          </p>
        )}
      </div>
      </div>
    </PageShell>
  );
}
