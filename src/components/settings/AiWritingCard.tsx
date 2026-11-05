"use client";

import * as React from "react";
import { ArrowUpRight, PenLine, Sparkles, TextCursorInput, type LucideIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import Link from "@/components/ui/AppLink";
import { buttonClassName } from "@/components/ui/button";
import { helpTextClass, iconNudgeRightClass, infoTextClass, labelClass, stubBadgeClass } from "@/components/ui/control-styles";
import { useActionErrorToast } from "@/components/ui/ActionErrorNotice";
import { Meter } from "@/components/ui/Meter";
import { Switch } from "@/components/ui/switch";
import { iconTileClass } from "@/components/ui/surface-styles";
import { SettingsCard } from "@/components/settings/SettingsCard";
import type { AiSettings } from "@/lib/ai-suggestions";
import { hasAiCreditLeft, MICROS_PER_CENT, type AiCredit } from "@/lib/billing/ai-credit";
import { plansHref } from "@/lib/billing/paths";
import { BILLING_CURRENCY, PLANS } from "@/lib/billing/plans";
import { unexpectedError } from "@/lib/errors";
import { formatLongDate } from "@/lib/format/date";
import { formatCents } from "@/lib/format/money";
import { saveSuggestAsYouType } from "@/lib/settings/actions";
import { cn } from "@/lib/utils";

/** What AI writing help does, one line each: the card's upsell, in order. */
const AI_ABILITIES: readonly { key: "asYouType" | "write" | "improve"; icon: LucideIcon }[] = [
  { key: "asYouType", icon: TextCursorInput },
  { key: "write", icon: Sparkles },
  { key: "improve", icon: PenLine },
];

/**
 * Settings › Plan & billing › AI writing help. On Pro: the month's AI credit
 * as a bar with what it says beside it (used of the allowance, and when it
 * renews), and this person's switch for the grey next words. Below Pro: what
 * it does, and the way to the plan that has it. Nothing at all on a
 * deployment without AI (`settings` null).
 */
export function AiWritingCard({ settings }: { settings: AiSettings }) {
  const t = useTranslations("Billing.ai");
  if (!settings) return null;
  return (
    <SettingsCard id="ai" title={t("title")} description={t("description")}>
      {settings.kind === "included" ? (
        <div className="space-y-6">
          <CreditLine credit={settings.credit} />
          <AsYouTypeSwitch initial={settings.suggestAsYouType} />
        </div>
      ) : (
        <AiUpsell />
      )}
    </SettingsCard>
  );
}

function CreditLine({ credit }: { credit: AiCredit | null }) {
  const t = useTranslations("Billing.ai");
  const locale = useLocale();
  if (!credit) return <p className={helpTextClass}>{t("creditUnreadable")}</p>;
  const money = (micros: number) => formatCents(Math.round(micros / MICROS_PER_CENT), BILLING_CURRENCY, locale);
  const renews = formatLongDate(credit.renewsAt, locale);
  const left = hasAiCreditLeft(credit);
  return (
    <div className="space-y-2" data-ai-credit={left ? "left" : "used"}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="font-inter text-sm font-medium text-foreground">
          {t("creditUsed", { used: money(Math.min(credit.used, credit.allowance)), allowance: money(credit.allowance) })}
        </p>
        <p className={infoTextClass}>{t("creditRenews", { date: renews })}</p>
      </div>
      {/* The same calm ink when it is all used: the line under it says so. */}
      <Meter value={credit.allowance > 0 ? credit.used / credit.allowance : 1} />
      <p className={infoTextClass}>{left ? t("creditNote") : t("creditSpent", { date: renews })}</p>
    </div>
  );
}

function AsYouTypeSwitch({ initial }: { initial: boolean }) {
  const t = useTranslations("Billing.ai");
  const showError = useActionErrorToast();
  const [on, setOn] = React.useState(initial);
  const labelId = React.useId();

  async function flip(next: boolean) {
    setOn(next);
    const result = await saveSuggestAsYouType(next).catch(() => ({ error: unexpectedError() }));
    if (result.error) {
      setOn(!next);
      showError(result.error);
    }
  }

  return (
    <div className="flex items-start justify-between gap-6 border-t border-border pt-5">
      <div>
        <p id={labelId} className={labelClass}>
          {t("asYouTypeLabel")}
        </p>
        <p className={cn(helpTextClass, "mt-1")}>{t("asYouTypeHelp")}</p>
      </div>
      <Switch checked={on} onCheckedChange={(next) => void flip(next)} aria-labelledby={labelId} />
    </div>
  );
}

function AiUpsell() {
  const t = useTranslations("Billing.ai");
  const locale = useLocale();
  const credit = formatCents(PLANS.pro.aiCreditCents, BILLING_CURRENCY, locale, { wholeUnits: true });
  return (
    <div className="space-y-5" data-ai-upsell="">
      <ul className="space-y-2.5">
        {AI_ABILITIES.map(({ key, icon: Icon }) => (
          <li key={key} className="flex items-start gap-2.5 font-inter text-sm text-foreground">
            <span className={cn(iconTileClass, "size-6")}>
              <Icon className="size-3.5" strokeWidth={2} aria-hidden />
            </span>
            <span className="pt-0.5">{t(`abilities.${key}`)}</span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        <Link href={plansHref("ai_writing")} className={cn(buttonClassName("secondary"), "group/btn")}>
          {t("upsellCta")}
          <ArrowUpRight className={cn("size-4", iconNudgeRightClass)} strokeWidth={2} aria-hidden />
        </Link>
        <span className={cn(stubBadgeClass, "ml-0 normal-case tracking-normal")}>{t("upsellCredit", { credit })}</span>
      </div>
    </div>
  );
}
