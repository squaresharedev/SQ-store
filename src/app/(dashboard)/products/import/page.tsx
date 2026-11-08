import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import Link from "@/components/ui/AppLink";
import { ArrowLeft, Download } from "lucide-react";
import { getActiveAccount } from "@/lib/team/account-context";
import { can } from "@/lib/team/permissions";
import { ProductImport } from "@/components/products/ProductImport";
import { getSellerIdentity, getTraderIdentityStatus } from "@/lib/settings/seller-identity";
import { ghostButtonClass, quietLinkClass, secondaryButtonClass } from "@/components/ui/control-styles";
import { ImportFileHelp } from "@/components/products/ImportFileHelp";
import { planRoom } from "@/lib/billing/limits";
import { PlanLimitNotice } from "@/components/billing/PlanLimitNotice";
import { requireUser } from "@/lib/auth/session";
import { predictProductDefaults } from "@/lib/predictions";
import { listRecentProductFacts } from "@/lib/products/queries";
import { PRODUCTS_IMPORT_TEMPLATE_PATH, PRODUCTS_PATH } from "@/lib/products/paths";
import { REVIEWS_IMPORT_PATH } from "@/lib/reviews/paths";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Products.metadata.import");
  return { title: t("title") };
}

// PROTECTED by (dashboard)/layout.tsx, and gated to writers for the same
// reason /products/new is: a read-only member of the active store cannot
// create products, so there is nothing here for them to do.
export default async function ImportProductsPage() {
  // The layout's session gate does not run again on a move between sections
  // (see ../layout.tsx, or ../../layout.tsx from a nested page): a page asks.
  await requireUser(PRODUCTS_PATH);
  const account = await getActiveAccount();
  if (!can(account?.role, "products.write")) redirect(PRODUCTS_PATH);

  // The same up-front answer the new-product form gets: the server refuses a
  // LIVE import without the store's trader details (lib/products/
  // import-actions.ts), so the choice is not offered, rather than refused after
  // the seller has mapped every column.
  const identity = account
    ? await getTraderIdentityStatus(account.accountId)
    : { ok: true as const, missing: [] };

  // How much room the store's plan has for more products: none means the
  // limit is shown in place of the importer; some narrows what one file may
  // bring in (the action applies the same number).
  const room = account ? await planRoom(account.accountId, "products") : null;

  // What the currency starts on, as for a new product: the one the store
  // already prices in, else its business country's (lib/predictions.ts).
  const [recentProducts, seller] = await Promise.all([
    listRecentProductFacts(account?.accountId),
    account ? getSellerIdentity(account.accountId) : null,
  ]);

  const t = await getTranslations("Products.page");

  return (
    <div className="@container mx-auto w-full max-w-3xl space-y-6 p-4 @md:p-6">
      <div className="space-y-3">
        <Link href={PRODUCTS_PATH} className={ghostButtonClass}>
          <ArrowLeft className="size-4" strokeWidth={2} aria-hidden="true" />
          {t("back")}
        </Link>
        <div className="space-y-2">
          <h1 className="font-inter text-2xl font-semibold text-foreground">{t("import.heading")}</h1>
          <p className="font-inter text-sm text-muted-foreground">
            {t("import.description")}
          </p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-1">
            {/* Blank CSV for sellers building a file from scratch. */}
            <a href={PRODUCTS_IMPORT_TEMPLATE_PATH} download className={secondaryButtonClass}>
              <Download className="size-4" strokeWidth={2} aria-hidden="true" />
              {t("import.templateLink")}
            </a>
            {/* Moving a store is products AND their reviews; the second import
                is found where the first one is done. */}
            <Link href={REVIEWS_IMPORT_PATH} className={quietLinkClass}>
              {t("import.reviewsLink")}
            </Link>
          </div>
        </div>
      </div>
      <ProductImport
        intro={<ImportFileHelp />}
        missingTraderDetails={identity.ok ? identity.missing : []}
        planRoomLeft={room?.left ?? null}
        defaultCurrency={predictProductDefaults(recentProducts, [], seller?.country).currency}
        limitNotice={
          room && room.left === 0 ? (
            <PlanLimitNotice limitKey="products" plan={room.plan} cap={room.cap} />
          ) : null
        }
      />
    </div>
  );
}
