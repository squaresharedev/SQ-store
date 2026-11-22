"use client";

import { useId, useRef, useState } from "react";
import { ImagePlus, Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { unexpectedError } from "@/lib/errors";
import { ELEMENT_CONTENT_TYPES } from "@/lib/validation/product";
import { UploadError, uploadToR2 } from "@/lib/products/upload";
import { sampleObjectKey } from "@/lib/storefront/sample";
import { useSampleMode } from "@/lib/storefront/sample-mode";
import { cn } from "@/lib/utils";
import { useActionErrorToast } from "@/components/ui/ActionErrorNotice";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import {
  fieldBaseClass,
  iconButtonClass,
  infoTextClass,
  secondaryButtonClass,
} from "@/components/ui/control-styles";
import {
  HEADER_LINKS_MAX,
  HEADER_LINK_LABEL_MAX,
  HEADER_LOGO_SIZES,
  IMAGE_ALT_MAX,
  type HeaderLink,
  type HeaderLogo,
  type StorefrontHeader,
} from "@/types/storefront";
import { useLayoutEditor } from "./layout-editor-context";
import { LinkDestinationField } from "./LinkDestinationField";
import { PanelField } from "./PanelField";
import { cssUrl } from "./background-presets";

/** The logo with its alt text and size, the defaults dropped (absent alt =
 *  the store's name, absent size = medium), so a plain logo stores its key. */
function logoOf(key: string, alt: string, size: HeaderLogo["size"]): HeaderLogo {
  const trimmed = alt.trim().slice(0, IMAGE_ALT_MAX);
  return { key, ...(trimmed ? { alt: trimmed } : {}), ...(size && size !== "medium" ? { size } : {}) };
}

/** The header with its logo or menu replaced, the key dropped when empty, so
 *  a header without them is what it was before they existed. */
function withHeader(header: StorefrontHeader, patch: { logo?: HeaderLogo | null; links?: HeaderLink[] }): StorefrontHeader {
  const next: StorefrontHeader = { ...header };
  if (patch.logo !== undefined) {
    if (patch.logo) next.logo = patch.logo;
    else delete next.logo;
  }
  if (patch.links !== undefined) {
    if (patch.links.length > 0) next.links = patch.links;
    else delete next.links;
  }
  return next;
}

/**
 * THE HEADER'S LOGO AND MENU, behind one "Logo and menu" disclosure in the
 * Header group (nothing new shows until it is opened).
 *
 * The logo is uploaded exactly as an image block's artwork is (an `elements/`
 * key, SVG reviewed on upload; the save checks it again), with its words for
 * a screen reader and one of three sizes. The menu is up to four links, each
 * a few words and a destination from the same list a button offers. The cart
 * joins the menu by itself wherever the cart is on, so there is nothing to
 * set for it. On a phone the menu folds behind one button by itself.
 */
export function HeaderLogoMenu({
  header,
  onChange,
}: {
  header: StorefrontHeader;
  onChange: (header: StorefrontHeader) => void;
}) {
  const t = useTranslations("EditorLayout.panel.header");
  const tStorefront = useTranslations("Storefront");
  const editor = useLayoutEditor();
  const sample = useSampleMode();
  const showActionError = useActionErrorToast();
  const id = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<number | null>(0);
  const logo = header.logo;
  const links = header.links ?? [];
  // The words of each entry as typed: an entry keeps its last words while the
  // field is empty, since a menu entry with none is one the schema refuses.
  const [drafts, setDrafts] = useState<string[]>(() => links.map((entry) => entry.label));
  const logoUrl = logo ? editor?.photoUrls[logo.key] : undefined;
  const choices = editor ?? { products: [], bands: [], storefronts: [] };

  async function upload(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setProgress(0);
    try {
      const key = sample ? sampleObjectKey("elements", file) : await uploadToR2(file, "element", setProgress);
      editor?.onPhotoUrl(key, URL.createObjectURL(file));
      onChange(withHeader(header, { logo: logoOf(key, logo?.alt ?? "", logo?.size) }));
    } catch (error) {
      showActionError(
        error instanceof UploadError ? error.info : unexpectedError(error instanceof Error ? error.message : undefined),
      );
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  function setLink(index: number, entry: HeaderLink) {
    onChange(withHeader(header, { links: links.map((current, at) => (at === index ? entry : current)) }));
  }

  function addLink() {
    const first = choices.products[0];
    const link: HeaderLink["link"] = first
      ? { kind: "product", productId: first.id }
      : choices.bands[0]
        ? { kind: "band", bandId: choices.bands[0].id }
        : { kind: "storefront", storefrontId: choices.storefronts[0]?.id ?? "" };
    if (link.kind === "storefront" && !link.storefrontId) return;
    const label = t("newLinkLabel");
    setDrafts((current) => [...current.slice(0, links.length), label]);
    onChange(withHeader(header, { links: [...links, { label, link }] }));
  }

  function removeLink(index: number) {
    setDrafts((current) => current.filter((_, at) => at !== index));
    onChange(withHeader(header, { links: links.filter((_, at) => at !== index) }));
  }

  const busy =
    progress === null
      ? tStorefront("background.processing")
      : tStorefront("background.uploadingPct", { n: Math.round(progress * 100) });

  return (
    <CollapsibleSection title={t("logoAndMenu")} collapsible defaultOpen={false}>
      <div className="space-y-4" data-header-logo-menu="">
        <PanelField label={t("logo")}>
          <input
            ref={fileInput}
            type="file"
            accept={ELEMENT_CONTENT_TYPES.join(",")}
            className="sr-only"
            tabIndex={-1}
            aria-label={t("uploadLogo")}
            onChange={(event) => void upload(event.target.files?.[0])}
            data-header-logo-input=""
          />
          <div className="flex items-center gap-2">
            {logo && (
              <span
                aria-hidden="true"
                className="size-10 shrink-0 rounded-sm border border-border bg-muted bg-contain bg-center bg-no-repeat"
                style={logoUrl ? { backgroundImage: cssUrl(logoUrl) } : undefined}
              />
            )}
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              disabled={uploading}
              className={cn(secondaryButtonClass, "min-w-0 flex-1 justify-center gap-2")}
            >
              <ImagePlus className="size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
              <span className="truncate">{uploading ? busy : logo ? t("replaceLogo") : t("uploadLogo")}</span>
            </button>
            {logo && !uploading && (
              <button
                type="button"
                onClick={() => onChange(withHeader(header, { logo: null }))}
                className={iconButtonClass}
                aria-label={t("removeLogo")}
                title={t("removeLogo")}
              >
                <X className="size-4" strokeWidth={2} aria-hidden="true" />
              </button>
            )}
          </div>
          {uploading && <ProgressBar value={progress} label={tStorefront("background.uploadingProgress")} />}
        </PanelField>

        {logo && (
          <>
            <PanelField label={t("logoAlt")} htmlFor={`${id}-alt`}>
              <input
                id={`${id}-alt`}
                type="text"
                value={logo.alt ?? ""}
                maxLength={IMAGE_ALT_MAX}
                onChange={(event) => onChange(withHeader(header, { logo: logoOf(logo.key, event.target.value, logo.size) }))}
                className={fieldBaseClass}
              />
            </PanelField>
            <PanelField label={t("logoSize")}>
              <SegmentedControl
                value={logo.size ?? "medium"}
                options={HEADER_LOGO_SIZES.map((size) => ({ value: size, label: t(`sizes.${size}`) }))}
                onChange={(size) => onChange(withHeader(header, { logo: logoOf(logo.key, logo.alt ?? "", size) }))}
                ariaLabel={t("logoSize")}
              />
            </PanelField>
          </>
        )}

        <PanelField label={t("menu")}>
          <ul className="space-y-4">
            {links.map((entry, index) => (
              <li key={index} className="space-y-2 border-l-2 border-border pl-3" data-header-link={index}>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    aria-label={t("linkLabel")}
                    value={drafts[index] ?? entry.label}
                    maxLength={HEADER_LINK_LABEL_MAX}
                    onChange={(event) => {
                      const label = event.target.value;
                      setDrafts((current) => links.map((other, at) => (at === index ? label : (current[at] ?? other.label))));
                      if (label.trim()) setLink(index, { ...entry, label });
                    }}
                    className={fieldBaseClass}
                  />
                  <button
                    type="button"
                    onClick={() => removeLink(index)}
                    className={iconButtonClass}
                    aria-label={t("removeLink")}
                    title={t("removeLink")}
                  >
                    <X className="size-4" strokeWidth={2} aria-hidden="true" />
                  </button>
                </div>
                <LinkDestinationField
                  link={entry.link}
                  choices={choices}
                  label={t("linkDestination")}
                  onChange={(link) => setLink(index, { ...entry, link })}
                />
              </li>
            ))}
          </ul>
          {links.length < HEADER_LINKS_MAX ? (
            <button type="button" onClick={addLink} className={cn(secondaryButtonClass, "w-full justify-center gap-2")}>
              <Plus className="size-4" strokeWidth={2} aria-hidden="true" />
              {t("addLink")}
            </button>
          ) : (
            <p className={infoTextClass}>{t("menuFull")}</p>
          )}
        </PanelField>
        <p className={infoTextClass}>{t("cartNote")}</p>
      </div>
    </CollapsibleSection>
  );
}
