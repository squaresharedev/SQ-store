"use client";

import { useLocale } from "next-intl";
import { Select, type SelectOption } from "@/components/ui/select";
import { useLocaleSwitch } from "@/i18n/LocaleSwitchProvider";
import { LOCALES, LOCALE_NAMES, type Locale } from "@/i18n/locales";

const OPTIONS: readonly SelectOption<Locale>[] = LOCALES.map((code) => ({
  value: code,
  label: LOCALE_NAMES[code],
}));

/**
 * The UI language picker, for surfaces with room for a field (the login page,
 * Settings). The account menu lists languages inline instead.
 *
 * Label it from outside with a `<label htmlFor={id}>`, like every other Select.
 * Switching goes through LocaleSwitchProvider, which shows the language
 * overlay while every Server Component re-renders in the new language.
 */
export function LocaleSelect({
  id,
  align,
  triggerClassName,
}: {
  id: string;
  align?: "left" | "right";
  triggerClassName?: string;
}) {
  const locale = useLocale();
  const { switchLocale, switching } = useLocaleSwitch();

  return (
    <Select
      id={id}
      value={locale}
      options={OPTIONS}
      onChange={switchLocale}
      disabled={switching}
      align={align}
      triggerClassName={triggerClassName}
    />
  );
}
