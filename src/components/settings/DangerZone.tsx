import { Download } from "lucide-react";
import { DeleteAccountForm } from "@/components/settings/DeleteAccountForm";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { buttonClassName } from "@/components/ui/button";

/**
 * Danger zone: GDPR data export and account deletion. Export is a plain GET
 * to an owner-scoped route handler so the browser downloads the file
 * directly.
 */
export function DangerZone({
  deletionRequestedAt,
}: {
  deletionRequestedAt: string | null;
}) {
  return (
    // The ids are universal search's landing points (/settings/danger#export,
    // #delete), so "download my data" goes straight to the right card.
    <div className="flex flex-col gap-6">
      <SettingsCard
        id="export"
        title="Export my data"
        description="Everything we hold about you: profile, products, storefront config, all bundled into one JSON file. It's your data, yours to keep."
      >
        <a
          href="/settings/export"
          download
          className={buttonClassName("secondary")}
        >
          <Download aria-hidden className="size-4" />
          Download my data
        </a>
      </SettingsCard>

      <div id="delete" className="scroll-mt-20">
        <DeleteAccountForm deletionRequestedAt={deletionRequestedAt} />
      </div>
    </div>
  );
}
