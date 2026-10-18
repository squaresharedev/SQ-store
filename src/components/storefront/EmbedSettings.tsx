"use client";

import { useMemo, useState } from "react";
import { Code2, Globe, KeyRound, Lock, Power, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/Toast";
import { useActionErrorToast } from "@/components/ui/ActionErrorNotice";
import {
  RotateArrowIcon,
  useIconHoverProps,
} from "@/components/ui/action-icons";
import { CopyButton } from "@/components/ui/CopyButton";
import { InfoTip } from "@/components/ui/InfoTip";
import { Switch } from "@/components/ui/switch";
import { badgeClass, cardClass, codeSurfaceClass, iconTileClass } from "@/components/ui/surface-styles";
import { destructiveButtonClass, errorTextClass, fieldBaseClass, helpTextClass, labelClass, primaryButtonClass, secondaryButtonClass } from "@/components/ui/control-styles";
import { invalidInput } from "@/lib/errors";
import { firstIssue } from "@/lib/validation/messages";
import { msg } from "@/i18n/types";
import { embedSettingsSchema } from "@/lib/validation/storefront";
import { normalizeHostname } from "@/lib/validation/inputs";
import { rotateEmbedKey, updateEmbedSettings } from "@/lib/storefront/actions";
import { embedSnippet, isEmbedAvailable } from "@/lib/storefront/embed-snippet";
import { LEGAL_LINKS } from "@/lib/legal/links";
import { SellerDetailsNotice } from "@/components/settings/SellerDetailsNotice";
import type { TraderIdentityField } from "@/lib/settings/trader-identity";
import type { StorefrontSummary } from "@/lib/storefront/queries";
import type { Product } from "@/types/product";
import { EmbedHero } from "./EmbedHero";
import {
  DEFAULT_EMBED_SETTINGS,
  EMBED_MAX_DOMAINS,
  type EmbedSettings as EmbedSettingsValue,
} from "@/types/storefront";

/** Comma-separated input → normalized hostname list, deduped. Normalization is
 *  paste-friendliness only; the shared hostname primitive still decides what is
 *  valid, so nothing here can rescue a bad host into a good one. */
function parseDomains(text: string): string[] {
  const domains = text.split(",").map(normalizeHostname).filter(Boolean);
  return [...new Set(domains)];
}

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
 * Visual editing stays in the designer; this never touches theme or blocks.
 * The route (/storefront/[id]/embed) owns the heading and the back link.
 */
export function EmbedSettings({
  storefront,
  products = [],
  onSaved,
  missingTraderDetails = [],
  productPagesOn = true,
}: {
  storefront: StorefrontSummary;
  /** Feeds the live preview in the hero picture. */
  products?: Product[];
  /** Told after a successful save. */
  onSaved?: (id: string, embed: EmbedSettingsValue) => void;
  /** Trader details this store still owes buyers. Non-empty means the action
   *  will refuse to switch embedding ON (lib/storefront/actions.ts), so the
   *  switch is not offered. Turning it OFF is never blocked, here or there. */
  missingTraderDetails?: readonly TraderIdentityField[];
  /** Whether this storefront's product pages are switched on. The embed's
   *  tiles open them, so without them the frame draws nothing
   *  (lib/storefront/embed-frame-loader.ts) and the snippet is not offered. */
  productPagesOn?: boolean;
}) {
  const t = useTranslations("Storefront.embed");
  const tCommon = useTranslations("Common");
  const toast = useToast();
  const showActionError = useActionErrorToast();
  // The rotate buttons drive their own icon: hovering anywhere on the button
  // turns the key.
  const iconHover = useIconHoverProps();
  const productsById = useMemo(
    () => new Map(products.map((product) => [product.id, product])),
    [products],
  );
  const stored = storefront.config.embed ?? DEFAULT_EMBED_SETTINGS;
  // What the server holds, as opposed to what is in the form: the frame reads
  // the saved settings, so those are what decide whether the snippet works.
  const [saved, setSaved] = useState<EmbedSettingsValue>(stored);
  const [enabled, setEnabled] = useState(stored.enabled);
  const [domainsText, setDomainsText] = useState(stored.domains.join(", "));
  const [saving, setSaving] = useState(false);
  // Held separately from the `storefront` prop so a rotation updates the
  // snippet immediately, without waiting for the route to refetch.
  const [embedKey, setEmbedKey] = useState(storefront.embedKey);
  const [rotateState, setRotateState] = useState<RotateState>({ status: "idle" });

  async function handleSave() {
    const settings: EmbedSettingsValue = { enabled, domains: parseDomains(domainsText) };
    // Client-side parse for instant feedback; the action re-validates.
    const parsed = embedSettingsSchema.safeParse(settings);
    if (!parsed.success) {
      showActionError(
        invalidInput(
          firstIssue(parsed.error, msg("Errors.storefront.invalidEmbedSettings")),
          msg("Errors.storefront.embedSettingsFix"),
        ),
      );
      return;
    }
    setSaving(true);
    const result = await updateEmbedSettings(storefront.id, parsed.data);
    setSaving(false);
    if (!result.ok) {
      showActionError(result.error);
      return;
    }
    setDomainsText(parsed.data.domains.join(", "));
    setSaved(parsed.data);
    onSaved?.(storefront.id, parsed.data);
    toast.success(t("saved"));
  }

  async function handleRotate() {
    if (rotateState.status === "rotating") return;
    setRotateState({ status: "rotating" });
    const result = await rotateEmbedKey(storefront.id);
    if (!result.ok) {
      setRotateState({ status: "idle" });
      showActionError(result.error);
      return;
    }
    setEmbedKey(result.embedKey);
    setRotateState({ status: "idle" });
    // The old snippet is dead the instant this lands, so the follow-up action
    // travels WITH the confirmation rather than as a line shown once and lost.
    toast.success(t("newKeyIssued"), {
      lines: [t("newKeyDetail")],
    });
  }

  // SELL-03: Copy is only meaningful once the embed would actually show:
  // switched on, with a domain, SAVED (the frame reads what the server holds,
  // and "on, a domain typed, never saved" is the easiest way to paste a
  // snippet that shows nothing), on a storefront that may publish and has
  // product pages for its tiles to open. And only once the embed has a host at
  // all (isEmbedAvailable).
  const available = isEmbedAvailable();
  const domains = parseDomains(domainsText);
  // A store that may not publish can neither turn embedding on nor be handed a
  // snippet: the frame the snippet asks for refuses it too.
  const canPublish = missingTraderDetails.length === 0;
  const savedOn = saved.enabled && saved.domains.length > 0;
  const canCopy = available && savedOn && canPublish && productPagesOn;
  // The form says "ready" but the server has not been told yet.
  const unsaved = !savedOn && enabled && domains.length > 0;
  const privacyText = t("privacyText", { policy: LEGAL_LINKS.privacy.href });

  return (
    <div className="space-y-5">
      <EmbedHero
        config={storefront.config}
        productsById={productsById}
        domain={domains[0]}
        live={canCopy}
      />

      {/* SELL-03: in-development notice is the headline, not a footnote. Only
          while the embed has no host to be served from. */}
      {!available && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 font-inter text-xs font-medium text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          {t("inDevNotice")}
        </p>
      )}

      {/* Above the switch it disables, so the reason arrives before the
          dead control rather than after it. */}
      <SellerDetailsNotice
        missing={missingTraderDetails}
        blocks="embedStorefront"
      />

      {/* SELL-03: switches appear ABOVE the snippet so settings
          are visible before the seller decides whether to copy. */}
      <section className={cn(cardClass, "divide-y divide-border")}>
        <div className="flex items-center gap-3 p-4">
          <span className={cn(iconTileClass, "size-9")}>
            <Power className="size-4" strokeWidth={2} aria-hidden="true" />
          </span>
          <label htmlFor="embed-enabled" className={cn(labelClass, "flex-1")}>
            {t("enabledLabel")}
          </label>
          <Switch
            id="embed-enabled"
            checked={enabled}
            // Only the turn-ON is gated. A seller whose details lapsed while
            // embedding was live must still be able to switch it off, so an
            // already-on switch stays operable.
            disabled={!canPublish && !enabled}
            onCheckedChange={setEnabled}
          />
        </div>

        <div className="space-y-2 p-4">
          <div className="flex items-center gap-3">
            <span className={cn(iconTileClass, "size-9")}>
              <Globe className="size-4" strokeWidth={2} aria-hidden="true" />
            </span>
            <label htmlFor="embed-domains" className={labelClass}>
              {t("domainsLabel")}
            </label>
          </div>
          <input
            id="embed-domains"
            type="text"
            value={domainsText}
            onChange={(event) => setDomainsText(event.target.value)}
            placeholder={t("domainsPlaceholder")}
            spellCheck={false}
            className={fieldBaseClass}
          />
          {/* What the field will actually save, so a pasted URL visibly turns
              into the domain it becomes. */}
          {domains.length > 0 && (
            <ul className="flex flex-wrap gap-1.5">
              {domains.map((domain) => (
                <li
                  key={domain}
                  className={cn(badgeClass, "flex items-center gap-1.5")}
                >
                  <Globe className="size-3" strokeWidth={2} aria-hidden="true" />
                  {domain}
                </li>
              ))}
            </ul>
          )}
          <p className={helpTextClass}>
            {t("domainsHint", { max: EMBED_MAX_DOMAINS })}
          </p>
          {/* Deny-by-default: an empty list serves nowhere. Said plainly
              here, because "enabled but blank" otherwise looks like it
              should work and silently does not. */}
          {enabled && domains.length === 0 && (
            <p role="status" className={errorTextClass}>
              {t("emptyDomainsWarning")}
            </p>
          )}
        </div>
      </section>

      {/* Idle until Copy works: the border drains to grey and holds still (see
          .code-surface[data-idle]), and lights up when embedding goes live. */}
      <section className={codeSurfaceClass} data-idle={canCopy ? undefined : ""}>
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2">
          <span className="flex items-center gap-2 font-inter text-xs font-medium text-muted-foreground">
            <Code2 className="size-4" strokeWidth={2} aria-hidden="true" />
            {t("snippetLabel")}
          </span>
          {/* SELL-03: Copy is disabled until both conditions are met. */}
          <CopyButton
            value={embedSnippet(embedKey)}
            messages={{
              copy: "Storefront.embed.copySnippet.copy",
              copied: "Storefront.embed.copySnippet.copied",
              failed: "Storefront.embed.copySnippet.failed",
              cannotCopyYet: "Storefront.embed.copySnippet.cannotCopyYet",
            }}
            variant="labelled"
            disabled={!canCopy}
          />
        </div>
        <pre
          className={cn(
            "overflow-x-auto p-4 font-mono text-xs leading-relaxed transition-opacity duration-base ease-standard motion-reduce:transition-none",
            canCopy ? "opacity-100" : "opacity-50",
          )}
        >
          {embedSnippet(embedKey)}
        </pre>
      </section>
      {/* Not while the embed has no host: "enable embedding and add a domain
          to unlock Copy" would then be a promise the page cannot keep, and the
          notice at the top already says why the snippet is locked. Otherwise
          ONE line: where to paste it, or the one thing still in the way. */}
      {available && (
        <p className={cn(helpTextClass, "flex items-center gap-2")} data-embed-hint="">
          {!canCopy && (
            <Lock className="size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
          )}
          {canCopy
            ? t("snippetReadyHint")
            : !productPagesOn
              ? t("pagesOffHint")
              : unsaved
                ? t("snippetSaveHint")
                : t("snippetLockedHint")}
          {/* For the seller who pasted it and sees nothing: the three causes,
              behind a "?" because most never need them. */}
          {canCopy && <InfoTip label={t("notShowingLabel")}>{t("notShowingTip")}</InfoTip>}
        </p>
      )}

      {/* The seller's own site now loads something from us, and their privacy
          policy should say so. We cannot check that it does, so the words are
          handed over ready to paste. */}
      {available && (
        <section className={cn(cardClass, "flex items-start gap-3 p-4")} data-embed-privacy="">
          <span className={cn(iconTileClass, "size-9")}>
            <ShieldCheck className="size-4" strokeWidth={2} aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1 space-y-2">
            <span className={labelClass}>{t("privacyLabel")}</span>
            <p className={helpTextClass}>{t("privacyHint")}</p>
            <p className={cn(helpTextClass, "rounded-sm border border-border p-3 text-foreground")}>
              {privacyText}
            </p>
            <CopyButton
              value={privacyText}
              variant="labelled"
              messages={{
                copy: "Storefront.embed.copyPrivacy.copy",
                copied: "Storefront.embed.copyPrivacy.copied",
                failed: "Storefront.embed.copyPrivacy.failed",
              }}
            />
          </div>
        </section>
      )}

      {/* Revoke. Its own section, its own confirm, its own errors: this is
          the only control here that breaks working embeds. */}
      <section className={cn(cardClass, "flex items-start gap-3 p-4")}>
        <span className={cn(iconTileClass, "size-9")}>
          <KeyRound className="size-4" strokeWidth={2} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1 space-y-1.5">
          <span className={labelClass}>{t("snippetKeyLabel")}</span>
          {rotateState.status === "confirming" ? (
            <>
              <p className={helpTextClass}>{t("rotateConfirmText")}</p>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <motion.button
                  type="button"
                  onClick={handleRotate}
                  className={`${destructiveButtonClass} px-3 py-1.5 text-xs`}
                  {...iconHover}
                >
                  <RotateArrowIcon />
                  {t("rotateKey")}
                </motion.button>
                <button
                  type="button"
                  onClick={() => setRotateState({ status: "idle" })}
                  className={`${secondaryButtonClass} px-3 py-1.5 text-xs`}
                >
                  {tCommon("actions.cancel")}
                </button>
              </div>
            </>
          ) : (
            <>
              <p className={helpTextClass}>{t("revokeHint")}</p>
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
                    ? t("rotating")
                    : t("rotateKey")}
                </motion.button>
              </div>
            </>
          )}
        </div>
      </section>

      <div className="flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className={primaryButtonClass}
        >
          {saving ? t("saving") : t("saveSettings")}
        </button>
      </div>
    </div>
  );
}
