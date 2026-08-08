"use client";

import * as React from "react";
import { useActionState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { ImageUpIcon } from "@/components/ui/ImageUpIcon";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { FormStatus } from "@/components/settings/FormStatus";
import { ProfilePicCropModal } from "@/components/settings/ProfilePicCropModal";
import { secondaryButtonClass } from "@/components/ui/control-styles";
import { cn } from "@/lib/utils";
import { removeAvatar, uploadAvatar } from "@/lib/settings/avatar";

type State = { error?: string; success?: string };
const INITIAL: State = {};

const MAX_SOURCE_BYTES = 2 * 1024 * 1024; // matches the server's cap
const ACCEPTED = "image/jpeg,image/png,image/webp";

/**
 * Profile-photo control. Picking a file opens the crop modal; saving there
 * produces a 512x512 circular WebP that is POSTed to the server action, which
 * does the real validation (magic bytes, size, rate limit) and the upload.
 *
 * The client-side size check is a courtesy, not a control: the server enforces
 * the same cap on the bytes it actually receives, and the cropped output is far
 * smaller than the source anyway.
 */
export function AvatarUpload({
  avatarUrl,
  name,
}: {
  avatarUrl: string | null;
  name: string;
}) {
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

  // Data URL of a freshly picked file. Null means "crop the current avatar",
  // which is what lets someone re-frame the photo they already uploaded
  // without digging the original out of their filesystem again.
  const [picked, setPicked] = React.useState<string | null>(null);
  const [cropOpen, setCropOpen] = React.useState(false);
  const [clientError, setClientError] = React.useState<string | null>(null);

  const state: State = clientError
    ? { error: clientError }
    : uploadState.error || uploadState.success
      ? uploadState
      : removeState;

  function openPicker() {
    setClientError(null);
    fileRef.current?.click();
  }

  function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Clearing the input here, not later, is what makes re-picking the SAME
    // file fire `change` again after a cancelled crop.
    event.target.value = "";
    if (!file) return;

    if (file.size > MAX_SOURCE_BYTES) {
      setClientError("That image is too large. Keep it under 2 MB.");
      return;
    }
    if (!ACCEPTED.split(",").includes(file.type)) {
      setClientError("Use a JPEG, PNG, or WebP image.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setClientError(null);
      setPicked(reader.result as string);
      setCropOpen(true);
    };
    reader.onerror = () => setClientError("Could not read that file.");
    reader.readAsDataURL(file);
  }

  function handleAvatarClick() {
    // An existing photo is worth re-cropping; a blank one has nothing to crop.
    if (picked || avatarUrl) {
      setClientError(null);
      setCropOpen(true);
    } else {
      openPicker();
    }
  }

  function handleCropSave(file: File) {
    setCropOpen(false);
    setPicked(null);
    const formData = new FormData();
    formData.append("avatar", file);
    // Dispatched straight to the action rather than through a <form>: the file
    // being uploaded is one this component made, not one the input holds.
    // The transition is not optional here: a bare call leaves `uploading`
    // stuck at false, and that flag is what draws the ring around the avatar.
    React.startTransition(() => uploadAction(formData));
  }

  const cropSrc = picked ?? avatarUrl;

  return (
    <SettingsCard
      title="Profile photo"
      description="A JPEG, PNG, or WebP up to 2 MB. Shown across your dashboard."
    >
      <div className="flex items-center gap-4">
        {/* The photo itself is what is changing, so the progress lives on it:
            a ring tracing the avatar rather than a spinner buried in a button
            three elements away. -inset-1.5 leaves a hairline of background
            between the ring and the image so the two do not read as one blob. */}
        <div className="relative shrink-0">
          {/* size-16 + flex, not a bare `block`: Avatar is an inline-flex span,
              so an auto-height button picks up the line box's descender gap and
              ends up 64x69. rounded-full on that is an ellipse, which is what
              the hover state was tracing. Pinning the button to the avatar's
              own box makes the inset-0 overlay a true circle. */}
          <button
            type="button"
            onClick={handleAvatarClick}
            disabled={busy}
            suppressHydrationWarning
            aria-label={
              avatarUrl ? "Edit your profile photo" : "Upload a profile photo"
            }
            className="group/avatar relative flex size-16 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-default"
          >
            <Avatar
              src={avatarUrl}
              name={name}
              className={cn(
                "size-16 text-base transition-opacity duration-base ease-standard motion-reduce:transition-none",
                busy && "opacity-50",
              )}
            />
            {!busy && (
              <span className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-full bg-black/50 opacity-0 transition-opacity duration-base ease-standard group-hover/avatar:opacity-100 group-focus-visible/avatar:opacity-100 motion-reduce:transition-none">
                {/* A pencil, not a camera: this opens an editor for the photo
                    already there. A camera reads as "take/replace a photo",
                    which is what the Change photo button does. */}
                <Pencil className="size-5 text-white" aria-hidden />
              </span>
            )}
          </button>
          {busy && (
            <span
              className="pointer-events-none absolute -inset-1.5 animate-spin rounded-full border-2 border-border border-t-foreground motion-reduce:animate-none"
              aria-hidden
            />
          )}
          <span className="sr-only" role="status">
            {uploading
              ? "Uploading your profile photo"
              : removing
                ? "Removing your profile photo"
                : ""}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            aria-label="Choose profile photo"
            accept={ACCEPTED}
            className="sr-only"
            onChange={handleFile}
            disabled={busy}
          />
          {/* Both buttons here are raw elements rather than <Button>, so they
              need the hydration opt-out that primitive carries: extensions
              stamp attributes like fdprocessedid onto buttons before React
              hydrates, and the mismatch is reported against our markup. */}
          <button
            type="button"
            onClick={openPicker}
            disabled={busy}
            suppressHydrationWarning
            className={secondaryButtonClass}
          >
            {/* No spinner here on purpose: progress is shown as a ring
                around the avatar, and two indicators for one upload is one
                too many. */}
            <ImageUpIcon className="size-4" />
            {avatarUrl ? "Change photo" : "Upload photo"}
          </button>

          {avatarUrl && (
            <form action={removeAction}>
              <button
                type="submit"
                disabled={busy}
                suppressHydrationWarning
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

      {cropSrc && (
        <ProfilePicCropModal
          // Remounting per source drops the previous image's zoom and offsets,
          // which would otherwise be applied to a differently shaped photo.
          key={cropSrc}
          open={cropOpen}
          src={cropSrc}
          onSave={handleCropSave}
          onClose={() => setCropOpen(false)}
          onUploadNew={() => {
            setCropOpen(false);
            openPicker();
          }}
        />
      )}
    </SettingsCard>
  );
}
