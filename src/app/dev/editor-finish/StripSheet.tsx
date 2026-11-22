import { BlockFace } from "@/components/storefront/BlockFace";
import { TEXT_VARIANTS, type MarqueeBlock, type StorefrontTheme } from "@/types/storefront";

/** Backdrops a strip may sit on (gallery fixtures): light, dark, a strong
 *  colour, and none handed in (the board's own ink carries on). */
const BACKDROPS: (string | undefined)[] = ["#ffffff", "#18181b", "#c2410c", "#fde68a", undefined];

/**
 * The scrolling strip on several backdrops, in every saved text style: what
 * the face picks for its ink when the strip has no colour of its own, drawn
 * through BlockFace exactly as a board draws it.
 */
export function StripSheet({ theme }: { theme: StorefrontTheme }) {
  return (
    <main className="space-y-3 bg-background p-6 font-inter text-sm" data-gallery-strips="">
      {BACKDROPS.flatMap((backdrop, row) =>
        TEXT_VARIANTS.map((variant, column) => {
          const block: MarqueeBlock = {
            type: "marquee",
            id: `00000000-0000-4000-8000-0000000${row}${column}000`.slice(0, 36),
            text: `${variant} on ${backdrop ?? "the board"}`,
            variant,
            ...(column === 3 && row === 0 ? { speed: "slow" as const } : {}),
            x: 0,
            y: 0,
            w: 6,
            h: 1,
          };
          return (
            <div
              key={`${row}-${variant}`}
              className="flex h-14 flex-col border border-border"
              style={backdrop ? { backgroundColor: backdrop } : undefined}
            >
              <BlockFace block={block} product={null} theme={theme} backdrop={backdrop} />
            </div>
          );
        }),
      )}
    </main>
  );
}
