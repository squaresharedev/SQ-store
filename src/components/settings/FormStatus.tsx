import { Check } from "lucide-react";
import type { SettingsActionState } from "@/lib/settings/actions";

/**
 * Inline result line for settings forms: red alert on error, green check on
 * success. Announced politely to screen readers either way.
 */
export function FormStatus({ state }: { state: SettingsActionState }) {
  if (!state.error && !state.success) return null;
  return (
    <div aria-live="polite">
      {state.error ? (
        <p role="alert" className="text-sm font-medium text-red-500">
          {state.error}
        </p>
      ) : (
        <p className="flex items-center gap-1.5 text-sm font-medium text-success">
          <Check aria-hidden className="size-4" />
          {state.success}
        </p>
      )}
    </div>
  );
}
