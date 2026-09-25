import { useTranslations } from "next-intl";
import { Spinner } from "@/components/ui/spinner";

/** Section-switch loading state inside the settings shell. */
export default function SettingsLoading() {
  const t = useTranslations("Settings");
  return (
    <div className="flex min-h-64 items-center justify-center text-muted-foreground">
      <Spinner className="size-5" />
      <span className="sr-only">{t("loading")}</span>
    </div>
  );
}
