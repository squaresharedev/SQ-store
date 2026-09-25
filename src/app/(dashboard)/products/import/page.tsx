import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getActiveAccount } from "@/lib/team/account-context";
import { can } from "@/lib/team/permissions";
import { ProductImport } from "@/components/products/ProductImport";
import { getTraderIdentityStatus } from "@/lib/settings/seller-identity";
import { ghostButtonClass } from "@/components/ui/control-styles";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Products.metadata.import");
  return { title: t("title") };
}

// PROTECTED by (dashboard)/layout.tsx, and gated to writers for the same
// reason /products/new is: a read-only member of the active store cannot
// create products, so there is nothing here for them to do.
export default async function ImportProductsPage() {
  const account = await getActiveAccount();
  if (!can(account?.role, "products.write")) redirect("/products");

  // The same up-front answer the new-product form gets: the server refuses a
  // LIVE import without the store's trader details (lib/products/
  // import-actions.ts), so the choice is not offered, rather than refused after
  // the seller has mapped every column.
  const identity = account
    ? await getTraderIdentityStatus(account.accountId)
    : { ok: true as const, missing: [] };

  const t = await getTranslations("Products.page");

  return (
    <div className="@container mx-auto w-full max-w-3xl space-y-6 p-4 @md:p-6">
      <div className="space-y-3">
        <Link href="/products" className={ghostButtonClass}>
          <ArrowLeft className="size-4" strokeWidth={2} aria-hidden="true" />
          {t("back")}
        </Link>
        <div>
          <h1 className="font-inter text-2xl font-semibold text-foreground">{t("import.heading")}</h1>
          <p className="mt-1 font-inter text-sm text-muted-foreground">
            {t("import.description")}
          </p>
        </div>
      </div>
      <ProductImport missingTraderDetails={identity.ok ? identity.missing : []} />
    </div>
  );
}
