"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { useToast } from "@/components/ui/Toast";
import {
  RotateArrowIcon,
  useIconHoverProps,
} from "@/components/ui/action-icons";
import { CopyButton } from "@/components/ui/CopyButton";
import { Modal } from "@/components/ui/modal";
import { Switch } from "@/components/ui/switch";
import { destructiveButtonClass, errorTextClass, fieldBaseClass, helpTextClass, labelClass, primaryButtonClass, secondaryButtonClass } from "@/components/ui/control-styles";
import { invalidInput } from "@/lib/errors";
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

/** Rotation is a separate, destructive flow with its own confirm step, so it
 *  keeps its own state rather than sharing the settings save's. Outcomes of
 *  both are toasts, which is what keeps a failed rotation from ever reading as
 *  a failed settings save. */
type RotateState =
  | { status: "idle" }
  | { status: "confirming" }
  | { status: "rotating" };

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
  const toast = useToast();
  // The rotate buttons drive their own icon: hovering anywhere on the button
  // turns the key.
  const iconHover = useIconHoverProps();
  const [enabled, setEnabled] = useState(false);
  const [domainsText, setDomainsText] = useState("");
  const [saving, setSaving] = useState(false);
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
    setSaving(false);
    setRotateState({ status: "idle" });
  }

  async function handleSave() {
    if (!storefront) return;
    const settings: EmbedSettings = { enabled, domains: parseDomains(domainsText) };
    // Client-side parse for instant feedback; the action re-validates.
    const parsed = embedSettingsSchema.safeParse(settings);
    if (!parsed.success) {
      const problem = invalidInput(
        parsed.error.issues[0]?.message ?? "Invalid embed settings.",
        "Check the domain list (comma-separated hostnames like example.com) and save again.",
      );
      toast.error(problem.message, { lines: [problem.fix] });
      return;
    }
    setSaving(true);
    const result = await updateEmbedSettings(storefront.id, parsed.data);
    setSaving(false);
    if (!result.ok) {
      toast.error(result.error.message, { lines: [result.error.fix] });
      return;
    }
    setDomainsText(parsed.data.domains.join(", "));
    onSaved(storefront.id, parsed.data);
    toast.success("Embed settings saved.");
  }

  async function handleRotate() {
    if (!storefront || rotateState.status === "rotating") return;
    setRotateState({ status: "rotating" });
    const result = await rotateEmbedKey(storefront.id);
    if (!result.ok) {
      setRotateState({ status: "idle" });
      toast.error(result.error.message, { lines: [result.error.fix] });
      return;
    }
    setEmbedKey(result.embedKey);
    setRotateState({ status: "idle" });
    // The old snippet is dead the instant this lands, so the follow-up action
    // travels WITH the confirmation rather than as a line the modal shows once
    // and then loses on close.
    toast.success("New embed key issued.", {
      lines: ["Re-paste the snippet everywhere this storefront is embedded."],
    });
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
            <pre className="overflow-x-auto rounded-none border border-border bg-muted p-3 font-mono text-xs text-foreground">
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
          <div className="space-y-1.5 rounded-none border border-border bg-muted/40 p-3">
            <span className={labelClass}>Snippet key</span>
            {rotateState.status === "confirming" ? (
              <>
                <p className={helpTextClass}>
                  Rotating issues a new key. Every copy of the old snippet stops
                  working immediately, including ones on sites you still want —
                  you&apos;ll need to paste the new snippet everywhere.
                </p>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <motion.button
                    type="button"
                    onClick={handleRotate}
                    className={`${destructiveButtonClass} px-3 py-1.5 text-xs`}
                    {...iconHover}
                  >
                    <RotateArrowIcon />
                    Rotate key
                  </motion.button>
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
                  <motion.button
                    type="button"
                    onClick={() => setRotateState({ status: "confirming" })}
                    disabled={rotateState.status === "rotating"}
                    className={`${secondaryButtonClass} px-3 py-1.5 text-xs`}
                    {...iconHover}
                  >
                    {/* In flight the ring keeps turning on its own: this button
                        is pointer-events-none while disabled, so the hover
                        story could never carry the waiting state. */}
                    <RotateArrowIcon
                      spinning={rotateState.status === "rotating"}
                    />
                    {rotateState.status === "rotating"
                      ? "Rotating…"
                      : "Rotate key"}
                  </motion.button>
                </div>
              </>
            )}
          </div>

          <div className="flex items-center justify-between gap-3">
            <label htmlFor="embed-enabled" className={labelClass}>
              Embed enabled
            </label>
            <Switch
              id="embed-enabled"
              checked={enabled}
              onCheckedChange={setEnabled}
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
              onChange={(event) => setDomainsText(event.target.value)}
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
              <p role="status" className={errorTextClass}>
                Add at least one domain. While this is empty the storefront
                won&apos;t load anywhere, even though embedding is on.
              </p>
            )}
          </div>

          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className={primaryButtonClass}
            >
              {saving ? "Saving…" : "Save settings"}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
