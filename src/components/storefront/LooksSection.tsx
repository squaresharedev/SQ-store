"use client";

import { VIBE_PRESETS, themeForVibe } from "@/lib/storefront/presets";
import { STOREFRONT_VIBES, type StorefrontVibe } from "@/types/storefront-brief";
import type { StorefrontTheme } from "@/types/storefront";
import { cn } from "@/lib/utils";
import { strongLabelClass } from "@/components/ui/control-styles";
import { InfoTip } from "@/components/ui/InfoTip";

/**
 * The six starting looks, brought inside the editor.
 *
 * They already existed, and a seller could only ever meet them once: in the
 * creation wizard, before they had seen their own products on the board. That
 * is the worst possible moment to choose a look. Here they are a way back to a
 * coherent storefront at any point, which is what makes the rest of the panel
 * safe to explore.
 *
 * A look writes only the six fields a vibe covers (background, accent, font,
 * roundness, gap, title style). Canvas size, display mode, sold-out settings,
 * the price tag's appearance and every per-tile override are the seller's work
 * and are left exactly as they are. It goes through the ordinary theme
 * mutator, so it is one Cmd+Z away and needs no confirmation of its own.
 */

const VIBE_LABELS: Record<StorefrontVibe, string> = {
  minimal: "Minimal",
  warm: "Warm",
  bold: "Bold",
  playful: "Playful",
  luxe: "Luxe",
  classic: "Classic",
};

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
          A look sets the whole storefront&apos;s colours, font, corners and
          spacing in one go. Your layout, your products and any tile you
          styled by hand are left exactly as they are.
        </InfoTip>
      </span>
      <div role="group" aria-label="Storefront look" className="grid grid-cols-3 gap-2">
        {STOREFRONT_VIBES.map((vibe) => {
          const preset = VIBE_PRESETS[vibe];
          // A look is "on" when the whole set it writes still matches. One
          // edit away and nothing is pressed, which is the truth.
          const active =
            theme.accent === preset.accent &&
            theme.font === preset.font &&
            theme.cornerRadius === preset.cornerRadius &&
            theme.gridGap === preset.gridGap &&
            theme.titleStyle === preset.titleStyle &&
            theme.background.kind === preset.background.kind &&
            (preset.background.kind !== "solid" ||
              (theme.background.kind === "solid" &&
                theme.background.color === preset.background.color));
          return (
            <button
              key={vibe}
              type="button"
              onClick={() => onChange({ ...theme, ...themeForVibe(vibe) })}
              aria-pressed={active}
              className={cn(
                "flex flex-col items-center gap-1.5 rounded-none border p-2 transition-colors duration-base ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none",
                active
                  ? "border-foreground bg-accent"
                  : "border-border hover:bg-accent/50",
              )}
            >
              {/* The look, drawn in the look: its own background, its own
                  accent, its own roundness. */}
              <span
                aria-hidden="true"
                style={{
                  backgroundColor:
                    preset.background.kind === "solid"
                      ? preset.background.color
                      : undefined,
                  borderRadius: Math.min(12, preset.cornerRadius / 4),
                }}
                className="flex h-10 w-full items-center justify-center border border-border"
              >
                <span
                  style={{
                    backgroundColor: preset.accent,
                    borderRadius: Math.min(6, preset.cornerRadius / 6),
                  }}
                  className="h-4 w-6"
                />
              </span>
              <span
                className={cn(
                  "font-inter text-xs",
                  active ? "font-medium text-foreground" : "text-muted-foreground",
                )}
              >
                {VIBE_LABELS[vibe]}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
