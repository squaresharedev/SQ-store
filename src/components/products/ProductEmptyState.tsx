import { useTranslations } from "next-intl";
import { emptyShowcaseClass } from "@/components/ui/surface-styles";
import { AddShowcase } from "@/components/ui/AddShowcase";

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

// First screen a new seller is likely to see, so it explains the next step and
// gives one clear call to action (styles.md: calm, direct, no fluff). The add
// card IS that call to action, with a real product peeking out from under each
// side of it (AddShowcase). Read-only members of the active store see the two
// products on their own, with no card: a plus that does nothing is worse than
// none.
export function ProductEmptyState({ canWrite = true }: { canWrite?: boolean }) {
  const t = useTranslations("Products.emptyState");
  return (
    <div className={emptyShowcaseClass}>
      <div className="flex flex-col items-center">
        <AddShowcase
          card={
            canWrite
              ? { href: "/products/new", label: t("add"), className: "h-32 w-28 rounded-none sm:h-40 sm:w-36" }
              : undefined
          }
          className="[--showcase-tuck:0.75rem] sm:[--showcase-tuck:1.25rem]"
          exampleClassName="mt-4 h-36 sm:h-52"
          left={<Cutout src="/empty-state/succulent.webp" width={290} height={463} />}
          right={<Cutout src="/empty-state/watch.webp" width={256} height={480} />}
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
