"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { purchaseUrlSchema } from "@/lib/validation/product";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Select, type SelectOption } from "@/components/ui/select";
import { fieldBaseClass, errorTextClass } from "@/components/ui/control-styles";
import {
  BUTTON_LABEL_MAX,
  BUTTON_LOOKS,
  LINK_URL_MAX,
  type ButtonBlock,
  type LinkTarget,
  type StorefrontBand,
} from "@/types/storefront";
import { BlockActions } from "./BlockActions";
import { PanelField, PanelTextField } from "./PanelField";

/** A storefront a link can lead to: this store's own. */
export type LinkableStorefront = { id: string; name: string };

/** One destination in the "Leads to" list, as the list's value. */
type DestinationValue = `product:${string}` | `band:${string}` | `storefront:${string}` | "url";

function destinationOf(link: LinkTarget): DestinationValue {
  switch (link.kind) {
    case "product":
      return `product:${link.productId}`;
    case "band":
      return `band:${link.bandId}`;
    case "storefront":
      return `storefront:${link.storefrontId}`;
    case "url":
      return "url";
  }
}

/** An address the server will accept: https, a real domain, no credentials,
 *  not too long for the field (the contract's own rule, LinkTarget). */
function acceptedUrl(value: string): boolean {
  return value.length <= LINK_URL_MAX && purchaseUrlSchema.safeParse(value).success;
}

/**
 * A BUTTON'S OWN PANEL: its words, where it leads, and which of the
 * storefront's three button looks it wears. Its colours are the storefront's
 * own button (the product page's), so there are none to choose here.
 *
 * Where it leads is ONE list: the products on this board, its bands, this
 * store's storefronts, or a web address (typed in a field that appears for
 * it, and kept only once it is an address the server will accept).
 */
export function ButtonBlockEditor({
  block,
  products,
  bands,
  storefronts,
  onUpdate,
  onDuplicate,
  onRemove,
}: {
  block: ButtonBlock;
  /** The products on this board, by id, with their names. */
  products: readonly { id: string; title: string }[];
  bands: readonly StorefrontBand[];
  storefronts: readonly LinkableStorefront[];
  onUpdate: (patch: Partial<Pick<ButtonBlock, "label" | "link" | "look">>) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const t = useTranslations("EditorLayout.panel.button");
  const id = useId();
  const link = block.link;
  // The words as typed: kept to the block only while there are some, since a
  // button with none is one the schema refuses (the panel says so instead).
  const [draftLabel, setDraftLabel] = useState(block.label);
  const [draftUrl, setDraftUrl] = useState(link.kind === "url" ? link.url : "");
  const [choosingUrl, setChoosingUrl] = useState(false);
  const urlShown = link.kind === "url" || choosingUrl;

  const options: SelectOption<DestinationValue>[] = [
    ...products.map((product) => ({
      value: `product:${product.id}` as const,
      label: product.title,
      description: t("kind.product"),
    })),
    ...bands.map((band) => ({
      value: `band:${band.id}` as const,
      label: t("bandName", { from: band.y + 1, to: band.y + band.h }),
      description: t("kind.band"),
    })),
    ...storefronts.map((storefront) => ({
      value: `storefront:${storefront.id}` as const,
      label: storefront.name,
      description: t("kind.storefront"),
    })),
    { value: "url" as const, label: t("kind.url") },
  ];

  function choose(value: DestinationValue) {
    if (value === "url") {
      setChoosingUrl(true);
      if (acceptedUrl(draftUrl)) onUpdate({ link: { kind: "url", url: draftUrl } });
      return;
    }
    setChoosingUrl(false);
    const [kind, target] = value.split(/:(.+)/) as [string, string];
    if (kind === "product") onUpdate({ link: { kind: "product", productId: target } });
    else if (kind === "band") onUpdate({ link: { kind: "band", bandId: target } });
    else onUpdate({ link: { kind: "storefront", storefrontId: target } });
  }

  const urlProblem = urlShown && draftUrl.length > 0 && !acceptedUrl(draftUrl) ? t("urlProblem") : null;

  return (
    <div className="space-y-4" data-button-editor={block.id}>
      <PanelTextField
        id={`${id}-label`}
        label={t("label")}
        value={draftLabel}
        max={BUTTON_LABEL_MAX}
        problem={draftLabel.trim() ? null : t("labelProblem")}
        charsLeft={(left) => t("charsLeft", { n: left })}
        onChange={(label) => {
          setDraftLabel(label);
          if (label.trim()) onUpdate({ label });
        }}
      />

      <PanelField label={t("destination")} htmlFor={`${id}-destination`}>
        <Select
          id={`${id}-destination`}
          value={urlShown ? "url" : destinationOf(link)}
          options={options}
          onChange={choose}
        />
        {urlShown && (
          <>
            <input
              id={`${id}-url`}
              type="url"
              inputMode="url"
              aria-label={t("url")}
              placeholder={t("urlPlaceholder")}
              value={draftUrl}
              maxLength={LINK_URL_MAX}
              spellCheck={false}
              aria-invalid={Boolean(urlProblem)}
              onChange={(event) => {
                const next = event.target.value.trim();
                setDraftUrl(next);
                if (acceptedUrl(next)) onUpdate({ link: { kind: "url", url: next } });
              }}
              className={fieldBaseClass}
            />
            {urlProblem && <p className={errorTextClass}>{urlProblem}</p>}
          </>
        )}
      </PanelField>

      <PanelField label={t("look")}>
        <SegmentedControl
          value={block.look ?? "solid"}
          options={BUTTON_LOOKS.map((look) => ({ value: look, label: t(`looks.${look}`) }))}
          onChange={(look) => onUpdate({ look })}
          ariaLabel={t("look")}
        />
      </PanelField>

      <BlockActions onDuplicate={onDuplicate} onRemove={onRemove} />
    </div>
  );
}
