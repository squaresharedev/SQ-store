"use client";

import Link from "@/components/ui/AppLink";
import { ArrowUpRight, Link2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { CopyButton } from "@/components/ui/CopyButton";
import { helpTextClass, inlineLinkClass, labelClass } from "@/components/ui/control-styles";
import { cardClass, iconTileClass } from "@/components/ui/surface-styles";
import { buttonClassName } from "@/components/ui/button";
import { storefrontEditorPath } from "@/lib/storefront/paths";
import { INDEXING_SETTING_ID, settingHref } from "@/lib/storefront/setting-ref";
import { traderIdentityHref, type TraderIdentityField } from "@/lib/settings/trader-identity";
import { cn } from "@/lib/utils";

/**
 * THE STOREFRONT'S OWN LINK: where it lives as a page of its own
 * (/s/[storefrontId]), for a seller who has no website to embed it in, or who
 * just wants one address to put in a bio.
 *
 * Says what is true right now. When the page is live it is the link, with Copy
 * and Open. When it is not, it says the one thing that would make it so,
 * rather than hand out an address that answers 404: the page exists exactly
 * when the storefront's product pages are switched on and the seller's trader
 * details are complete (lib/storefront/storefront-page.ts), and the caller
 * works that out on the server and passes the answer in.
 */
export function StorefrontLinkCard({
  storefrontId,
  url,
  state,
  searchable,
  missing = [],
}: {
  storefrontId: string;
  /** The page's absolute address. */
  url: string;
  /** Live, or the first thing in the way, each with the way to fix it: the
   *  page's notice further down frames missing details as an embedding
   *  problem, so the link card carries its own way to Settings. */
  state: "live" | "pages-off" | "details-missing";
  /** Whether search engines may list it (the designer's "Allow search
   *  engines"). Said only when they may not, with the way to the switch. */
  searchable: boolean;
  /** The seller details still owed, so the fix lands on the first of them. */
  missing?: readonly TraderIdentityField[];
}) {
  const t = useTranslations("Storefront.share");
  const tIndexing = useTranslations("Storefront.productPage.layout.indexing");
  const tSellerDetails = useTranslations("Settings.sellerDetails");
  const live = state === "live";

  return (
    <section className={cn(cardClass, "flex items-start gap-3 p-4")} data-storefront-link={state}>
      <span className={cn(iconTileClass, "size-9")}>
        <Link2 className="size-4" strokeWidth={2} aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        <p className={labelClass}>{t("title")}</p>
        {live ? (
          <>
            <p className="truncate font-mono text-xs text-foreground" data-storefront-link-url="">
              {url}
            </p>
            <p className={helpTextClass}>{t("live")}</p>
            {/* Where a seller asks "can people find it?", rather than only
                deep in the designer's Product page panel. */}
            {!searchable && (
              <p className={helpTextClass} data-storefront-link-search="off">
                {t("searchOff")}{" "}
                <Link href={settingHref(INDEXING_SETTING_ID, storefrontId)} className={inlineLinkClass}>
                  {tIndexing("label")}
                </Link>
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <CopyButton
                value={url}
                variant="labelled"
                messages={{
                  copy: "Storefront.share.copy.copy",
                  copied: "Storefront.share.copy.copied",
                  failed: "Storefront.share.copy.failed",
                }}
              />
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonClassName("ghost")}
              >
                {t("open")}
                <ArrowUpRight className="size-4" strokeWidth={2} aria-hidden="true" />
              </a>
            </div>
          </>
        ) : (
          <>
            <p className={helpTextClass}>{t(state === "pages-off" ? "pagesOff" : "detailsMissing")}</p>
            {state === "pages-off" ? (
              <Link href={storefrontEditorPath(storefrontId)} className={buttonClassName("secondary", "w-fit")}>
                {t("openDesigner")}
              </Link>
            ) : (
              <Link href={traderIdentityHref(missing)} className={buttonClassName("secondary", "w-fit")}>
                {tSellerDetails("addLink")}
              </Link>
            )}
          </>
        )}
      </div>
    </section>
  );
}
