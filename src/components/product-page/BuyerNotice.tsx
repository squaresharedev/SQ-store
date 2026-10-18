"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

/**
 * A buyer's dead end, said one way: a sentence, a second line, one button.
 * Shared by every buyer page that has nothing else to show (a product that is
 * not available, a page that does not exist, a page that could not be loaded),
 * so the three cannot drift into three different-looking screens.
 *
 * Plain on purpose. No storefront theme (there may be no storefront to read
 * one from), no BrandFooter (marketing links belong on squareshare.eu, not on
 * a buyer's dead end), and no dashboard chrome: nobody arriving here has an
 * account, so nothing may talk about one.
 */
export function BuyerNotice({
  title,
  body,
  actionLabel,
  onAction,
}: {
  title: string;
  body: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 py-12 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="max-w-sm text-sm leading-relaxed opacity-70">{body}</p>
      <button
        type="button"
        onClick={onAction}
        className="rounded-lg border border-current px-5 py-2.5 text-sm font-medium opacity-75 hover:opacity-100"
      >
        {actionLabel}
      </button>
    </div>
  );
}

/**
 * "Go back", for a dead end that is final. history.back() is the same "where
 * you were" as the browser's own arrow, so a buyer who followed a tile from a
 * storefront goes back to that storefront rather than to a start page.
 */
export function BuyerGone({ title, body }: { title: string; body: string }) {
  const t = useTranslations("ProductPage.notFound");
  const router = useRouter();
  return (
    <BuyerNotice title={title} body={body} actionLabel={t("back")} onAction={() => router.back()} />
  );
}

/**
 * The page could not be loaded just now (lib/public/busy.ts): not a 404, and
 * said so. "Try again" asks the server again rather than replaying what failed.
 *
 * `order` picks the wording for a buyer's own order page, where the first
 * thing to say is that the order itself is safe.
 */
export function BuyerBusy({ order = false }: { order?: boolean }) {
  const t = useTranslations("ProductPage.unavailable");
  const tCommon = useTranslations("Common.actions");
  const router = useRouter();
  return (
    <BuyerNotice
      title={t("title")}
      body={t(order ? "orderBody" : "body")}
      actionLabel={tCommon("tryAgain")}
      onAction={() => router.refresh()}
    />
  );
}
