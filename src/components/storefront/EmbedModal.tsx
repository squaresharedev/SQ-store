"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Switch } from "@/components/ui/switch";
import {
  errorTextClass,
  fieldBaseClass,
  helpTextClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "@/components/ui/control-styles";
import { embedSettingsSchema } from "@/lib/validation/storefront";
import { updateEmbedSettings } from "@/lib/storefront/actions";
import type { StorefrontSummary } from "@/lib/storefront/queries";
import {
  DEFAULT_EMBED_SETTINGS,
  EMBED_MAX_DOMAINS,
  type EmbedSettings,
} from "@/types/storefront";

/** The snippet sellers will paste into their own site. The storefront id is a
 *  server-issued uuid rendered as text — never user-controlled markup. */
function embedSnippet(storefrontId: string): string {
  return [
    `<div data-squareshare-storefront="${storefrontId}"></div>`,
    `<script async src="https://embed.squareshare.to/widget.js"></script>`,
  ].join("\n");
}

/** Comma-separated input → normalized hostname list: trimmed, lowercased,
 *  scheme/path stripped (paste-friendly), deduped. Validation happens after. */
function parseDomains(text: string): string[] {
  const domains = text
    .split(",")
    .map((raw) => {
      let domain = raw.trim().toLowerCase();
      if (domain.startsWith("https://")) domain = domain.slice(8);
      else if (domain.startsWith("http://")) domain = domain.slice(7);
      return domain.split("/")[0] ?? "";
    })
    .filter(Boolean);
  return [...new Set(domains)];
}

type SaveState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "saved" }
  | { status: "error"; message: string };

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
  const [copied, setCopied] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [domainsText, setDomainsText] = useState("");
  const [saveState, setSaveState] = useState<SaveState>({ status: "idle" });

  // Adopt the target storefront's stored settings when the modal (re)opens
  // (render-time adopt, same pattern as StorefrontsList).
  const [prevId, setPrevId] = useState(storefront?.id);
  if (storefront?.id !== prevId) {
    setPrevId(storefront?.id);
    const embed = storefront?.config.embed ?? DEFAULT_EMBED_SETTINGS;
    setEnabled(embed.enabled);
    setDomainsText(embed.domains.join(", "));
    setCopied(false);
    setSaveState({ status: "idle" });
  }

  async function handleCopy() {
    if (!storefront) return;
    try {
      await navigator.clipboard.writeText(embedSnippet(storefront.id));
      setCopied(true);
    } catch {
      // Clipboard can be denied (permissions/insecure context); the seller can
      // still select the snippet text manually.
    }
  }

  async function handleSave() {
    if (!storefront) return;
    const settings: EmbedSettings = { enabled, domains: parseDomains(domainsText) };
    // Client-side parse for instant feedback; the action re-validates.
    const parsed = embedSettingsSchema.safeParse(settings);
    if (!parsed.success) {
      setSaveState({
        status: "error",
        message: parsed.error.issues[0]?.message ?? "Invalid embed settings.",
      });
      return;
    }
    setSaveState({ status: "saving" });
    const result = await updateEmbedSettings(storefront.id, parsed.data);
    if (!result.ok) {
      setSaveState({ status: "error", message: result.error });
      return;
    }
    setDomainsText(parsed.data.domains.join(", "));
    setSaveState({ status: "saved" });
    onSaved(storefront.id, parsed.data);
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
              {embedSnippet(storefront.id)}
            </pre>
            <div className="flex items-center justify-between gap-3">
              <p className={helpTextClass}>
                The embed widget is in development. Your snippet is ready and
                will start rendering the moment it ships.
              </p>
              <button
                type="button"
                onClick={handleCopy}
                className={`${secondaryButtonClass} shrink-0 px-3 py-1.5 text-xs`}
              >
                {copied ? (
                  <Check className="size-3.5" strokeWidth={2} aria-hidden="true" />
                ) : (
                  <Copy className="size-3.5" strokeWidth={2} aria-hidden="true" />
                )}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
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
              Up to {EMBED_MAX_DOMAINS}, comma-separated. Leave empty to allow
              any site.
            </p>
          </div>

          {saveState.status === "error" && (
            <p role="alert" className={errorTextClass}>
              {saveState.message}
            </p>
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
