import { readableInkOn } from "@/lib/format/color";
import { gradientCss, paletteGradients } from "@/lib/storefront/gradients";
import { derivePalette } from "@/lib/storefront/palette";
import { ShapeTileContent } from "@/components/storefront/ShapeTileContent";
import {
  NEW_STOREFRONT_THEME,
  PALETTE_SLOTS,
  type ShapeBlock,
  type ShapeKind,
  type StorefrontPalette,
  type StorefrontTheme,
} from "@/types/storefront";

/**
 * The palettes the gallery draws on: a new storefront's, the sample's own
 * (derived, as an old storefront's would be), and two fixtures with more
 * colour in them. Raw hex is fine here: these are gallery fixtures.
 */
export const GALLERY_PALETTES = {
  new: () => NEW_STOREFRONT_THEME.palette!,
  sample: (theme: StorefrontTheme) => derivePalette(theme),
  dark: () => ({ background: "#18181b", text: "#fafafa", accent: "#f97316", surface: "#27272a", muted: "#3f3f46" }),
  peach: () => ({ background: "#fff7ed", text: "#431407", accent: "#fb923c", surface: "#ffffff", muted: "#fed7aa" }),
} satisfies Record<string, (theme: StorefrontTheme) => StorefrontPalette>;
export type GalleryPalette = keyof typeof GALLERY_PALETTES;
export const isGalleryPalette = (value: string | undefined): value is GalleryPalette =>
  value !== undefined && value in GALLERY_PALETTES;

const SHEET_SHAPES: { kind: ShapeKind; borderWidth?: number }[] = [
  { kind: "circle" },
  { kind: "star" },
  { kind: "ring", borderWidth: 10 },
  { kind: "rounded", borderWidth: 4 },
];

/** Every ready-made gradient, on every gallery palette: the backdrops with
 *  the board's own ink on them, the fills on four kinds of shape. */
export function GradientSheet({ sampleTheme }: { sampleTheme: StorefrontTheme }) {
  return (
    <main className="space-y-10 bg-background p-6 font-inter text-sm" data-gallery-sheet="">
      {(Object.keys(GALLERY_PALETTES) as GalleryPalette[]).map((name) => {
        const palette = GALLERY_PALETTES[name](sampleTheme);
        return (
          <section key={name} className="space-y-3" data-gallery-palette={name}>
            <h2 className="flex items-center gap-3 font-semibold">
              {name}
              <span className="flex gap-1">
                {PALETTE_SLOTS.map((slot) => (
                  <span key={slot} title={slot} className="size-5 rounded-full ring-1 ring-black/10" style={{ backgroundColor: palette[slot] }} />
                ))}
              </span>
            </h2>
            <div className="flex flex-wrap gap-3">
              {paletteGradients(palette, "backdrop").map(({ id, fill }) => (
                <div
                  key={id}
                  className="flex h-28 w-48 flex-col justify-end p-3"
                  style={{ backgroundImage: gradientCss(fill) ?? undefined, color: readableInkOn(fill.from) }}
                >
                  <span className="text-lg font-semibold">Aa {id}</span>
                  <span className="text-xs">{fill.via ? "3 stops" : "2 stops"}, {fill.angle} deg</span>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-6">
              {paletteGradients(palette, "fill").map(({ id, fill }) => (
                <div key={id} className="space-y-1">
                  <div className="flex gap-2 p-2" style={{ backgroundColor: palette.background }}>
                    {SHEET_SHAPES.map(({ kind, borderWidth }) => {
                      const block: ShapeBlock = {
                        type: "shape",
                        id: `00000000-0000-4000-8000-${String(SHEET_SHAPES.findIndex((s) => s.kind === kind)).padStart(12, "0")}`,
                        kind,
                        color: fill.from,
                        gradient: fill,
                        ...(borderWidth ? { borderWidth, borderColor: palette.text } : {}),
                        x: 0,
                        y: 0,
                        w: 1,
                        h: 1,
                      };
                      return (
                        <div key={kind} className="flex size-16 flex-col">
                          <ShapeTileContent block={kind === "ring" ? { ...block, borderColor: undefined } : block} />
                        </div>
                      );
                    })}
                  </div>
                  <span className="text-xs text-muted-foreground">{id}</span>
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </main>
  );
}
