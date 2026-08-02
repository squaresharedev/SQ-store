"use client";

import { useState } from "react";
import { ActionErrorNotice } from "@/components/ui/ActionErrorNotice";
import { CopyButton } from "@/components/ui/CopyButton";
import { Modal } from "@/components/ui/modal";
import { Switch } from "@/components/ui/switch";
import {
  destructiveButtonClass,
  fieldBaseClass,
  helpTextClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "@/components/ui/control-styles";
import { invalidInput, type ActionError } from "@/lib/errors";
import { embedSettingsSchema } from "@/lib/validation/storefront";
import { normalizeHostname } from "@/lib/validation/inputs";
import { rotateEmbedKey, updateEmbedSettings } from "@/lib/storefront/actions";
import type { StorefrontSummary } from "@/lib/storefront/queries";
import {
  DEFAULT_EMBED_SETTINGS,
  EMBED_MAX_DOMAINS,
  type EmbedSettings,
} from "@/types/storefront";

/**
 * The snippet sellers paste into their own site.
 *
 * Keyed by the storefront's EMBED KEY, not its row id: this string ends up in
 * someone else's HTML permanently, so it has to be revocable. Rotating the key
 * invalidates every pasted copy without touching the storefront itself.
 *
 * The key is a server-issued uuid rendered as text, never user-controlled markup.
 */
function embedSnippet(embedKey: string): string {
  return [
    `<div data-squareshare-storefront="${embedKey}"></div>`,
    `<script async src="https://embed.squareshare.to/widget.js"></script>`,
  ].join("\n");
}

/** Comma-separated input → normalized hostname list, deduped. Normalization is
 *  paste-friendliness only; the shared hostname primitive still decides what is
 *  valid, so nothing here can rescue a bad host into a good one. */
function parseDomains(text: string): string[] {
  const domains = text.split(",").map(normalizeHostname).filter(Boolean);
  return [...new Set(domains)];
}

/** Sentinel for "no storefront adopted yet". Not null/undefined, because both
 *  are legitimate values of `storefront?.id` when the modal is closed. */
const UNSET = Symbol("unset") as unknown as string;

type SaveState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "saved" }
  | { status: "error"; error: ActionError };

/** Rotation is a separate, destructive flow with its own confirm + errors, so
 *  a failed rotation never reads as a failed settings save. */
type RotateState =
  | { status: "idle" }
  | { status: "confirming" }
  | { status: "rotating" }
  | { status: "rotated" }
  | { status: "error"; error: ActionError };

/**
 * Embed settings for one storefront: the copyable snippet (keyed by the
 * storefront's stable public id), the enable flag, and the origin allowlist —
 * both persisted via updateEmbedSettings (Zod re-validates server-side).
 * Visual editing stays in the designer; this modal never touches theme or
 * blocks.
 */
export function EmbedModal({
  storefront,
  onClose,
  onSaved,
}: {
  /** The storefront being embedded, or null when the modal is closed. */
  storefront: StorefrontSummary | null;
  onClose: () => void;
  /** Mirrors a successful save into the caller's local list state. */
  onSaved: (id: string, embed: EmbedSettings) => void;
}) {
  const [enabled, setEnabled] = useState(false);
  const [domainsText, setDomainsText] = useState("");
  const [saveState, setSaveState] = useState<SaveState>({ status: "idle" });
  // Held separately from the `storefront` prop so a rotation updates the
  // snippet immediately, without waiting for the list to refetch.
  const [embedKey, setEmbedKey] = useState("");
  const [rotateState, setRotateState] = useState<RotateState>({ status: "idle" });

  // Adopt the target storefront's stored settings when the modal (re)opens
  // (render-time adopt, same pattern as StorefrontsList).
  //
  // Seeded with a sentinel no real id can equal, so the FIRST render adopts
  // too. Seeding with `storefront?.id` would make the initial state depend on
  // how the caller mounts this: today the list always mounts it closed
  // (storefront=null) and the id transition does the work, but a caller that
  // mounted it already-open would show the defaults instead of the stored
  // settings — i.e. report embedding as OFF for a storefront where it is ON.
  const [prevId, setPrevId] = useState<string | null | undefined>(UNSET);
  if (storefront?.id !== prevId) {
    setPrevId(storefront?.id);
    const embed = storefront?.config.embed ?? DEFAULT_EMBED_SETTINGS;
    setEnabled(embed.enabled);
    setDomainsText(embed.domains.join(", "));
    setEmbedKey(storefront?.embedKey ?? "");
    setSaveState({ status: "idle" });
    setRotateState({ status: "idle" });
  }

  async function handleSave() {
    if (!storefront) return;
    const settings: EmbedSettings = { enabled, domains: parseDomains(domainsText) };
    // Client-side parse for instant feedback; the action re-validates.
    const parsed = embedSettingsSchema.safeParse(settings);
    if (!parsed.success) {
      setSaveState({
        status: "error",
        error: invalidInput(
          parsed.error.issues[0]?.message ?? "Invalid embed settings.",
          "Check the domain list (comma-separated hostnames like example.com) and save again.",
        ),
      });
      return;
    }
    setSaveState({ status: "saving" });
    const result = await updateEmbedSettings(storefront.id, parsed.data);
    if (!result.ok) {
      setSaveState({ status: "error", error: result.error });
      return;
    }
    setDomainsText(parsed.data.domains.join(", "));
    setSaveState({ status: "saved" });
    onSaved(storefront.id, parsed.data);
  }

  async function handleRotate() {
    if (!storefront || rotateState.status === "rotating") return;
    setRotateState({ status: "rotating" });
    const result = await rotateEmbedKey(storefront.id);
    if (!result.ok) {
      setRotateState({ status: "error", error: result.error });
      return;
    }
    setEmbedKey(result.embedKey);
    setRotateState({ status: "rotated" });
  }

  function markDirty() {
    setSaveState((current) =>
      current.status === "saving" ? current : { status: "idle" },
    );
  }

  return (
    <Modal
      open={storefront !== null}
      onClose={onClose}
      title="Embed this storefront"
      description={
        storefront
          ? `Paste this snippet into any site to show "${storefront.name}" there.`
          : undefined
      }
    >
      {storefront && (
        <div className="space-y-5">
          <div className="space-y-1.5">
            <span className={labelClass}>Snippet</span>
            <pre className="overflow-x-auto rounded-sm border border-border bg-muted p-3 font-mono text-xs text-foreground">
              {embedSnippet(embedKey)}
            </pre>
            <div className="flex items-center justify-between gap-3">
              <p className={helpTextClass}>
                The embed widget is in development. Your snippet is ready and
                will start rendering the moment it ships.
              </p>
              <CopyButton
                value={embedSnippet(embedKey)}
                label="embed snippet"
                variant="labelled"
              />
            </div>
          </div>

          {/* Revoke. Its own section, its own confirm, its own errors: this is
              the only control here that breaks working embeds. */}
          <div className="space-y-1.5 rounded-sm border border-border bg-muted/40 p-3">
            <span className={labelClass}>Snippet key</span>
            {rotateState.status === "confirming" ? (
              <>
                <p className={helpTextClass}>
                  Rotating issues a new key. Every copy of the old snippet stops
                  working immediately, including ones on sites you still want —
                  you&apos;ll need to paste the new snippet everywhere.
                </p>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={handleRotate}
                    className={`${destructiveButtonClass} px-3 py-1.5 text-xs`}
                  >
                    Rotate key
                  </button>
                  <button
                    type="button"
                    onClick={() => setRotateState({ status: "idle" })}
                    className={`${secondaryButtonClass} px-3 py-1.5 text-xs`}
                  >
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className={helpTextClass}>
                  Pasted somewhere it shouldn&apos;t be? Rotate the key to
                  revoke every existing snippet.
                </p>
                <div className="flex flex-wrap items-center gap-3 pt-1">
                  <button
                    type="button"
                    onClick={() => setRotateState({ status: "confirming" })}
                    disabled={rotateState.status === "rotating"}
                    className={`${secondaryButtonClass} px-3 py-1.5 text-xs`}
                  >
                    {rotateState.status === "rotating"
                      ? "Rotating…"
                      : "Rotate key"}
                  </button>
                  {rotateState.status === "rotated" && (
                    <span role="status" className={helpTextClass}>
                      New key issued. Re-paste the snippet above.
                    </span>
                  )}
                </div>
              </>
            )}
            {rotateState.status === "error" && (
              <ActionErrorNotice error={rotateState.error} variant="inline" />
            )}
          </div>

          <div className="flex items-center justify-between gap-3">
            <label htmlFor="embed-enabled" className={labelClass}>
              Embed enabled
            </label>
            <Switch
              id="embed-enabled"
              checked={enabled}
              onCheckedChange={(next) => {
                setEnabled(next);
                markDirty();
              }}
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="embed-domains" className={labelClass}>
              Allowed domains
            </label>
            <input
              id="embed-domains"
              type="text"
              value={domainsText}
              onChange={(event) => {
                setDomainsText(event.target.value);
                markDirty();
              }}
              placeholder="yoursite.com, blog.yoursite.com"
              spellCheck={false}
              className={fieldBaseClass}
            />
            <p className={helpTextClass}>
              Up to {EMBED_MAX_DOMAINS}, comma-separated. Paste a URL and
              we&apos;ll trim it to the domain.
            </p>
            {/* Deny-by-default: an empty list serves nowhere. Said plainly
                here, because "enabled but blank" otherwise looks like it
                should work and silently doesn't. */}
            {enabled && parseDomains(domainsText).length === 0 && (
              <p role="status" className="font-inter text-sm text-destructive">
                Add at least one domain. While this is empty the storefront
                won&apos;t load anywhere, even though embedding is on.
              </p>
            )}
          </div>

          {saveState.status === "error" && (
            <ActionErrorNotice error={saveState.error} variant="inline" />
          )}

          <div className="flex items-center justify-end gap-3">
            {saveState.status === "saved" && (
              <span role="status" className={helpTextClass}>
                Saved.
              </span>
            )}
            <button
              type="button"
              onClick={handleSave}
              disabled={saveState.status === "saving"}
              className={primaryButtonClass}
            >
              {saveState.status === "saving" ? "Saving…" : "Save settings"}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
