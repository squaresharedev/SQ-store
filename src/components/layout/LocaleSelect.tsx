"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { Select, type SelectOption } from "@/components/ui/select";
import { setLocale } from "@/i18n/actions";
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
 * Switching writes the cookie server-side, then refreshes so every Server
 * Component re-renders in the new language.
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
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function choose(next: Locale) {
    if (next === locale) return;
    startTransition(async () => {
      const result = await setLocale(next);
      if (result.ok) router.refresh();
    });
  }

  return (
    <Select
      id={id}
      value={locale}
      options={OPTIONS}
      onChange={choose}
      disabled={pending}
      align={align}
      triggerClassName={triggerClassName}
    />
  );
}
