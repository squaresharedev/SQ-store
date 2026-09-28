import { useTranslations } from "next-intl";
import { emptyShowcaseClass } from "@/components/ui/surface-styles";
import { AddShowcase } from "@/components/ui/AddShowcase";

/**
 * A real product, cut out of its photo: no background, no frame, just the
 * thing. The files are transparent WebPs under /public/empty-state, cut from
 * free-licence Pexels photos, with their pixel size given so the box is
 * reserved before they load and nothing shifts.
 *
 * Sized to CONTAIN, not to fill: `h-auto w-auto` plus `max-h-full max-w-full`
 * shrinks the picture on WHICHEVER axis binds first, so a wide, low product
 * (a flashlight lying on its side, sunglasses folded flat) never pushes past
 * its box just because it was given a tall one. `h-full w-auto` here used to
 * size purely off height, and a product with a near-square or wider-than-tall
 * silhouette (headphones front-on) could then run past the FRAME'S own edge:
 * the frame clips (`overflow-hidden`, for the glow), so the product read as
 * cut off rather than shrunk. See the `max-w-*` half of exampleClassName
 * below, which is what actually gives this something to contain within.
 */
function Cutout({ src, width, height }: { src: string; width: number; height: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a small static cut-out from /public; next/image adds nothing here.
    <img
      src={src}
      alt=""
      width={width}
      height={height}
      draggable={false}
      className="h-auto max-h-full w-auto max-w-full drop-shadow-xl"
    />
  );
}

/**
 * The gadget beside the t-shirt, right of the add card. Several candidates
 * live here (not just the shipped one) so /dev/product-empty can show them
 * side by side — see that page for how this list gets used.
 *
 * Each one is a real, unbranded (or brand painted out) photo. Rejected along
 * the way, and worth remembering why: a game controller (PlayStation button
 * glyphs and a small PS logo), a mouse and a pair of earbuds (both fine
 * shapes, but the user asked for something other than "audio gadget /
 * computer peripheral" a second time), a watch with "TIMEX" on the dial, an
 * Instax camera with its name moulded into the body, a Google Home Mini
 * (no text, but the shape alone is that specific product).
 */
export const PRODUCT_GADGETS = {
  headphones: {
    label: "Headphones",
    src: "/empty-state/headphones.webp",
    width: 507,
    height: 480,
    source: "Pexels 3394666",
  },
  flashlight: {
    label: "Flashlight",
    src: "/empty-state/flashlight.webp",
    width: 822,
    height: 480,
    source: "Pexels 8689406",
  },
  sunglasses: {
    label: "Sunglasses",
    src: "/empty-state/sunglasses.webp",
    width: 986,
    height: 480,
    source: "Pexels 25389283",
  },
} as const;

export type ProductGadget = keyof typeof PRODUCT_GADGETS;

/** The shipped pairing, until the team picks one of the /dev/product-empty
 *  options to replace it. Exported so dev-only checks (the sidebar-width
 *  fixture on that page) can verify the ACTUAL default rather than a
 *  hand-copied guess that could quietly drift from it. */
export const DEFAULT_GADGET: ProductGadget = "headphones";

// First screen a new seller is likely to see, so it explains the next step and
// gives one clear call to action (styles.md: calm, direct, no fluff). The add
// card IS that call to action, with a product peeking out from under each side
// of it (AddShowcase): a black t-shirt and a gadget, so the pair says "a shop
// can sell anything" rather than "a clothing shop", and the gadget's light
// colour stands clear of the dark tee. Read-only members of the active store
// see the two products on their own, with no card: a plus that does nothing
// is worse than none.
export function ProductEmptyState({
  canWrite = true,
  gadget = DEFAULT_GADGET,
}: {
  canWrite?: boolean;
  /** Dev-only override so /dev/product-empty can preview the alternatives;
   *  every real caller leaves this at the shipped default. */
  gadget?: ProductGadget;
}) {
  const t = useTranslations("Products.emptyState");
  const right = PRODUCT_GADGETS[gadget];
  return (
    <div className={emptyShowcaseClass}>
      <div className="flex flex-col items-center">
        <AddShowcase
          card={
            canWrite
              ? { href: "/products/new", label: t("add"), className: "h-32 w-28 rounded-none sm:h-40 sm:w-36" }
              : undefined
          }
          // Every gadget here is narrower under the card than a rectangular
          // board, so a positive tuck buries an edge: a small NEGATIVE tuck
          // leaves a gap instead.
          className="[--showcase-tuck:-0.5rem] sm:[--showcase-tuck:-0.75rem]"
          // The pair and the card must fit the frame, tilt and all, at every
          // width the (dashboard) shell can hand this — not just a bare
          // viewport. `(dashboard)` reserves a 256px sidebar from `md` (768px)
          // up, so from 768px to well past `sm:`'s own 640px threshold, a page
          // can be "desktop" width-wise yet have far less room than `sm:`
          // sizing assumes: a real user hit this with the headphones' right
          // earcup clipped by the frame. Widening only at `lg:` (1024px)
          // rather than `sm:` (640px) is what actually fixes that, because it
          // leaves the whole sidebar-but-not-lg-wide band (768–1024px) at the
          // smaller size instead of trying to out-guess exactly how much
          // narrower the sidebar makes any given width — see
          // /dev/product-empty's `sidebar-narrowed` fixture, which reproduces
          // the 256px offset without needing a session to check this against.
          // `max-w-*` caps width at the SAME value as the height, so every
          // product sits inside a square no wider than that budget however
          // wide its own photo is; the t-shirt and anything narrower than
          // square is never touched by the cap. MUST be bracket syntax:
          // unlike `w-*`/`h-*`, Tailwind's `max-w-*` scale is named
          // (xs/sm/md/.../7xl), not numeric — `max-w-28` is not a class at
          // all and fails silently, which is exactly how this got shipped
          // broken the first time.
          exampleClassName="mt-4 h-28 max-w-[5.5rem] lg:h-52 lg:max-w-[12rem]"
          left={<Cutout src="/empty-state/tshirt.webp" width={470} height={480} />}
          right={<Cutout src={right.src} width={right.width} height={right.height} />}
        />
        <h2 className="mt-10 text-lg font-semibold text-foreground">
          {t("title")}
        </h2>
        <p className="mt-1 max-w-sm font-inter text-sm text-muted-foreground">
          {canWrite ? t("descriptionWriter") : t("descriptionReadOnly")}
        </p>
      </div>
    </div>
  );
}
