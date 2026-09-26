import { useTranslations } from "next-intl";
import { emptyShowcaseClass } from "@/components/ui/surface-styles";
import { AddShowcase } from "@/components/ui/AddShowcase";
import { PlantIllustration, WatchIllustration } from "./ProductIllustrations";

/**
 * A real product, cut out of its photo: no background, no frame, just the
 * thing. The files are transparent WebPs under /public/empty-state (cut from
 * the marketing site's product photos), with their pixel size given so the box
 * is reserved before they load and nothing shifts.
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
      className="h-full w-auto drop-shadow-xl"
    />
  );
}

/** The two ways the products either side of the card can be drawn: in code
 *  (ProductIllustrations) or cut out of real photos. */
export type ProductEmptyStateVariant = "illustration" | "photo";

// First screen a new seller is likely to see, so it explains the next step and
// gives one clear call to action (styles.md: calm, direct, no fluff). The add
// card IS that call to action, with a product peeking out from under each side
// of it (AddShowcase). Read-only members of the active store see the two
// products on their own, with no card: a plus that does nothing is worse than
// none.
export function ProductEmptyState({
  canWrite = true,
  variant = "illustration",
}: {
  canWrite?: boolean;
  variant?: ProductEmptyStateVariant;
}) {
  const t = useTranslations("Products.emptyState");
  const drawn = variant === "illustration";
  return (
    <div className={emptyShowcaseClass}>
      <div className="flex flex-col items-center">
        <AddShowcase
          card={
            canWrite
              ? { href: "/products/new", label: t("add"), className: "h-32 w-28 rounded-none sm:h-40 sm:w-36" }
              : undefined
          }
          // The drawn products fill their boxes edge to edge, so they tuck in
          // less than the cut-outs to keep the watch face clear of the card.
          className={
            drawn
              ? "[--showcase-tuck:0.75rem] sm:[--showcase-tuck:0.375rem]"
              : "[--showcase-tuck:0.75rem] sm:[--showcase-tuck:1.25rem]"
          }
          exampleClassName="mt-4 h-36 sm:h-52"
          left={
            drawn ? (
              <PlantIllustration className="h-full w-auto" />
            ) : (
              <Cutout src="/empty-state/snake-plant.webp" width={244} height={480} />
            )
          }
          right={
            drawn ? (
              <WatchIllustration className="h-full w-auto" />
            ) : (
              <Cutout src="/empty-state/watch.webp" width={256} height={480} />
            )
          }
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
