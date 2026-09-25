import { useTranslations } from "next-intl";
import { LocaleSelect } from "@/components/layout/LocaleSelect";
import { Label } from "@/components/ui/label";
import { SettingsCard } from "./SettingsCard";

/** Settings › Account: the account's UI language. */
export function LanguageCard() {
  const t = useTranslations("LocaleSwitcher");
  return (
    <SettingsCard title={t("settingsTitle")} description={t("settingsDescription")}>
      <div className="flex max-w-xs flex-col gap-1.5">
        <Label htmlFor="language">{t("label")}</Label>
        <LocaleSelect id="language" />
      </div>
    </SettingsCard>
  );
}
