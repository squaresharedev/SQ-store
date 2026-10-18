"use client";

import { useId, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ChoiceCards } from "@/components/ui/ChoiceCards";
import { CheckboxListPanel } from "@/components/ui/CheckboxListPanel";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { SaveButton } from "@/components/ui/SaveButton";
import { ActionErrorNotice } from "@/components/ui/ActionErrorNotice";
import { useToast } from "@/components/ui/Toast";
import { helpTextClass, quietLinkClass, secondaryButtonClass } from "@/components/ui/control-styles";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { cn } from "@/lib/utils";
import { currencySymbol, formatCents } from "@/lib/format/money";
import {
  fromLocalInstant,
  localTimeZone,
  shiftInstant,
  toISODate,
  toLocalInstant,
} from "@/lib/format/calendar";
import { parseFormPriceCents } from "@/lib/products/price";
import { generateDiscountCode } from "@/lib/discounts/code";
import { priceOfOne } from "@/lib/discounts/pricing";
import { saleHasStarted } from "@/lib/discounts/status";
import { createDiscount, updateDiscount } from "@/lib/discounts/actions";
import { DISCOUNTS_PATH } from "@/lib/discounts/paths";
import { useNow } from "@/lib/hooks/useNow";
import type { ActionError } from "@/lib/errors";
import { CURRENCIES, type Currency } from "@/types/product";
import {
  DISCOUNT_CODE_MAX,
  DISCOUNT_PERCENT_MAX,
  DISCOUNT_PERCENT_MIN,
  DISCOUNT_USAGE_LIMIT_MAX,
  SHARE_CHANNEL_MAX,
  type DiscountKind,
  type DiscountProductChoice,
  type DiscountScope,
  type DiscountValue,
  type DiscountView,
} from "@/types/discount";
import { DiscountExample } from "./DiscountExample";
import { DiscountFormSectionsSkeleton } from "./DiscountsSkeleton";
import { ScheduleField, type ScheduleValue } from "./ScheduleField";
import { useDiscountWording } from "./useDiscountWording";

/** Platform names a seller is likely to share on: proper nouns, the same in
 *  every language. The generic suggestions are translated. */
const PLATFORM_SUGGESTIONS = ["Instagram", "TikTok", "Facebook"] as const;

/** How long a sale or code runs, as one tap. */
const DURATION_PRESETS = [
  { key: "day", by: { days: 1 } },
  { key: "threeDays", by: { days: 3 } },
  { key: "week", by: { days: 7 } },
  { key: "month", by: { months: 1 } },
] as const;

type FormState = {
  kind: DiscountKind;
  code: string;
  shareChannel: string;
  valueType: DiscountValue["type"];
  percent: string;
  amount: string;
  currency: Currency;
  appliesTo: DiscountScope;
  productIds: string[];
  start: ScheduleValue;
  end: ScheduleValue;
  /** Empty for no limit. */
  usageLimit: string;
  /** A code's on/off switch, which lives on its row in the list. The form
   *  sends it back as it found it. */
  enabled: boolean;
};

/** The quiet panel the form speaks in: the summary at its foot, and the note
 *  at the top of a sale that has started. */
const PANEL = "flex flex-col gap-1 border border-border bg-secondary/40 p-4";

/** An instant as the form holds it: the local date and time a picker shows. */
function at(iso: string | null): ScheduleValue {
  const local = iso ? fromLocalInstant(iso) : null;
  return local ? { mode: "at", ...local } : { mode: "open" };
}

function initialState(discount: DiscountView | null, products: readonly DiscountProductChoice[]): FormState {
  if (!discount) {
    // A sale first: the discount most sellers come here to make.
    return {
      kind: "automatic",
      code: "",
      shareChannel: "",
      valueType: "percent",
      percent: "10",
      amount: "",
      currency: products[0]?.currency ?? "EUR",
      appliesTo: "all",
      productIds: [],
      start: { mode: "open" },
      end: { mode: "open" },
      usageLimit: "",
      enabled: true,
    };
  }
  const value = discount.value;
  return {
    kind: discount.kind,
    code: discount.code ?? "",
    shareChannel: discount.shareChannel ?? "",
    valueType: value.type,
    percent: value.type === "percent" ? String(value.percentOff) : "10",
    amount: value.type === "amount" ? (value.amountOffCents / 100).toFixed(2) : "",
    currency: value.type === "amount" ? value.currency : (products[0]?.currency ?? "EUR"),
    appliesTo: discount.appliesTo,
    productIds: discount.productIds,
    start: at(discount.startsAt),
    end: at(discount.endsAt),
    usageLimit: discount.usageLimit !== null ? String(discount.usageLimit) : "",
    enabled: discount.enabled,
  };
}

/** The currencies an amount off can be in: the catalogue's, plus the one a
 *  discount being edited already uses, in CURRENCIES order. A catalogue in
 *  one currency gets one, and so no choice to make. */
function amountCurrencies(products: readonly DiscountProductChoice[], current: Currency): Currency[] {
  const used = new Set<Currency>([current, ...products.map((product) => product.currency)]);
  return CURRENCIES.filter((currency) => used.has(currency));
}

/** The value as typed, or null while it is not one yet. */
function valueOf(state: FormState): DiscountValue | null {
  if (state.valueType === "percent") {
    const percent = Number(state.percent);
    return Number.isInteger(percent) && percent >= DISCOUNT_PERCENT_MIN && percent <= DISCOUNT_PERCENT_MAX
      ? { type: "percent", percentOff: percent }
      : null;
  }
  const amount = parseFormPriceCents(state.amount);
  return amount.ok ? { type: "amount", amountOffCents: amount.cents, currency: state.currency } : null;
}

/**
 * The moment a schedule value names, or null for "now" / "no end". A `stored`
 * moment the seller left alone goes back exactly as it was stored (to the
 * second, in the database's own spelling) rather than as the minute the picker
 * shows, so saving a form cannot move a start or an end nobody touched.
 */
function instantOf(value: ScheduleValue, stored: string | null): string | null {
  if (value.mode !== "at") return null;
  const shown = stored ? fromLocalInstant(stored) : null;
  if (stored && shown?.date === value.date && shown.time === value.time) return stored;
  return toLocalInstant(value.date, value.time);
}

/** What a duration is counted from, asked for at the click: the start, or
 *  this moment when the discount starts now or is already running. */
function runFrom(startIso: string | null): string {
  return startIso && Date.parse(startIso) > Date.now() ? startIso : new Date().toISOString();
}

/** Where "Later" opens: tomorrow morning, never a time that has passed. */
function tomorrowMorning(): ScheduleValue {
  const tomorrow = at(shiftInstant(new Date().toISOString(), { days: 1 }));
  return tomorrow.mode === "at" ? { ...tomorrow, time: "09:00" } : tomorrow;
}

/**
 * THE DISCOUNT FORM: one short page for a sale or a code, top to bottom in
 * the order a seller decides them: what kind (a sale unless they say
 * otherwise), the code (filled in for them, with where it will be shared and
 * an optional limit), how much, on what, when. A live summary at the foot says
 * it back in one sentence and shows what it does to one product
 * (DiscountExample); for a sale it also leads to how sales look on the
 * storefront.
 *
 * Simple first: how much is ONE box with its unit beside it (%, or the
 * catalogue's currency, or currencies), and a sale that has started shows only
 * what can still change, its end.
 *
 * The server decides everything (lib/discounts/actions.ts re-parses the
 * whole input); this form only gathers it. Once a discount has started its
 * start is shown, not offered, and a SALE that has started can only have its
 * end changed, so its other fields are shown too.
 *
 * Every date and time in it is the SELLER'S: their time zone, their clock.
 * The server knows neither (it renders in its own zone), so the fields are
 * drawn once the browser has said what time it is (useNow), over the same
 * placeholder the page loads with, rather than rendered wrong and corrected.
 */
export function DiscountForm(props: DiscountFormProps) {
  const now = useNow();
  return now ? <DiscountFormFields {...props} now={now} /> : <DiscountFormSectionsSkeleton />;
}

type DiscountFormProps = {
  /** The discount being edited, or null for a new one. */
  discount: DiscountView | null;
  products: readonly DiscountProductChoice[];
  /** The storefront designer's Sale chip section, for the seller's most
   *  recent storefront (null without one). */
  chipHref?: string | null;
};

function DiscountFormFields({ discount, products, chipHref = null, now }: DiscountFormProps & { now: Date }) {
  const t = useTranslations("Discounts.form");
  const words = useDiscountWording();
  const locale = useLocale();
  const router = useRouter();
  const toast = useToast();
  const ids = { code: useId(), channel: useId(), value: useId(), limit: useId() };
  const [state, setState] = useState<FormState>(() => initialState(discount, products));
  const [error, setError] = useState<ActionError | null>(null);
  const [saving, startSaving] = useTransition();

  // A discount that has started keeps its start: it is a fact by then, shown
  // rather than offered. (To hold a code back, switch it off.)
  const started = discount !== null && Date.parse(discount.startsAt) <= now.getTime();
  // A started SALE keeps its terms too: they are part of the price history
  // the EU's 30-day rule reads (see 20261004_discounts.sql).
  const locked = discount !== null && saleHasStarted(discount, now);
  const isCode = state.kind === "code";
  const value = valueOf(state);
  const set = (patch: Partial<FormState>) => setState((current) => ({ ...current, ...patch }));
  // The run as it will be sent: null for "starts now" and for "no end".
  const startIso = instantOf(state.start, discount?.startsAt ?? null);
  const endIso = instantOf(state.end, discount?.endsAt ?? null);
  const today = toISODate(now);
  const currencies = amountCurrencies(products, state.currency);
  const unit = state.valueType === "percent" ? "percent" : state.currency;
  // Only worth saying once a date is in play.
  const datePicked = state.start.mode === "at" || state.end.mode === "at";

  function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const input = {
      kind: state.kind,
      // An unfinished value goes as typed, so the server can say exactly what
      // is wrong with it (too small, too big, not whole).
      value:
        value ??
        (state.valueType === "percent"
          ? { type: "percent", percentOff: Number(state.percent) }
          : { type: "amount", amountOffCents: 0, currency: state.currency }),
      appliesTo: state.appliesTo,
      productIds: state.appliesTo === "products" ? state.productIds : [],
      startsAt: startIso,
      endsAt: endIso,
      ...(isCode
        ? {
            code: state.code,
            shareChannel: state.shareChannel,
            usageLimit: state.usageLimit.trim() === "" ? null : Number(state.usageLimit),
            enabled: state.enabled,
          }
        : {}),
    };
    startSaving(async () => {
      const result = discount ? await updateDiscount(discount.id, input) : await createDiscount(input);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success(discount ? t("saved") : t("created"));
      router.push(DISCOUNTS_PATH);
    });
  }

  // THE SUMMARY: what the discount does, on what, and one worked example.
  const sample = products.find((product) => state.productIds.includes(product.id)) ?? products[0];
  const example =
    value && sample ? priceOfOne(state.kind, value, sample.priceCents, sample.currency) : null;

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-6" data-discount-form="">
      {/* Asked once, when the discount is made. A sale cannot turn into a
          code or back (the two keep different histories, see the migration's
          EU price rule), so an edit says which it is in its heading instead
          (DiscountFormView). */}
      {!discount && (
        <SettingsCard title={t("kind.title")}>
          <ChoiceCards
            name="discount-kind"
            legend={<span className="sr-only">{t("kind.title")}</span>}
            value={state.kind}
            // A code arrives filled in; the seller can type their own over it.
            onChange={(kind) => set(kind === "code" && !state.code ? { kind, code: generateDiscountCode() } : { kind })}
            optionDataAttribute="data-discount-kind-option"
            options={[
              { value: "automatic", label: t("kind.automatic"), hint: t("kind.automaticHint") },
              { value: "code", label: t("kind.code"), hint: t("kind.codeHint") },
            ]}
          />
        </SettingsCard>
      )}

      {/* What can still change, said before anything else on the page. */}
      {locked && (
        <p className={cn(PANEL, "text-sm text-foreground")} data-discount-locked="">
          {t("locked")}
        </p>
      )}

      {isCode && (
        <SettingsCard title={t("code.title")} description={t("code.description")}>
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-1.5">
              <div className="flex gap-2">
                <Input
                  id={ids.code}
                  aria-label={t("code.label")}
                  value={state.code}
                  onChange={(event) => set({ code: event.target.value.toUpperCase() })}
                  maxLength={DISCOUNT_CODE_MAX}
                  autoCapitalize="characters"
                  autoComplete="off"
                  spellCheck={false}
                  className="font-mono uppercase"
                />
                <button
                  type="button"
                  className={cn(secondaryButtonClass, "shrink-0")}
                  onClick={() => set({ code: generateDiscountCode() })}
                >
                  {t("code.generate")}
                </button>
              </div>
              <p className={helpTextClass}>{t("code.hint")}</p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={ids.channel}>{t("channel.label")}</Label>
              <Input
                id={ids.channel}
                value={state.shareChannel}
                onChange={(event) => set({ shareChannel: event.target.value })}
                maxLength={SHARE_CHANNEL_MAX}
                autoComplete="off"
              />
              <div className="flex flex-wrap gap-2" aria-label={t("channel.suggestions")} role="group">
                {[...PLATFORM_SUGGESTIONS, t("channel.newsletter"), t("channel.creator")].map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    className={cn(secondaryButtonClass, "h-8 px-3 text-xs")}
                    aria-pressed={state.shareChannel === suggestion}
                    onClick={() => set({ shareChannel: suggestion })}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex max-w-48 flex-col gap-1.5">
              <Label htmlFor={ids.limit}>{t("limit.label")}</Label>
              <Input
                id={ids.limit}
                type="number"
                inputMode="numeric"
                min={1}
                max={DISCOUNT_USAGE_LIMIT_MAX}
                step={1}
                placeholder={t("limit.none")}
                value={state.usageLimit}
                onChange={(event) => set({ usageLimit: event.target.value })}
              />
            </div>
          </div>
        </SettingsCard>
      )}

      {!locked && (
        <SettingsCard title={t("value.title")} description={isCode ? t("value.order") : t("value.each")}>
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-stretch gap-3">
              {state.valueType === "percent" ? (
                <Input
                  key="percent"
                  id={ids.value}
                  aria-label={t("value.percentLabel")}
                  type="number"
                  inputMode="numeric"
                  min={DISCOUNT_PERCENT_MIN}
                  max={DISCOUNT_PERCENT_MAX}
                  step={1}
                  value={state.percent}
                  onChange={(event) => set({ percent: event.target.value })}
                  className="w-28"
                />
              ) : (
                <Input
                  key="amount"
                  id={ids.value}
                  aria-label={t("value.amountLabel")}
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0.00"
                  value={state.amount}
                  onChange={(event) => set({ amount: event.target.value })}
                  className="w-28"
                />
              )}
              {/* The unit IS the choice between a percentage and an amount,
                  and, for an amount, its currency. */}
              <SegmentedControl
                ariaLabel={t("value.unit")}
                value={unit}
                options={[
                  { value: "percent", label: "%" },
                  ...currencies.map((currency) => ({ value: currency, label: currencySymbol(currency, locale) })),
                ]}
                onChange={(next) =>
                  set(next === "percent" ? { valueType: "percent" } : { valueType: "amount", currency: next })
                }
              />
            </div>
            {state.valueType === "amount" && currencies.length > 1 && (
              <p className={helpTextClass}>{t("value.currencyHint")}</p>
            )}
          </div>
        </SettingsCard>
      )}

      {!locked && (
      <SettingsCard title={t("products.title")}>
        <div className="flex flex-col gap-4">
          <SegmentedControl
            ariaLabel={t("products.title")}
            value={state.appliesTo}
            options={[
              { value: "all", label: t("products.all") },
              { value: "products", label: t("products.some") },
            ]}
            onChange={(appliesTo) => set({ appliesTo })}
          />
          {state.appliesTo === "products" && (
            <CheckboxListPanel
              items={products.map((product) => ({
                value: product.id,
                label: product.title,
                hint: formatCents(product.priceCents, product.currency, locale),
              }))}
              value={state.productIds}
              onChange={(productIds) => set({ productIds })}
              summaryLabel={t("products.summary", { count: state.productIds.length })}
              filter={{ label: t("products.search") }}
              emptyLabel={t("products.none")}
            />
          )}
        </div>
      </SettingsCard>
      )}

      <SettingsCard
        title={t("schedule.title")}
        description={datePicked ? t("schedule.timeZone", { zone: localTimeZone() }) : undefined}
      >
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-foreground">{t("schedule.starts")}</span>
            {started && discount ? (
              <p className={helpTextClass}>{t("schedule.started", { date: words.when(discount.startsAt) })}</p>
            ) : (
              <ScheduleField
                label={t("schedule.starts")}
                openLabel={t("schedule.now")}
                atLabel={t("schedule.later")}
                value={state.start}
                onChange={(start) => set({ start })}
                pickDefault={tomorrowMorning}
                minDate={today}
              />
            )}
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-foreground">{t("schedule.ends")}</span>
            <ScheduleField
              label={t("schedule.ends")}
              openLabel={t("schedule.noEnd")}
              atLabel={t("schedule.onDate")}
              value={state.end}
              onChange={(end) => set({ end })}
              // A week's run, the same as the "1 week" button below.
              pickDefault={() => at(shiftInstant(runFrom(startIso), { days: 7 }))}
              // Not before a start that is still to come.
              minDate={state.start.mode === "at" && state.start.date > today ? state.start.date : today}
            />
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t("schedule.runFor")}>
              <span className={helpTextClass}>{t("schedule.runFor")}</span>
              {DURATION_PRESETS.map((preset) => (
                <button
                  key={preset.key}
                  type="button"
                  className={cn(secondaryButtonClass, "h-8 px-3 text-xs")}
                  onClick={() => set({ end: at(shiftInstant(runFrom(startIso), preset.by)) })}
                >
                  {t(`schedule.preset.${preset.key}`)}
                </button>
              ))}
            </div>
          </div>
        </div>
      </SettingsCard>

      <section className={PANEL} aria-label={t("summary.title")} data-discount-summary="">
        <p className="text-sm font-medium text-foreground">
          {[
            isCode && state.code ? state.code : null,
            value ? words.value(state.kind, value) : null,
            words.scope(state.appliesTo, state.productIds.length),
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        <p className={helpTextClass}>
          {[
            startIso
              ? t(Date.parse(startIso) <= now.getTime() ? "schedule.started" : "summary.starts", {
                  date: words.when(startIso),
                })
              : t("summary.startsNow"),
            endIso ? t("summary.ends", { date: words.when(endIso) }) : t("summary.noEnd"),
          ].join(" · ")}
        </p>
        {value && example !== null && sample && example < sample.priceCents && (
          <DiscountExample product={sample} value={value} nowCents={example} />
        )}
        {/* Where a buyer meets a sale first: its chip on the storefront. In a
            new tab, so the form keeps what has been typed. */}
        {!isCode && chipHref && (
          <a href={chipHref} target="_blank" rel="noopener" className={cn(quietLinkClass, "mt-2 self-start")} data-discount-chip-link="">
            {t("summary.chipLink")}
          </a>
        )}
      </section>

      {error && <ActionErrorNotice error={error} />}

      <div className="flex justify-end">
        <SaveButton type="submit" pending={saving} pendingLabel={t("saving")}>
          {discount ? t("save") : t("create")}
        </SaveButton>
      </div>
    </form>
  );
}
