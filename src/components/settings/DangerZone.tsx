import { useTranslations } from "next-intl";
import { DeleteAccountForm } from "@/components/settings/DeleteAccountForm";
import { ExportDataButton } from "@/components/settings/ExportDataButton";
import { SettingsCard } from "@/components/settings/SettingsCard";

/**
 * Danger zone: GDPR data export and account deletion. Export is a plain GET
 * to an owner-scoped route handler so the browser downloads the file
 * directly (after a two-factor code, for an account with 2FA on).
 */
export function DangerZone({
  deletionRequestedAt,
}: {
  deletionRequestedAt: string | null;
}) {
  const t = useTranslations("Settings.danger.export");
  return (
    // The ids are universal search's landing points (/settings/danger#export,
    // #delete), so "download my data" goes straight to the right card.
    <div className="flex flex-col gap-6">
      <SettingsCard
        id="export"
        title={t("cardTitle")}
        description={t("cardDescription")}
      >
        <ExportDataButton />
      </SettingsCard>

      <div id="delete" className="scroll-mt-20">
        <DeleteAccountForm deletionRequestedAt={deletionRequestedAt} />
      </div>
    </div>
  );
}
