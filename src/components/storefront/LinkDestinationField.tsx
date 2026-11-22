"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { purchaseUrlSchema } from "@/lib/validation/product";
import { Select, type SelectOption } from "@/components/ui/select";
import { errorTextClass, fieldBaseClass } from "@/components/ui/control-styles";
import { LINK_URL_MAX, type LinkTarget, type StorefrontBand } from "@/types/storefront";
import { PanelField } from "./PanelField";

/** A storefront a link can lead to: this store's own. */
export type LinkableStorefront = { id: string; name: string };

/** Everything a link on this board may lead to, as the designer knows it. */
export type LinkChoices = {
  /** The products on this board, with their names. */
  products: readonly { id: string; title: string }[];
  bands: readonly StorefrontBand[];
  storefronts: readonly LinkableStorefront[];
};

/** One destination in the list, as the list's value. */
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
export function acceptedUrl(value: string): boolean {
  return value.length <= LINK_URL_MAX && purchaseUrlSchema.safeParse(value).success;
}

/**
 * WHERE A LINK LEADS, as one list: the products on this board, its bands, this
 * store's storefronts, or a web address (typed in a field that appears for it,
 * and handed on only once it is an address the server will accept). Shared by
 * a button's panel and the header's menu, so the two offer the same places.
 */
export function LinkDestinationField({
  link,
  choices,
  onChange,
  label,
}: {
  link: LinkTarget;
  choices: LinkChoices;
  onChange: (link: LinkTarget) => void;
  /** The field's caption. Absent = "Leads to". */
  label?: string;
}) {
  const t = useTranslations("EditorLayout.panel.button");
  const id = useId();
  const [draftUrl, setDraftUrl] = useState(link.kind === "url" ? link.url : "");
  const [choosingUrl, setChoosingUrl] = useState(false);
  const urlShown = link.kind === "url" || choosingUrl;

  const options: SelectOption<DestinationValue>[] = [
    ...choices.products.map((product) => ({
      value: `product:${product.id}` as const,
      label: product.title,
      description: t("kind.product"),
    })),
    ...choices.bands.map((band) => ({
      value: `band:${band.id}` as const,
      label: t("bandName", { from: band.y + 1, to: band.y + band.h }),
      description: t("kind.band"),
    })),
    ...choices.storefronts.map((storefront) => ({
      value: `storefront:${storefront.id}` as const,
      label: storefront.name,
      description: t("kind.storefront"),
    })),
    { value: "url" as const, label: t("kind.url") },
  ];

  function choose(value: DestinationValue) {
    if (value === "url") {
      setChoosingUrl(true);
      if (acceptedUrl(draftUrl)) onChange({ kind: "url", url: draftUrl });
      return;
    }
    setChoosingUrl(false);
    const [kind, target] = value.split(/:(.+)/) as [string, string];
    if (kind === "product") onChange({ kind: "product", productId: target });
    else if (kind === "band") onChange({ kind: "band", bandId: target });
    else onChange({ kind: "storefront", storefrontId: target });
  }

  const urlProblem = urlShown && draftUrl.length > 0 && !acceptedUrl(draftUrl) ? t("urlProblem") : null;

  return (
    <PanelField label={label ?? t("destination")} htmlFor={`${id}-destination`}>
      <Select id={`${id}-destination`} value={urlShown ? "url" : destinationOf(link)} options={options} onChange={choose} />
      {urlShown && (
        <>
          <input
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
              if (acceptedUrl(next)) onChange({ kind: "url", url: next });
            }}
            className={fieldBaseClass}
          />
          {urlProblem && <p className={errorTextClass}>{urlProblem}</p>}
        </>
      )}
    </PanelField>
  );
}
