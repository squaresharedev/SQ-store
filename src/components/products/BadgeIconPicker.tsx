"use client";

import { useState, type KeyboardEvent } from "react";
import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import {
  focusRingClass,
  panelEyebrowClass,
  transitionClass,
} from "@/components/ui/control-styles";
import { Popover } from "@/components/ui/Popover";
import {
  BADGE_COLOR_SHADES,
  BADGE_ICON_COMPONENTS,
  badgeIconColor,
} from "@/components/product-page/badge-icons";
import { DARK_INK } from "@/components/product-page/product-page-maps";
import { BADGE_COLORS, BADGE_ICONS, type BadgeColor, type BadgeIcon } from "@/types/product";

/** How many icons a row of the grid holds, which is also what Up and Down
 *  step by. */
const ICON_COLUMNS = 6;

/** Arrow keys walk a grid of buttons `columns` wide. */
function gridKeys(columns: number) {
  return (event: KeyboardEvent<HTMLDivElement>) => {
    const step =
      event.key === "ArrowRight" ? 1
      : event.key === "ArrowLeft" ? -1
      : event.key === "ArrowDown" ? columns
      : event.key === "ArrowUp" ? -columns
      : 0;
    if (step === 0) return;
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = buttons[at + step];
    if (!next) return;
    event.preventDefault();
    next.focus();
  };
}

/**
 * A badge's icon and its colour: the coloured drawing itself is the button,
 * and it opens the closed list of drawings (in the chosen colour, so the
 * seller sees what they get) above the palette. Every choice is named for a
 * screen reader, the chosen ones are pressed, and the arrow keys walk each
 * group. An icon closes the panel; a colour does not, so both can be chosen in
 * one visit.
 */
export function BadgeIconPicker({
  id,
  value,
  color,
  label,
  onChange,
  onColorChange,
}: {
  id: string;
  value: BadgeIcon;
  color: BadgeColor;
  /** The trigger's accessible name ("Icon and colour for badge 2"). */
  label: string;
  onChange: (icon: BadgeIcon) => void;
  onColorChange: (color: BadgeColor) => void;
}) {
  const t = useTranslations("Products.badgesField");
  const [open, setOpen] = useState(false);
  const Current = BADGE_ICON_COMPONENTS[value];
  // The dashboard is a light page: the same shade a light product page uses.
  const tint = badgeIconColor(color, DARK_INK);

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      label={t("stylePicker")}
      // One square beside the badge's words: it must not take the row (see
      // Popover's own note on its root).
      rootClassName="w-auto shrink-0"
      // As wide as the grid, NOT "auto": the panel is positioned against this
      // 32px root, and an auto width would squeeze six columns into it until
      // the drawings sat on top of each other.
      panelClassName="sm:w-max"
      trigger={
        <button
          id={id}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={label}
          title={label}
          onClick={() => setOpen((was) => !was)}
          data-product-badge-icon={value}
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-sm border border-border bg-background hover:bg-accent",
            transitionClass,
            focusRingClass,
          )}
        >
          <Current className="size-4" strokeWidth={2} style={{ color: tint }} aria-hidden="true" />
        </button>
      }
    >
      <div className="mx-auto flex w-max flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <p className={panelEyebrowClass} aria-hidden="true">
            {t("iconHeading")}
          </p>
          <div
            role="group"
            aria-label={t("iconPicker")}
            className="grid grid-cols-6 gap-1"
            onKeyDown={gridKeys(ICON_COLUMNS)}
          >
            {BADGE_ICONS.map((icon) => {
              const Glyph = BADGE_ICON_COMPONENTS[icon];
              const chosen = icon === value;
              return (
                <button
                  key={icon}
                  type="button"
                  aria-label={t(`icons.${icon}`)}
                  title={t(`icons.${icon}`)}
                  aria-pressed={chosen}
                  data-autofocus={chosen ? "" : undefined}
                  data-badge-icon-choice={icon}
                  onClick={() => {
                    onChange(icon);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex size-10 items-center justify-center rounded-sm",
                    chosen ? "bg-foreground text-background" : "hover:bg-accent",
                    transitionClass,
                    focusRingClass,
                  )}
                >
                  <Glyph
                    className="size-4"
                    strokeWidth={2}
                    style={chosen ? undefined : { color: tint }}
                    aria-hidden="true"
                  />
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <p className={panelEyebrowClass} aria-hidden="true">
            {t("colorHeading")}
          </p>
          <div
            role="group"
            aria-label={t("colorPicker")}
            className="flex flex-wrap gap-1.5"
            onKeyDown={gridKeys(BADGE_COLORS.length)}
          >
            {BADGE_COLORS.map((choice) => {
              const chosen = choice === color;
              const ink = choice === "ink";
              return (
                <button
                  key={choice}
                  type="button"
                  aria-label={t(`colors.${choice}`)}
                  title={t(`colors.${choice}`)}
                  aria-pressed={chosen}
                  data-badge-color-choice={choice}
                  onClick={() => onColorChange(choice)}
                  className={cn(
                    "flex size-7 items-center justify-center rounded-full",
                    // The page's own ink has no colour of its own to show, so
                    // it is drawn as an outlined ring rather than a fill.
                    ink && "border-2 border-foreground bg-background",
                    chosen && "ring-2 ring-foreground ring-offset-2 ring-offset-background",
                    transitionClass,
                    focusRingClass,
                  )}
                  style={ink ? undefined : { backgroundColor: BADGE_COLOR_SHADES[choice].onLight }}
                >
                  {chosen && (
                    <Check
                      className={cn("size-3.5", ink ? "text-foreground" : "text-background")}
                      strokeWidth={3}
                      aria-hidden="true"
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </Popover>
  );
}
