"use client";

import * as React from "react";
import { useActionState } from "react";
import { ImageUp, Loader2, Trash2 } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { FormStatus } from "@/components/settings/FormStatus";
import { secondaryButtonClass } from "@/components/ui/control-styles";
import { cn } from "@/lib/utils";
import { removeAvatar, uploadAvatar } from "@/lib/settings/avatar";

type State = { error?: string; success?: string };
const INITIAL: State = {};

/**
 * Profile-photo control. Picking a file auto-submits to the server action,
 * which does the real validation (magic bytes, size, rate limit) and the
 * upload — the client only offers a preview affordance and shows the result.
 */
export function AvatarUpload({
  avatarUrl,
  name,
}: {
  avatarUrl: string | null;
  name: string;
}) {
  const uploadFormRef = React.useRef<HTMLFormElement>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [uploadState, uploadAction, uploading] = useActionState(
    uploadAvatar,
    INITIAL,
  );
  const [removeState, removeAction, removing] = useActionState(
    removeAvatar,
    INITIAL,
  );
  const busy = uploading || removing;
  const state: State =
    uploadState.error || uploadState.success ? uploadState : removeState;

  return (
    <SettingsCard
      title="Profile photo"
      description="A JPEG, PNG, or WebP up to 2 MB. Shown across your dashboard."
    >
      <div className="flex items-center gap-4">
        <Avatar src={avatarUrl} name={name} className="size-16 text-base" />

        <div className="flex flex-wrap items-center gap-2">
          <form ref={uploadFormRef} action={uploadAction}>
            <input
              ref={fileRef}
              type="file"
              name="avatar"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              onChange={() => uploadFormRef.current?.requestSubmit()}
              disabled={busy}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className={secondaryButtonClass}
            >
              {uploading ? (
                <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
              ) : (
                <ImageUp className="size-4" strokeWidth={2} aria-hidden />
              )}
              {avatarUrl ? "Change photo" : "Upload photo"}
            </button>
          </form>

          {avatarUrl && (
            <form action={removeAction}>
              <button
                type="submit"
                disabled={busy}
                className={cn(
                  "inline-flex items-center gap-2 rounded-none px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50",
                )}
              >
                <Trash2 className="size-4" strokeWidth={2} aria-hidden />
                Remove
              </button>
            </form>
          )}
        </div>
      </div>

      <div className="mt-3">
        <FormStatus state={state} showSuccess />
      </div>
    </SettingsCard>
  );
}
