import { notFound } from "next/navigation";
import { checkoutPageSchema } from "@/lib/validation/storefront";
import { DEFAULT_CHECKOUT_PAGE_CONFIG } from "@/types/storefront";
import { CheckoutGallery } from "./CheckoutGallery";

// Living reference for the hosted checkout and its thank-you page: the real
// CheckoutView and OrderStatusView in preview mode, beside the real Checkout
// panel from the storefront designer, so the design and every one of its
// settings can be judged without a sign-in, a database or a product page.
// `?w=390` draws that width (320 to 1440, default 1280), `?kind=digital` a
// download, `?view=thanks` the thank-you page, `?q=3` three of it, `?scroll=1`
// the page inside a phone-height window it scrolls in (as the editor shows it
// on a phone), `?view=thanks&buyer=1` the thank-you in the buyer's mode
// (screen-wide confetti), and `?layout=` / `?bg=` (a hex without the #) / `?photo=1` start
// the design somewhere other than the defaults. Dev-only: the route 404s in
// production builds.

/** A stand-in uploaded photo for `?photo=1`: a key shaped like a real one, shown
 *  from a picture the app already serves. */
const HARNESS_PHOTO_KEY = "images/00000000-0000-4000-8000-000000000000/00000000-0000-4000-8000-000000000001-harness.webp";
const HARNESS_PHOTO_URL = "/sample-storefront/camera.webp";

/** The frame's width bounds, in px: a small phone to a wide desktop. */
const WIDTH_MIN = 320;
const WIDTH_MAX = 1440;
const WIDTH_DEFAULT = 1280;

export const metadata = { title: "Checkout: dev gallery" };

export default async function CheckoutDevPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const { w, kind, view, q, layout, bg, scroll, buyer, photo } = await searchParams;
  const initial = checkoutPageSchema.safeParse({
    ...DEFAULT_CHECKOUT_PAGE_CONFIG,
    ...(layout ? { layout } : {}),
    ...(bg ? { backgroundColor: `#${bg}` } : {}),
    ...(photo === "1" ? { backgroundImage: { key: HARNESS_PHOTO_KEY } } : {}),
  });
  const width = Number(w);
  return (
    <CheckoutGallery
      width={Number.isInteger(width) ? Math.min(Math.max(width, WIDTH_MIN), WIDTH_MAX) : WIDTH_DEFAULT}
      digital={kind === "digital"}
      view={view === "thanks" ? "thanks" : "checkout"}
      quantity={Math.min(Math.max(Number(q) || 1, 1), 5)}
      scroll={scroll === "1"}
      buyer={buyer === "1"}
      initialCheckoutPage={initial.success ? initial.data : DEFAULT_CHECKOUT_PAGE_CONFIG}
      initialPhotoUrls={{ [HARNESS_PHOTO_KEY]: HARNESS_PHOTO_URL }}
    />
  );
}
