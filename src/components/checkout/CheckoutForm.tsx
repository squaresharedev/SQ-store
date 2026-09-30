"use client";

import {
  useCallback,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from "react";
import { CreditCard, Gift, Info, Lock, Mail, Plus, Truck, type LucideIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { fieldBaseClass } from "@/components/ui/control-styles";
import {
  CTA_BUTTON_CLASS,
  ctaStyle,
  storefrontOverlayVars,
  type CtaAppearance,
} from "@/components/product-page/product-page-maps";
import { PageSelect } from "@/components/product-page/PageSelect";
import { QuantityPicker } from "@/components/product-page/QuantityPicker";
import { useQuantity } from "@/components/product-page/QuantityContext";
import { StickyBar } from "@/components/product-page/StickyBar";
import { Turnstile } from "@/components/auth/Turnstile";
import { formatCents } from "@/lib/format/money";
import { lineTotalCents } from "@/lib/products/quantity";
import { freeDeliveryGapCents, quoteShipping } from "@/lib/shipping/rates";
import { checkoutApiPath } from "@/lib/checkout/paths";
import { SHIP_TO_MAX } from "@/types/order-view";
import { CHECKOUT_HEADLINE_MAX, GIFT_MESSAGE_MAX } from "@/types/storefront";
import { EditableText } from "./EditableText";
import type { SellerShippingPolicy } from "@/types/shipping-policy";
import type { Currency } from "@/types/product";
import type { CheckoutErrorCode, PlaceOrderResponse } from "@/types/checkout";

/** Countries whose addresses carry a state or province a courier needs. */
const REGION_COUNTRIES = new Set(["US", "CA", "AU"]);
/** Countries where a postcode is often absent or optional (Ireland's Eircode). */
const POSTCODE_OPTIONAL = new Set(["IE"]);
/** Enough to catch a typo before the server does; the server decides. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** The bot check, present only where a deployment has configured it (the
 *  same "off unless configured" rule as signup, see LoginForm). */
const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

type FieldName =
  | "email"
  | "name"
  | "line1"
  | "line2"
  | "city"
  | "region"
  | "postalCode"
  | "giftMessage"
  | "consent";

type Values = Record<Exclude<FieldName, "consent">, string>;

const EMPTY: Values = {
  email: "",
  name: "",
  line1: "",
  line2: "",
  city: "",
  region: "",
  postalCode: "",
  giftMessage: "",
};

/**
 * THE CHECKOUT FORM: what a buyer fills in, the running total, and the button
 * that places the order.
 *
 * As short as an order allows. A download asks for an email and nothing else;
 * something that ships adds a name and an address, with the second address
 * line behind a link because most people do not need it. No account, before
 * or after. Every field says what it is for in its own label, validates when
 * the buyer leaves it rather than while they type, and keeps what they typed
 * whatever goes wrong.
 *
 * THE TOTAL HERE IS A PREVIEW. It is worked out with the same pure functions
 * the server uses (lineTotalCents, quoteShipping), so it matches, but nothing
 * this component computes is sent as a price: the order route re-quotes from
 * the database (lib/checkout/quote.ts) and charges that.
 *
 * In the editor (`preview`) the form is drawn exactly as a buyer sees it but
 * never submits, and the fields opt out of click-to-setting so a seller can
 * type into them to see how their own words sit.
 */
export function CheckoutForm({
  preview,
  unwired,
  storefrontId,
  productId,
  optionIds,
  attemptId,
  headline,
  defaultHeadline,
  product,
  shippingPolicy,
  countries,
  initialCountry,
  giftMessage: giftAllowed,
  vatIncluded,
  sellerName,
  surface,
  ink,
  rule,
  cornerRadius,
  cta,
  payment,
  legal,
  trust,
}: {
  preview: boolean;
  /** Editor only: say that buyers cannot reach this yet. */
  unwired: boolean;
  storefrontId: string;
  productId: string;
  optionIds: readonly string[];
  /** Minted when the page rendered, so a double click places one order. */
  attemptId: string | null;
  /** The seller's own headline, if they wrote one. */
  headline: string | undefined;
  /** What it reads as otherwise, in the buyer's language. */
  defaultHeadline: string;
  product: {
    priceCents: number;
    currency: Currency;
    isDigital: boolean;
    /** "PDF", for a download: what the buyer is getting, said before they pay
     *  (CRD art. 6(1)(r)-(s) functionality and format). */
    digitalFormat: string | null;
    shippingProfileId: string | null;
  };
  shippingPolicy: SellerShippingPolicy;
  /** Where this seller delivers, already named in the buyer's language. */
  countries: readonly { code: string; name: string }[];
  initialCountry: string;
  giftMessage: boolean;
  vatIncluded: boolean;
  sellerName: string;
  /** The page's solid surface, which the fields are filled with so a texture
   *  on the page never runs through the words typed into them. */
  surface: string;
  ink: string;
  rule: string;
  cornerRadius: number;
  cta: CtaAppearance;
  payment: ReactNode;
  legal: ReactNode;
  trust: ReactNode;
}) {
  const t = useTranslations("ProductPage.checkout");
  const locale = useLocale();
  const formId = useId();
  const { quantity, limit } = useQuantity();

  const [values, setValues] = useState<Values>(EMPTY);
  const [country, setCountry] = useState(initialCountry);
  const [showLine2, setShowLine2] = useState(false);
  const [giftOn, setGiftOn] = useState(false);
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  const [turnstileToken, setTurnstileToken] = useState("");
  // STABLE, and it has to be: the widget re-renders itself whenever its
  // callbacks change identity, and a fresh arrow here would tear it down and
  // redraw it on every keystroke and every blur, shifting the pay button out
  // from under a click that has already started.
  const clearTurnstileToken = useCallback(() => setTurnstileToken(""), []);
  const needsTurnstile = Boolean(TURNSTILE_SITE_KEY) && !preview;

  const ships = !product.isDigital;
  const showRegion = ships && REGION_COUNTRIES.has(country);
  const postcodeRequired = ships && !POSTCODE_OPTIONAL.has(country);

  const subtotal = lineTotalCents(product.priceCents, quantity);
  const shipping = ships
    ? quoteShipping(shippingPolicy, {
        profileId: product.shippingProfileId,
        country,
        subtotalCents: subtotal,
        currency: product.currency,
      })
    : null;
  const shippingCents = shipping?.ok ? shipping.rateCents : 0;
  const total = subtotal + shippingCents;
  const money = (cents: number) => formatCents(cents, product.currency, locale);
  const countryName = countries.find((entry) => entry.code === country)?.name ?? country;
  const deliverable = !shipping || shipping.ok;
  // "€12 away from free delivery": only while one more of it could get there,
  // since a nudge toward a quantity the buyer cannot pick is a tease.
  const freeGap = quantity < limit ? freeDeliveryGapCents(shippingPolicy, shipping, subtotal) : null;
  const freeProgress =
    freeGap !== null && shippingPolicy.freeOverCents ? (subtotal / shippingPolicy.freeOverCents) * 100 : 0;

  /**
   * After a failed submit, put the keyboard where the problem is: the first
   * field marked invalid, else the error message itself. Without it a
   * keyboard or screen reader user presses Pay, hears nothing, and is left on
   * the button with no idea anything went wrong (WCAG 3.3.1 / 4.1.3). Deferred
   * a frame so the invalid markers have rendered.
   */
  function focusProblem() {
    requestAnimationFrame(() => {
      const target =
        formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]') ?? alertRef.current;
      target?.focus();
    });
  }

  function set(field: keyof Values, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    if (errors[field]) setErrors((current) => ({ ...current, [field]: undefined }));
  }

  /** The checks worth making before a round trip. The server repeats them. */
  function problemWith(field: FieldName): string | undefined {
    const value = field === "consent" ? "" : values[field].trim();
    switch (field) {
      case "email":
        if (!value) return t("errors.required");
        return EMAIL_SHAPE.test(value) ? undefined : t("errors.email");
      case "name":
      case "line1":
      case "city":
        return ships && !value ? t("errors.required") : undefined;
      case "postalCode":
        return postcodeRequired && !value ? t("errors.required") : undefined;
      case "region":
        return showRegion && !value ? t("errors.required") : undefined;
      case "giftMessage":
        return giftOn && !value ? t("errors.required") : undefined;
      case "consent":
        return product.isDigital && !consent ? t("errors.consent") : undefined;
      default:
        return undefined;
    }
  }

  function check(field: FieldName) {
    const problem = problemWith(field);
    setErrors((current) => ({ ...current, [field]: problem }));
  }

  function messageFor(code: CheckoutErrorCode): string {
    return code === "not_shipped_here" ? t("errors.not_shipped_here", { seller: sellerName }) : t(`errors.${code}`);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (preview || submitting || !attemptId) return;

    const fields: FieldName[] = ["email", "name", "line1", "city", "region", "postalCode", "giftMessage", "consent"];
    const found: Partial<Record<FieldName, string>> = {};
    for (const field of fields) {
      const problem = problemWith(field);
      if (problem) found[field] = problem;
    }
    setErrors(found);
    const problems = Object.keys(found);
    if (problems.length > 0) {
      // The consent box on its own gets its own sentence: "check the
      // highlighted fields" would send a buyer looking for a field.
      setFormError(problems.length === 1 && found.consent ? found.consent : t("errors.fields"));
      focusProblem();
      return;
    }
    if (!deliverable) {
      setFormError(messageFor("not_shipped_here"));
      focusProblem();
      return;
    }

    setSubmitting(true);
    setFormError(null);
    const body = {
      attemptId,
      optionIds,
      quantity,
      email: values.email.trim(),
      locale,
      ...(needsTurnstile ? { turnstileToken } : {}),
      ...(ships
        ? {
            shipTo: {
              name: values.name.trim(),
              line1: values.line1.trim(),
              ...(showLine2 && values.line2.trim() ? { line2: values.line2.trim() } : {}),
              city: values.city.trim(),
              ...(showRegion ? { region: values.region.trim() } : {}),
              ...(values.postalCode.trim() ? { postalCode: values.postalCode.trim() } : {}),
              country,
            },
            ...(giftOn && values.giftMessage.trim() ? { giftMessage: values.giftMessage.trim() } : {}),
          }
        : { supplyConsent: consent }),
    };

    try {
      const response = await fetch(checkoutApiPath(storefrontId, productId), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = (await response.json().catch(() => null)) as PlaceOrderResponse | null;
      if (result?.ok) {
        window.location.assign(result.orderUrl);
        return;
      }
      const code: CheckoutErrorCode = result?.error ?? "failed";
      if (result && !result.ok && result.fields?.length) {
        setErrors(Object.fromEntries(result.fields.map((field) => [field, t("errors.fields")])));
      }
      setFormError(messageFor(code));
    } catch {
      setFormError(messageFor("failed"));
    }
    setSubmitting(false);
    focusProblem();
  }

  const payLabel = submitting ? t("placing") : t("pay", { amount: money(total) });
  const payDisabled = preview || submitting || !deliverable || (needsTurnstile && !turnstileToken);

  const payButton = (className?: string) => (
    <button
      type="submit"
      form={formId}
      // Not `disabled` in the editor: a disabled button swallows the click,
      // and in the editor a click on it has to reach the artboard, which
      // opens the button's settings. submit() ignores it there anyway.
      disabled={!preview && payDisabled}
      aria-disabled={payDisabled}
      className={cn(
        CTA_BUTTON_CLASS,
        payDisabled ? "cursor-default" : "hover:opacity-90",
        !preview && payDisabled && "opacity-60",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
        className,
      )}
      style={{ ...ctaStyle(cta), outlineColor: ink }}
      data-checkout-pay=""
      data-cta-fill={cta.fill}
    >
      <Lock className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
      {payLabel}
    </button>
  );

  return (
    <div
      className="flex flex-col gap-7"
      // The app's own field classes, re-pointed at the storefront's ink and
      // corners (the same re-skin the product page's dropdowns wear), so every
      // input here is the seller's rather than the dashboard's. The fields are
      // filled with the page's own surface rather than left see-through, so a
      // textured page reads as paper with clean boxes on it.
      style={{ ...storefrontOverlayVars(ink, cornerRadius), "--background": surface } as CSSProperties}
      data-checkout-form=""
    >
      {/* Typed straight onto the canvas in the editor (EditableText). */}
      <EditableText
        as="h1"
        field="headline"
        value={headline}
        fallback={defaultHeadline}
        maxLength={CHECKOUT_HEADLINE_MAX}
        ariaLabel={t("editHeadline")}
        className="text-2xl font-semibold leading-tight @md:text-3xl"
        attributes={{ "data-setting-hotspot": "message" }}
      />

      <form id={formId} ref={formRef} noValidate onSubmit={submit} className="flex flex-col gap-7">
        <Fieldset legend={t("sections.contact")} icon={Mail} skip>
          <Field
            label={t("fields.email")}
            hint={t("fields.emailHint")}
            hintToggleLabel={t("fields.whyAsk")}
            error={errors.email}
            input={(props) => (
              <input
                {...props}
                type="email"
                name="email"
                autoComplete="email"
                inputMode="email"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={254}
                value={values.email}
                onChange={(event) => set("email", event.target.value)}
                onBlur={() => check("email")}
              />
            )}
          />
        </Fieldset>

        {ships && (
          <Fieldset legend={t("sections.delivery")} icon={Truck} skip>
            <Field
              label={t("fields.name")}
              error={errors.name}
              input={(props) => (
                <input
                  {...props}
                  name="name"
                  autoComplete="shipping name"
                  maxLength={SHIP_TO_MAX.name}
                  value={values.name}
                  onChange={(event) => set("name", event.target.value)}
                  onBlur={() => check("name")}
                />
              )}
            />
            <Field
              label={t("fields.line1")}
              error={errors.line1}
              input={(props) => (
                <input
                  {...props}
                  name="line1"
                  autoComplete="shipping address-line1"
                  maxLength={SHIP_TO_MAX.line1}
                  value={values.line1}
                  onChange={(event) => set("line1", event.target.value)}
                  onBlur={() => check("line1")}
                />
              )}
            />
            {showLine2 ? (
              <Field
                label={t("fields.line2")}
                error={errors.line2}
                input={(props) => (
                  <input
                    {...props}
                    name="line2"
                    autoComplete="shipping address-line2"
                    maxLength={SHIP_TO_MAX.line2}
                    value={values.line2}
                    onChange={(event) => set("line2", event.target.value)}
                  />
                )}
              />
            ) : (
              <button
                type="button"
                className="inline-flex items-center gap-1.5 self-start text-sm opacity-75 transition-opacity duration-base ease-standard hover:opacity-100"
                onClick={() => setShowLine2(true)}
              >
                <Plus className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
                {t("fields.addLine2")}
              </button>
            )}
            {/* Side by side even on a phone: a postcode is short, and one row
                fewer is one scroll fewer. */}
            <div className="grid grid-cols-2 gap-3 @md:gap-4">
              <Field
                label={t("fields.city")}
                error={errors.city}
                input={(props) => (
                  <input
                    {...props}
                    name="city"
                    autoComplete="shipping address-level2"
                    maxLength={SHIP_TO_MAX.city}
                    value={values.city}
                    onChange={(event) => set("city", event.target.value)}
                    onBlur={() => check("city")}
                  />
                )}
              />
              <Field
                label={t("fields.postalCode")}
                error={errors.postalCode}
                input={(props) => (
                  <input
                    {...props}
                    name="postalCode"
                    autoComplete="shipping postal-code"
                    autoCapitalize="characters"
                    maxLength={SHIP_TO_MAX.postalCode}
                    value={values.postalCode}
                    onChange={(event) => set("postalCode", event.target.value)}
                    onBlur={() => check("postalCode")}
                  />
                )}
              />
            </div>
            {showRegion && (
              <Field
                label={t("fields.region")}
                error={errors.region}
                input={(props) => (
                  <input
                    {...props}
                    name="region"
                    autoComplete="shipping address-level1"
                    maxLength={SHIP_TO_MAX.region}
                    value={values.region}
                    onChange={(event) => set("region", event.target.value)}
                    onBlur={() => check("region")}
                  />
                )}
              />
            )}
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">{t("fields.country")}</span>
              {countries.length > 1 ? (
                <PageSelect
                  label={t("fields.country")}
                  value={country}
                  options={countries.map((entry) => ({ value: entry.code, label: entry.name }))}
                  onChange={setCountry}
                  radius={cornerRadius}
                  ink={ink}
                />
              ) : (
                <p className="text-base" data-checkout-country={country}>
                  {countryName}
                </p>
              )}
            </div>
          </Fieldset>
        )}

        {ships && giftAllowed && (
          <div className="flex flex-col gap-3" data-setting-hotspot="message" data-checkout-gift="">
            <label className="flex items-center gap-2.5 text-sm font-medium" data-setting-skip="">
              <input
                type="checkbox"
                checked={giftOn}
                onChange={(event) => setGiftOn(event.target.checked)}
                className="size-4"
                style={{ accentColor: cta.fill }}
              />
              <Gift className="size-4 opacity-70" strokeWidth={2} aria-hidden="true" />
              {t("gift.toggle")}
            </label>
            {giftOn && (
              <div data-setting-skip="">
                <Field
                  label={t("gift.label")}
                  hint={t("gift.count", { count: values.giftMessage.length, max: GIFT_MESSAGE_MAX })}
                  error={errors.giftMessage}
                  input={(props) => (
                    <textarea
                      {...props}
                      name="giftMessage"
                      rows={3}
                      maxLength={GIFT_MESSAGE_MAX}
                      placeholder={t("gift.placeholder")}
                      value={values.giftMessage}
                      onChange={(event) => set("giftMessage", event.target.value)}
                      onBlur={() => check("giftMessage")}
                      className={cn(props.className, "resize-none")}
                    />
                  )}
                />
              </div>
            )}
          </div>
        )}

        <Fieldset legend={t("sections.payment")} icon={CreditCard}>
          {payment}
        </Fieldset>

        <section className="flex flex-col gap-3" aria-label={t("sections.summary")} data-checkout-totals="">
          <div data-setting-skip="">
            <QuantityPicker
              priceCents={product.priceCents}
              currency={product.currency}
              radius={cornerRadius}
              ink={ink}
              inline
            />
          </div>
          {/* Two lists with the notes between them, because a <dl> may hold
              only term and value pairs: the lines, then what is said about
              them, then the total. */}
          <div className="flex flex-col gap-2 border-t pt-4 text-sm" style={{ borderColor: rule }}>
            <dl className="flex flex-col gap-2">
              <Line term={t("summary.subtotal")} value={money(subtotal)} dataKey="subtotal" cents={subtotal} />
              {ships && (
                <Line
                  term={t("summary.deliveryTo", { country: countryName })}
                  value={
                    shipping?.ok
                      ? shipping.free
                        ? t("summary.free")
                        : money(shipping.rateCents)
                      : t("errors.not_shipped_here", { seller: sellerName })
                  }
                  dataKey="delivery"
                  cents={shippingCents}
                />
              )}
            </dl>
            {!ships && (
              <p className="opacity-70">
                {product.digitalFormat
                  ? t("summary.digitalFormat", { format: product.digitalFormat })
                  : t("summary.digital")}
              </p>
            )}
            {freeGap !== null && (
              <div className="flex flex-col gap-1.5 pb-1" data-checkout-free-gap={freeGap}>
                <div className="h-1 overflow-hidden rounded-full bg-accent" aria-hidden="true">
                  {/* The page's own ink, which contrasts with the surface by
                      construction; the button's fill may not (a dark button
                      on a dark page). */}
                  <div
                    className="h-full rounded-full bg-foreground transition-[width] duration-slow ease-standard motion-reduce:transition-none"
                    style={{ width: `${Math.min(freeProgress, 100)}%` }}
                  />
                </div>
                <p className="flex items-center gap-1.5 text-xs opacity-75">
                  <Truck className="size-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
                  {t("summary.freeGap", { amount: money(freeGap) })}
                </p>
              </div>
            )}
            <dl>
              <div
                className="flex items-baseline justify-between gap-4 border-t pt-3 text-base font-semibold"
                style={{ borderColor: rule }}
                data-checkout-total={total}
              >
                <dt>{t("summary.total")}</dt>
                <dd className="flex items-baseline gap-2 tabular-nums">
                  {vatIncluded && <span className="text-xs font-normal opacity-70">{t("summary.inclVat")}</span>}
                  <span className="text-xl">{money(total)}</span>
                </dd>
              </div>
            </dl>
          </div>
        </section>

        <div className="flex flex-col gap-4">
          {legal}
          {product.isDigital && (
            <div className="flex flex-col gap-1" data-setting-skip="">
              <label className="flex items-start gap-2.5 text-sm" data-checkout-consent="">
                <input
                  type="checkbox"
                  name="consent"
                  checked={consent}
                  onChange={(event) => {
                    setConsent(event.target.checked);
                    if (event.target.checked) setErrors((current) => ({ ...current, consent: undefined }));
                  }}
                  aria-invalid={Boolean(errors.consent)}
                  className="mt-0.5 size-4 shrink-0"
                  style={{ accentColor: cta.fill }}
                />
                {t("legal.digitalConsent")}
              </label>
              {errors.consent && <FieldError message={errors.consent} />}
            </div>
          )}
        </div>

        {formError && (
          <div
            ref={alertRef}
            role="alert"
            tabIndex={-1}
            className="border-l-2 border-destructive py-1 pl-3 text-sm focus:outline-none"
            data-checkout-error=""
          >
            <p className="font-medium">{t("errors.title")}</p>
            <p className="opacity-80">{formError}</p>
          </div>
        )}

        {needsTurnstile && TURNSTILE_SITE_KEY && (
          <Turnstile
            siteKey={TURNSTILE_SITE_KEY}
            onVerify={setTurnstileToken}
            onExpire={clearTurnstileToken}
          />
        )}

        {/* THE BUTTON, and right under it what a buyer checks on the way to
            clicking it: when it leaves, how it comes back. Glanced at, so
            badges rather than sentences. */}
        <div className="flex flex-col gap-3" data-setting-hotspot="cta">
          {payButton()}
          {preview && unwired && <p className="text-center text-xs opacity-70">{t("unwired")}</p>}
          {trust}
        </div>
      </form>

      {/* The pay button in reach on a phone, with the total beside it. The
          same button (it submits the same form), not a second one. */}
      <StickyBar
        preview={preview}
        hotspot="cta"
        // The form's own Pay button: the bar steps aside while it is on screen.
        watch="form [data-checkout-pay]"
        attributes={{ "data-checkout-sticky": "" }}
      >
        <div className="min-w-0 flex-1">
          <p className="text-xs opacity-70">{t("summary.total")}</p>
          <p className="text-base font-semibold tabular-nums">{money(total)}</p>
        </div>
        {/* The legally worded label can be long ("Order with obligation to
            pay"); let it wrap rather than push the total off a phone. */}
        {payButton("w-auto max-w-[62%] min-w-0 shrink whitespace-normal text-balance text-center leading-tight")}
      </StickyBar>
    </div>
  );
}

/** One step of the form, led by an icon of what it is for, so a buyer scanning
 *  the page sees three steps (a letter, a van, a card) before any words. */
function Fieldset({
  legend,
  icon: Icon,
  skip = false,
  children,
}: {
  legend: string;
  icon: LucideIcon;
  skip?: boolean;
  children: ReactNode;
}) {
  return (
    <fieldset className="flex flex-col gap-4" {...(skip ? { "data-setting-skip": "" } : {})}>
      <legend className="flex items-center gap-2.5 pb-3 text-lg font-semibold">
        {/* bg-accent is the page's own ink at a whisper (storefrontOverlayVars). */}
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent" aria-hidden="true">
          <Icon className="size-3.5" strokeWidth={2.25} />
        </span>
        {legend}
      </legend>
      {children}
    </fieldset>
  );
}

type InputProps = {
  id: string;
  className: string;
  "aria-invalid": boolean;
  "aria-describedby": string | undefined;
};

/**
 * A label, the field, and what is wrong with it, wired together.
 *
 * A hint with a `hintToggleLabel` is FOLDED: an (i) beside the label shows it,
 * because "what is this for" is a question some buyers have and most do not.
 * Folded is not removed. The hint stays in the page as the field's
 * description, so a screen reader still hears it with the field, and it
 * simply becomes visible when asked for.
 */
function Field({
  label,
  hint,
  hintToggleLabel,
  error,
  input,
}: {
  label: string;
  hint?: string;
  /** The (i)'s accessible name. Absent = the hint is always shown. */
  hintToggleLabel?: string;
  error?: string;
  input: (props: InputProps) => ReactNode;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const [hintOpen, setHintOpen] = useState(false);
  const folded = Boolean(hintToggleLabel) && !hintOpen;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        {hint && hintToggleLabel && !error && (
          <button
            type="button"
            className="flex size-5 items-center justify-center rounded-full opacity-60 transition-opacity duration-base ease-standard hover:opacity-100 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2"
            aria-label={hintToggleLabel}
            aria-expanded={hintOpen}
            aria-controls={hintId}
            onClick={() => setHintOpen((open) => !open)}
            data-field-hint-toggle=""
          >
            <Info className="size-3.5" strokeWidth={2} aria-hidden="true" />
          </button>
        )}
      </div>
      {input({ id, className: fieldBaseClass, "aria-invalid": Boolean(error), "aria-describedby": describedBy })}
      {hint && !error && (
        <p id={hintId} className={folded ? "sr-only" : "text-xs opacity-70"}>
          {hint}
        </p>
      )}
      {error && <FieldError id={errorId} message={error} />}
    </div>
  );
}

function FieldError({ id, message }: { id?: string; message: string }) {
  return (
    <p id={id} className="text-xs font-medium text-destructive">
      {message}
    </p>
  );
}

function Line({ term, value, dataKey, cents }: { term: string; value: string; dataKey: string; cents: number }) {
  return (
    <div className="flex items-baseline justify-between gap-4" data-checkout-line={dataKey} data-cents={cents}>
      <dt className="opacity-80">{term}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
