"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Globe, KeyRound, Lock, ShieldCheck } from "lucide-react";
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
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  badgeClass,
  cardClass,
  codeSurfaceClass,
  codeSurfaceDangerClass,
  codeTextClass,
  iconTileClass,
  inkBadgeClass,
  sectionTitleClass,
  stepNumberClass,
  withPictureClass,
} from "@/components/ui/surface-styles";
import {
  cautionNoticeClass,
  chipButtonClass,
  destructiveButtonClass,
  errorTextClass,
  fieldBaseClass,
  helpTextClass,
  labelClass,
  primaryButtonClass,
} from "@/components/ui/control-styles";
import { invalidInput } from "@/lib/errors";
import { firstIssue } from "@/lib/validation/messages";
import { msg } from "@/i18n/types";
import { embedSettingsSchema } from "@/lib/validation/storefront";
import { normalizeHostname } from "@/lib/validation/inputs";
import { rotateEmbedKey, updateEmbedSettings } from "@/lib/storefront/actions";
import { EMBED_BUILDERS, type EmbedBuilderId } from "@/lib/storefront/embed-builders";
import {
  EMBED_IFRAME_HEIGHT,
  embedFrameSites,
  embedFrameSnippet,
  embedSnippet,
  isEmbedAvailable,
} from "@/lib/storefront/embed-snippet";
import { LEGAL_LINKS } from "@/lib/legal/links";
import { SellerDetailsNotice } from "@/components/settings/SellerDetailsNotice";
import type { TraderIdentityField } from "@/lib/settings/trader-identity";
import type { StorefrontSummary } from "@/lib/storefront/queries";
import type { Product } from "@/types/product";
import { EmbedHero } from "./EmbedHero";
import { EmbedPrivacyPicture } from "./EmbedPrivacyPicture";
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
 * Which snippet is shown: the loader (fits its frame to the board, follows
 * domain changes) or a plain iframe, for a site that removes script tags.
 */
type SnippetKind = "script" | "iframe";

/**
 * Embed settings for one storefront: the copyable snippet (keyed by the
 * storefront's stable public id), the enable flag, and the origin allowlist —
 * both persisted via updateEmbedSettings (Zod re-validates server-side).
 * Visual editing stays in the designer; this never touches theme or blocks.
 * The route (/storefront/[id]/embed) owns the heading and the back link.
 */
/**
 * One numbered step of putting the storefront on a website: what to do, and
 * beside it (from `md` up) the picture of what that does. Numbered, so a seller
 * reads the three as one job, the privacy line included, rather than the last
 * card as an optional extra.
 */
function EmbedStep({
  number,
  title,
  badge,
  picture,
  children,
  ...data
}: {
  number: number;
  title: string;
  /** A short marker beside the title ("Required"). */
  badge?: string;
  picture?: ReactNode;
  children: ReactNode;
} & { [key: `data-${string}`]: string }) {
  const headingId = `embed-step-${number}`;
  return (
    <section aria-labelledby={headingId} className={cn(cardClass, "p-5")} {...data}>
      <div className={cn(picture ? withPictureClass : undefined)}>
        <div className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <span aria-hidden="true" className={stepNumberClass}>
              {number}
            </span>
            <h2 id={headingId} className={sectionTitleClass}>
              {title}
            </h2>
            {badge && <span className={inkBadgeClass}>{badge}</span>}
          </div>
          {children}
        </div>
        {picture}
      </div>
    </section>
  );
}

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
  // The switch is in flight: it is saved the moment it is flipped.
  const [toggling, setToggling] = useState(false);
  // Held separately from the `storefront` prop so a rotation updates the
  // snippet immediately, without waiting for the route to refetch.
  const [embedKey, setEmbedKey] = useState(storefront.embedKey);
  const [rotateState, setRotateState] = useState<RotateState>({ status: "idle" });
  const [kind, setKind] = useState<SnippetKind>("script");
  const [builder, setBuilder] = useState<EmbedBuilderId>("other");

  async function handleSave() {
    const submittedText = domainsText;
    const settings: EmbedSettingsValue = { enabled, domains: parseDomains(submittedText) };
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
    // Show the list as it was saved, unless the seller has typed on since:
    // a save landing late must never take back what they wrote meanwhile.
    setDomainsText((current) => (current === submittedText ? parsed.data.domains.join(", ") : current));
    setSaved(parsed.data);
    onSaved?.(storefront.id, parsed.data);
    toast.success(t("saved"));
  }

  /**
   * THE SWITCH SAVES ITSELF, and the snippet follows it at once. The frame
   * reads what the server holds, so a switch that only moved a form field left
   * Copy unlocked for a storefront that was still off (or locked for one that
   * was on). Only the flag is written, over the domains already saved: a
   * half-typed domain list is not published by flipping a switch, that is what
   * Save is for. A refusal puts the switch back where the server has it.
   */
  async function handleToggle(next: boolean) {
    if (toggling) return;
    setEnabled(next);
    setToggling(true);
    const result = await updateEmbedSettings(storefront.id, { enabled: next, domains: saved.domains });
    setToggling(false);
    if (!result.ok) {
      setEnabled(saved.enabled);
      showActionError(result.error);
      return;
    }
    // No toast: the switch's own position is the confirmation, and a second
    // "saved" would read as the domains having been saved too.
    const settings: EmbedSettingsValue = { enabled: next, domains: saved.domains };
    setSaved(settings);
    onSaved?.(storefront.id, settings);
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
  // switched on (the switch itself, which saves as it is flipped), with a
  // domain that is SAVED (the frame reads what the server holds, and "a domain
  // typed, never saved" is the easiest way to paste a snippet that shows
  // nothing), on a storefront that may publish and has product pages for its
  // tiles to open. And only once the embed has a host at all
  // (isEmbedAvailable).
  const available = isEmbedAvailable();
  const domains = parseDomains(domainsText);
  // A store that may not publish can neither turn embedding on nor be handed a
  // snippet: the frame the snippet asks for refuses it too.
  const canPublish = missingTraderDetails.length === 0;
  const hasSavedDomain = saved.domains.length > 0;
  const canCopy = available && enabled && hasSavedDomain && canPublish && productPagesOn;
  // A domain is typed but the server has not been told yet.
  const unsaved = enabled && !hasSavedDomain && domains.length > 0;
  const privacyText = t("privacyText", { policy: LEGAL_LINKS.privacy.href });
  // The iframe names the SAVED sites, as the frame will check them. Before
  // there are any (when it cannot be copied) it shows the typed ones, then the
  // placeholder's, so its picture is never an address with nothing at the end.
  const iframeDomains =
    [saved.domains, domains].find((list) => list.length > 0) ?? parseDomains(t("domainsPlaceholder"));
  const snippet =
    kind === "script" ? embedSnippet(embedKey) : embedFrameSnippet(embedKey, embedFrameSites(iframeDomains));

  return (
    <div className="space-y-6">
      {/* SELL-03: in-development notice is the headline, not a footnote. Only
          while the embed has no host to be served from. */}
      {!available && <p className={cautionNoticeClass}>{t("inDevNotice")}</p>}

      {/* Above the switch it disables, so the reason arrives before the
          dead control rather than after it. */}
      <SellerDetailsNotice missing={missingTraderDetails} blocks="embedStorefront" />

      {/* 1. WHERE. The switch and the domains, beside the picture they drive. */}
      <EmbedStep
        number={1}
        title={t("steps.site")}
        picture={
          <EmbedHero config={storefront.config} productsById={productsById} domain={domains[0]} live={canCopy} />
        }
      >
        <div className="flex items-center justify-between gap-3">
          <label htmlFor="embed-enabled" className={labelClass}>
            {t("enabledLabel")}
          </label>
          <Switch
            id="embed-enabled"
            checked={enabled}
            // Only the turn-ON is gated. A seller whose details lapsed while
            // embedding was live must still be able to switch it off, so an
            // already-on switch stays operable.
            disabled={(!canPublish && !enabled) || toggling}
            onCheckedChange={handleToggle}
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="embed-domains" className={labelClass}>
            {t("domainsLabel")}
          </label>
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
                <li key={domain} className={cn(badgeClass, "flex items-center gap-1.5")}>
                  <Globe className="size-3" strokeWidth={2} aria-hidden="true" />
                  {domain}
                </li>
              ))}
            </ul>
          )}
          <p className={helpTextClass}>{t("domainsHint", { max: EMBED_MAX_DOMAINS })}</p>
          {/* Deny-by-default: an empty list serves nowhere. Said plainly
              here, because "enabled but blank" otherwise looks like it
              should work and silently does not. */}
          {enabled && domains.length === 0 && (
            <p role="status" className={errorTextClass}>
              {t("emptyDomainsWarning")}
            </p>
          )}
        </div>

        {/* Saves the domains; the switch above saves itself. */}
        <button type="button" onClick={handleSave} disabled={saving} className={primaryButtonClass}>
          {saving ? t("saving") : t("saveSettings")}
        </button>
      </EmbedStep>

      {/* 2. WHAT TO PASTE. The code is the picture. */}
      <EmbedStep number={2} title={t("steps.snippet")}>
        {/* WHERE IT GOES, for the builder the seller uses: one line, chosen
            rather than listed, so the seller reads their own and no other. */}
        <div className="space-y-2" data-embed-builder="">
          <label htmlFor="embed-builder" className={labelClass}>
            {t("builderLabel")}
          </label>
          <Select
            id="embed-builder"
            value={builder}
            onChange={setBuilder}
            options={EMBED_BUILDERS.map((option) => ({
              value: option.id,
              label: "name" in option ? option.name : t("builderOther"),
            }))}
            triggerClassName="sm:max-w-xs"
          />
          <p className={helpTextClass} data-embed-builder-step="">
            {t(`builderSteps.${builder}`)}
          </p>
        </div>

        {/* Idle until Copy works: the border drains to grey and holds still
            (see .code-surface[data-idle]), and lights up when the embed would
            show. */}
        <div className={codeSurfaceClass} data-idle={canCopy ? undefined : ""}>
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2">
            {/* The two snippets, as tabs on the code they switch. */}
            <SegmentedControl
              ariaLabel={t("snippetKinds.label")}
              value={kind}
              onChange={setKind}
              options={[
                { value: "script", label: t("snippetKinds.script") },
                { value: "iframe", label: t("snippetKinds.iframe") },
              ]}
            />
            <CopyButton
              value={snippet}
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
              codeTextClass,
              "p-4 transition-opacity duration-base ease-standard motion-reduce:transition-none",
              canCopy ? "opacity-100" : "opacity-50",
            )}
          >
            {snippet}
          </pre>
        </div>
        {/* Not while the embed has no host: "enable embedding and add a domain
            to unlock Copy" would then be a promise the page cannot keep, and
            the notice at the top already says why the snippet is locked.
            Otherwise ONE line: what this snippet does, or the one thing in
            the way. */}
        {available && (
          <p className={cn(helpTextClass, "flex items-center gap-2")} data-embed-hint="">
            {!canCopy && <Lock className="size-4 shrink-0" strokeWidth={2} aria-hidden="true" />}
            {canCopy
              ? kind === "iframe"
                ? t("iframeHint", { height: EMBED_IFRAME_HEIGHT })
                : t("snippetReadyHint")
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
      </EmbedStep>

      {/* 3. THE PRIVACY LINE. A step like the other two, marked Required and
          drawn going into the seller's own policy, because it is the step
          that is easiest to skip: their site now loads something from us,
          and we cannot check that their policy says so. */}
      {available && (
        <EmbedStep
          number={3}
          title={t("steps.privacy")}
          badge={t("required")}
          picture={<EmbedPrivacyPicture domain={saved.domains[0]} />}
          data-embed-privacy=""
        >
          <p className={helpTextClass}>{t("privacyHint")}</p>
          <div className={codeSurfaceDangerClass}>
            <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2">
              <span className="flex items-center gap-2 font-inter text-xs font-medium text-muted-foreground">
                <ShieldCheck className="size-4" strokeWidth={2} aria-hidden="true" />
                {t("privacyTextLabel")}
              </span>
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
            <p className="p-4 font-inter text-sm leading-relaxed">{privacyText}</p>
          </div>
        </EmbedStep>
      )}

      {/* Revoke. Its own section, its own confirm, its own errors: this is
          the only control here that breaks working embeds. Not a step: most
          sellers never need it. */}
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
                  className={cn(destructiveButtonClass, "px-3 py-1.5 text-xs")}
                  {...iconHover}
                >
                  <RotateArrowIcon />
                  {t("rotateKey")}
                </motion.button>
                <button
                  type="button"
                  onClick={() => setRotateState({ status: "idle" })}
                  className={chipButtonClass}
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
                  className={chipButtonClass}
                  {...iconHover}
                >
                  {/* In flight the ring keeps turning on its own: this button
                      is pointer-events-none while disabled, so the hover
                      story could never carry the waiting state. */}
                  <RotateArrowIcon spinning={rotateState.status === "rotating"} />
                  {rotateState.status === "rotating" ? t("rotating") : t("rotateKey")}
                </motion.button>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
