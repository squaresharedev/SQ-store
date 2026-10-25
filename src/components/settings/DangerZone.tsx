import { DeleteAccountForm } from "@/components/settings/DeleteAccountForm";
import type { DeletionStatus } from "@/lib/account-deletion/requests";

/**
 * Danger zone: account deletion, and nothing else. The data export that used
 * to share this page lives on Account (it is harmless), so the one control
 * here is the one that deserves the red.
 */
export function DangerZone({
  deletion,
}: {
  /** The account's deletion request and where it stands, or null. */
  deletion: DeletionStatus | null;
}) {
  return (
    // The id is universal search's landing point (/settings/danger#delete).
    <div className="flex flex-col gap-6">
      <div id="delete" className="scroll-mt-20">
        <DeleteAccountForm deletion={deletion} />
      </div>
    </div>
  );
}
