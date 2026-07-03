import { Check } from "lucide-react";
import type { SettingsActionState } from "@/lib/settings/actions";

/**
 * Inline result line for settings forms. Errors always show (red alert). The
 * Save button carries the success signal itself, so a plain "saved" line would
 * be redundant — success text only renders when the message is genuinely
 * informative (e.g. "check your inbox"), opted into with `showSuccess`.
 */
export function FormStatus({
  state,
  showSuccess = false,
}: {
  state: SettingsActionState;
  showSuccess?: boolean;
}) {
  if (state.error) {
    return (
      <div aria-live="polite">
        <p role="alert" className="text-sm font-medium text-red-500">
          {state.error}
        </p>
      </div>
    );
  }

  if (showSuccess && state.success) {
    return (
      <div aria-live="polite">
        <p className="flex items-center gap-1.5 text-sm font-medium text-success">
          <Check aria-hidden className="size-4" />
          {state.success}
        </p>
      </div>
    );
  }

  return null;
}
