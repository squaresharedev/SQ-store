import { Button, type ButtonProps } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

/**
 * Submit button for settings forms: the sharp-corner primary CTA with a
 * built-in pending state. Pass `variant="destructive"` for dangerous actions.
 */
export function SaveButton({
  pending,
  pendingLabel = "Saving…",
  children = "Save",
  ...props
}: ButtonProps & { pending: boolean; pendingLabel?: string }) {
  return (
    <Button type="submit" disabled={pending} {...props}>
      {pending ? (
        <>
          <Spinner />
          {pendingLabel}
        </>
      ) : (
        children
      )}
    </Button>
  );
}
