"use client";

import { VIBE_PRESETS, themeMatchesVibe } from "@/lib/storefront/presets";
import { STOREFRONT_VIBES, type StorefrontVibe } from "@/types/storefront-brief";
import type { StorefrontTheme } from "@/types/storefront";
import { cn } from "@/lib/utils";
import { strongLabelClass } from "@/components/ui/control-styles";
import { InfoTip } from "@/components/ui/InfoTip";

/**
 * The three starting looks, brought inside the editor.
 *
 * They already existed, and a seller could only ever meet them once: in the
 * creation wizard, before they had seen their own products on the board. That
 * is the worst possible moment to choose a look. Here they are a way back to a
 * coherent storefront at any point, which is what makes the rest of the panel
 * safe to explore.
 *
 * A look writes the fields in VibePreset: canvas, accent, typeface, roundness,
 * gutter, and what a product tile shows — the title band's style and whether it
 * waits for a hover, where the price sits and whether it does. Canvas size,
 * sold-out settings, the price chip's colours, the header and every per-tile
 * override are the seller's work and are left exactly as they are. It goes
 * through the ordinary theme mutator, so it is one Cmd+Z away and needs no
 * confirmation of its own.
 *
 * LAID OUT AS A LIST, not the three-across grid this was. What separates these
 * looks is no longer a colour you can see in a 60px swatch, it is what a tile
 * shows and when — so each one gets a line of prose saying so, and a row is the
 * only shape in a panel this narrow that has room for one.
 */

const VIBE_LABELS: Record<StorefrontVibe, string> = {
  minimal: "Minimal",
  classic: "Classic",
  bold: "Bold",
};

/** What the look actually does to a tile. The reason to pick one over another,
 *  in the words a seller would use for it. */
const VIBE_HINTS: Record<StorefrontVibe, string> = {
  minimal: "Pictures only. Name and price on hover.",
  classic: "Name and price under every picture.",
  bold: "Price always on the picture, name on hover.",
};

/** The look, drawn in the look: its own canvas, its own accent, its own
 *  roundness and its own gutter. Radius and gap are scaled down because the
 *  swatch is a fraction of a real tile; passing the raw values through would
 *  round every preset into circles and make them indistinguishable. */
function LookSwatch({ vibe }: { vibe: StorefrontVibe }) {
  const preset = VIBE_PRESETS[vibe];
  return (
    <span
      aria-hidden="true"
      style={{
        backgroundColor:
          preset.background.kind === "solid" ? preset.background.color : undefined,
        gap: `${Math.round(preset.gridGap / 4)}px`,
      }}
      className="flex h-9 w-12 shrink-0 items-center justify-center border border-border"
    >
      {[1, 0.55].map((opacity, index) => (
        <span
          key={index}
          style={{
            backgroundColor: preset.accent,
            opacity,
            borderRadius: `${Math.min(6, preset.cornerRadius / 4)}px`,
          }}
          className="block h-5 w-4"
        />
      ))}
    </span>
  );
}

export function LooksSection({
  theme,
  onChange,
}: {
  theme: StorefrontTheme;
  onChange: (theme: StorefrontTheme) => void;
}) {
  return (
    <div className="space-y-1.5">
      <span className="flex items-center gap-1.5">
        <span className={strongLabelClass}>Looks</span>
        <InfoTip label="What picking a look changes">
          A look sets the whole storefront&apos;s colours, font, corners,
          spacing and what a product tile shows in one go. Your layout, your
          products and any tile you styled by hand are left exactly as they
          are.
        </InfoTip>
      </span>
      <div role="group" aria-label="Storefront look" className="space-y-1.5">
        {STOREFRONT_VIBES.map((vibe) => {
          // A look is "on" while everything it writes still matches. One edit
          // away and nothing is pressed, which is the truth.
          const active = themeMatchesVibe(theme, vibe);
          return (
            <button
              key={vibe}
              type="button"
              // VIBE_PRESETS directly, NOT themeForVibe: that helper answers
              // "what does a brand-new storefront start on", so it merges the
              // preset over DEFAULT_STOREFRONT_CONFIG.theme and returns a full
              // theme, columns/rows/soldOutBadge/hideSoldOut included even
              // though no preset sets them. Spreading that over an existing
              // theme would snap the seller's canvas back to the 6x6 default
              // every time they tried a look. Spreading the preset alone is
              // the fields it actually owns, nothing else.
              onClick={() => onChange({ ...theme, ...VIBE_PRESETS[vibe] })}
              aria-pressed={active}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-none border p-2 text-left transition-colors duration-base ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none",
                active
                  ? "border-foreground bg-accent"
                  : "border-border hover:bg-accent/50",
              )}
            >
              <LookSwatch vibe={vibe} />
              <span className="min-w-0 font-inter">
                {/* The name stays full-strength whether or not the look is on:
                    the hint under it is already muted, and two greys of the
                    same weight stop reading as a name and its description. */}
                <span
                  className={cn(
                    "block text-sm leading-tight text-foreground",
                    active && "font-medium",
                  )}
                >
                  {VIBE_LABELS[vibe]}
                </span>
                <span className="block text-xs leading-tight text-muted-foreground">
                  {VIBE_HINTS[vibe]}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
