"use client";

import type { LucideIcon } from "lucide-react";
import {
  BookOpen,
  Camera,
  CalendarClock,
  Clock,
  Coffee,
  Download,
  FileDown,
  Gem,
  Lamp,
  Layers,
  Music,
  Package,
  Palette,
  Scissors,
  Shapes,
  Shirt,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { VIBE_PRESETS } from "@/lib/storefront/presets";
import { FONT_CLASSES } from "@/components/storefront/config-maps";
import {
  STOREFRONT_CATEGORIES,
  STOREFRONT_FULFILMENTS,
  STOREFRONT_VIBES,
  type StorefrontCategory,
  type StorefrontFulfilment,
  type StorefrontVibe,
} from "@/types/storefront-brief";

// Presentation for the creation flow's answers: the copy, the glyphs, and the
// tile grid they sit in. The values themselves live in types/storefront-brief.
//
// Each set is a Record keyed by its enum, so adding a value to the enum without
// giving it a label is a TYPE error rather than a tile that silently goes
// missing. The rendered order comes from the enum array, which is therefore the
// one place order is decided.
//
// Every step is a grid of the same tile, so the flow reads as one control the
// seller learns once. The tile borrows its look from OptionCardPicker (the
// designer's visual pickers) rather than inventing a second selected-state
// treatment.

// ── Categories ──────────────────────────────────────────────────────────

type CategoryMeta = {
  label: string;
  icon: LucideIcon;
  /** Seeds the name field's placeholder once this category is chosen, so the
   *  last step opens with a suggestion instead of an empty box. */
  namePlaceholder: string;
};

const CATEGORY_META: Record<StorefrontCategory, CategoryMeta> = {
  fashion: { label: "Clothing", icon: Shirt, namePlaceholder: "My clothing shop" },
  art: { label: "Art & prints", icon: Palette, namePlaceholder: "My art shop" },
  jewellery: { label: "Jewellery", icon: Gem, namePlaceholder: "My jewellery shop" },
  handmade: { label: "Handmade", icon: Scissors, namePlaceholder: "My handmade shop" },
  home: { label: "Home & living", icon: Lamp, namePlaceholder: "My home shop" },
  beauty: { label: "Beauty", icon: Sparkles, namePlaceholder: "My beauty shop" },
  food: { label: "Food & drink", icon: Coffee, namePlaceholder: "My food shop" },
  music: { label: "Music", icon: Music, namePlaceholder: "My music shop" },
  photography: { label: "Photography", icon: Camera, namePlaceholder: "My photo shop" },
  books: { label: "Books & zines", icon: BookOpen, namePlaceholder: "My book shop" },
  digital: { label: "Digital goods", icon: FileDown, namePlaceholder: "My digital shop" },
  vintage: { label: "Vintage", icon: Clock, namePlaceholder: "My vintage shop" },
  other: { label: "Something else", icon: Shapes, namePlaceholder: "My shop" },
};

/** The placeholder the name step opens with, given what they picked. */
export function namePlaceholderFor(category: StorefrontCategory | null): string {
  return category ? CATEGORY_META[category].namePlaceholder : "My storefront";
}

// ── Fulfilment ──────────────────────────────────────────────────────────

const FULFILMENT_META: Record<
  StorefrontFulfilment,
  { label: string; hint: string; icon: LucideIcon }
> = {
  physical: { label: "I ship it", hint: "Physical products", icon: Package },
  digital: { label: "They download it", hint: "Files, presets, music", icon: Download },
  services: { label: "They book me", hint: "Sessions, commissions", icon: CalendarClock },
  mixed: { label: "A bit of each", hint: "More than one of these", icon: Layers },
};

// ── Vibes ───────────────────────────────────────────────────────────────

const VIBE_LABELS: Record<StorefrontVibe, string> = {
  minimal: "Minimal",
  warm: "Warm",
  bold: "Bold",
  playful: "Playful",
  luxe: "Luxe",
  classic: "Classic",
};

/**
 * A miniature of what the vibe actually does: its canvas colour, its accent,
 * its corner roundness and its gutter, on three stand-in tiles.
 *
 * Radius and gap are divided down because the swatch is roughly a third of a
 * real tile. Passing the raw values through would clamp every rounded preset
 * into circles and make them indistinguishable, which is the one thing this
 * control exists to avoid.
 */
function VibeSwatch({ vibe }: { vibe: StorefrontVibe }) {
  const preset = VIBE_PRESETS[vibe];
  const canvas =
    preset.background.kind === "solid" ? preset.background.color : "#ffffff";

  return (
    <div
      aria-hidden="true"
      className="flex h-14 w-full items-center justify-center border border-border"
      style={{
        backgroundColor: canvas,
        gap: `${Math.round(preset.gridGap / 2)}px`,
      }}
    >
      {[1, 0.65, 0.35].map((opacity, index) => (
        <span
          key={index}
          className="block size-5"
          style={{
            backgroundColor: preset.accent,
            opacity,
            borderRadius: `${preset.cornerRadius / 3}px`,
          }}
        />
      ))}
    </div>
  );
}

// ── The tile grid ───────────────────────────────────────────────────────

/**
 * One answer. Sharp-cornered like every button in the app; the selected state
 * is a solid border plus the accent fill, matching OptionCardPicker so the two
 * pickers never drift into different looks.
 */
function ChoiceTile({
  selected,
  onSelect,
  label,
  hint,
  labelClassName,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  label: string;
  hint?: string;
  /** Extra classes on the label, e.g. the vibe's own typeface. */
  labelClassName?: string;
  /** The glyph or swatch above the label. */
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "flex flex-col items-center gap-1.5 rounded-none border p-3 text-center",
        "transition-colors duration-base ease-standard motion-reduce:transition-none",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        selected
          ? "border-foreground bg-accent"
          : "border-border hover:bg-accent/50",
      )}
    >
      {children}
      <span
        className={cn(
          "text-sm leading-tight",
          labelClassName ?? "font-inter",
          selected ? "font-medium text-foreground" : "text-muted-foreground",
        )}
      >
        {label}
      </span>
      {hint && (
        <span className="font-inter text-xs leading-tight text-muted-foreground">
          {hint}
        </span>
      )}
    </button>
  );
}

function TileIcon({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <Icon
      className="size-5 text-foreground"
      strokeWidth={1.5}
      aria-hidden="true"
    />
  );
}

export function CategoryGrid({
  value,
  onChange,
}: {
  value: StorefrontCategory | null;
  onChange: (value: StorefrontCategory) => void;
}) {
  return (
    <div
      role="group"
      aria-label="What you sell"
      className="grid grid-cols-2 gap-2 sm:grid-cols-3"
    >
      {STOREFRONT_CATEGORIES.map((category) => (
        <ChoiceTile
          key={category}
          selected={value === category}
          onSelect={() => onChange(category)}
          label={CATEGORY_META[category].label}
        >
          <TileIcon icon={CATEGORY_META[category].icon} />
        </ChoiceTile>
      ))}
    </div>
  );
}

export function FulfilmentGrid({
  value,
  onChange,
}: {
  value: StorefrontFulfilment | null;
  onChange: (value: StorefrontFulfilment) => void;
}) {
  return (
    <div
      role="group"
      aria-label="How buyers get it"
      className="grid grid-cols-2 gap-2"
    >
      {STOREFRONT_FULFILMENTS.map((fulfilment) => (
        <ChoiceTile
          key={fulfilment}
          selected={value === fulfilment}
          onSelect={() => onChange(fulfilment)}
          label={FULFILMENT_META[fulfilment].label}
          hint={FULFILMENT_META[fulfilment].hint}
        >
          <TileIcon icon={FULFILMENT_META[fulfilment].icon} />
        </ChoiceTile>
      ))}
    </div>
  );
}

export function VibeGrid({
  value,
  onChange,
}: {
  value: StorefrontVibe | null;
  onChange: (value: StorefrontVibe) => void;
}) {
  return (
    <div
      role="group"
      aria-label="The look you want"
      className="grid grid-cols-2 gap-2 sm:grid-cols-3"
    >
      {STOREFRONT_VIBES.map((vibe) => (
        <ChoiceTile
          key={vibe}
          selected={value === vibe}
          onSelect={() => onChange(vibe)}
          label={VIBE_LABELS[vibe]}
          // Set in its own typeface, so the label doubles as a specimen.
          labelClassName={FONT_CLASSES[VIBE_PRESETS[vibe].font]}
        >
          <VibeSwatch vibe={vibe} />
        </ChoiceTile>
      ))}
    </div>
  );
}
