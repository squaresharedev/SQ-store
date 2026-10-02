import { cn } from "@/lib/utils";
import { PLAN_IDS, type PlanId } from "@/lib/billing/plans";

/**
 * Real products, cut out of their photos: the same unbranded transparent
 * WebPs the Products empty state shows (public/empty-state, picked for having
 * no logo on them). Pixel sizes reserve the box so nothing shifts on load.
 */
const PRODUCTS = [
  { src: "/empty-state/tshirt.webp", width: 470, height: 480 },
  { src: "/empty-state/headphones.webp", width: 507, height: 480 },
  { src: "/empty-state/sunglasses.webp", width: 986, height: 480 },
] as const;

/**
 * Where each card sits in the fan, by its offset from the middle: tilted
 * away from the centre, the outer ones dropped a little, and spread a touch
 * further when the plan's card is hovered.
 */
const FAN_CLASS: Record<string, string> = {
  "-1": "-rotate-6 translate-y-2 group-hover/plan:-rotate-12",
  "-0.5": "-rotate-3 translate-y-1 group-hover/plan:-rotate-6",
  "0": "z-10 group-hover/plan:-translate-y-1",
  "0.5": "rotate-3 translate-y-1 group-hover/plan:rotate-6",
  "1": "rotate-6 translate-y-2 group-hover/plan:rotate-12",
};

/**
 * A plan, drawn as a little shelf of products: one on Free, one more on each
 * plan up, fanned like cards on a table. It says "room to grow" without a
 * word, and it is the shop's own kind of thing (products), not a decoration.
 *
 * Monochrome on purpose: the photos are the only colour, the frame is the
 * muted surface. Decorative only, so it is hidden from assistive tech.
 */
export function PlanVisual({ plan, className }: { plan: PlanId; className?: string }) {
  const count = Math.min(PRODUCTS.length, PLAN_IDS.indexOf(plan) + 1);
  const shelf = PRODUCTS.slice(0, count);
  return (
    <div
      aria-hidden
      data-plan-visual={plan}
      className={cn("flex h-32 items-center justify-center overflow-hidden rounded-sm bg-muted", className)}
    >
      {shelf.map((product, index) => (
        <div
          key={product.src}
          className={cn(
            "-mx-1.5 w-20 rounded-sm border border-border bg-card p-1.5 shadow-sm transition-[rotate,translate] duration-base ease-standard motion-reduce:transition-none",
            FAN_CLASS[String(index - (count - 1) / 2)],
          )}
        >
          <div className="flex aspect-square items-center justify-center rounded-sm bg-muted p-1.5">
            {/* eslint-disable-next-line @next/next/no-img-element -- a small static cut-out from /public; next/image adds nothing here. */}
            <img
              src={product.src}
              alt=""
              width={product.width}
              height={product.height}
              draggable={false}
              loading="lazy"
              className="h-auto max-h-full w-auto max-w-full"
            />
          </div>
          {/* A product card's title and price, as lines: no words to read. */}
          <div className="mt-1.5 h-1 w-3/4 rounded-full bg-muted" />
          <div className="mt-1 h-1 w-1/3 rounded-full bg-foreground" />
        </div>
      ))}
    </div>
  );
}
