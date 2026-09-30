import { notFound } from "next/navigation";
import { checkoutPageSchema } from "@/lib/validation/storefront";
import { DEFAULT_CHECKOUT_PAGE_CONFIG } from "@/types/storefront";
import { CheckoutGallery } from "./CheckoutGallery";

// Living reference for the hosted checkout and its thank-you page: the real
// CheckoutView and OrderStatusView in preview mode, beside the real Checkout
// panel from the storefront designer, so the design and every one of its
// settings can be judged without a sign-in, a database or a product page.
// `?w=390` draws the phone width, `?kind=digital` a download, `?view=thanks`
// the thank-you page, `?q=3` three of it, `?scroll=1` the page inside a
// phone-height window it scrolls in (as the editor shows it on a phone),
// `?view=thanks&buyer=1` the thank-you in the buyer's mode (screen-wide
// confetti), and
// `?texture=` / `?layout=` /
// `?bg=` (a hex without the #) start the design somewhere other than the
// defaults. Dev-only: the route 404s in production builds.

export const metadata = { title: "Checkout: dev gallery" };

export default async function CheckoutDevPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const { w, kind, view, q, texture, layout, bg, scroll, buyer } = await searchParams;
  const initial = checkoutPageSchema.safeParse({
    ...DEFAULT_CHECKOUT_PAGE_CONFIG,
    ...(texture ? { texture } : {}),
    ...(layout ? { layout } : {}),
    ...(bg ? { backgroundColor: `#${bg}` } : {}),
  });
  return (
    <CheckoutGallery
      width={w === "390" ? 390 : 1280}
      digital={kind === "digital"}
      view={view === "thanks" ? "thanks" : "checkout"}
      quantity={Math.min(Math.max(Number(q) || 1, 1), 5)}
      scroll={scroll === "1"}
      buyer={buyer === "1"}
      initialCheckoutPage={initial.success ? initial.data : DEFAULT_CHECKOUT_PAGE_CONFIG}
    />
  );
}
