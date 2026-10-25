"use client";

import { useEffect, useRef } from "react";
import { ChevronDown, ChevronUp, Plus, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import {
  chipButtonClass,
  errorTextClass,
  infoTextClass,
  labelClass,
  rowFieldClass,
} from "@/components/ui/control-styles";
import {
  BADGE_PRESETS,
  DEFAULT_BADGE_PLACEMENT,
  canPlaceBadge,
  countRange,
  hasBadgeLabel,
  hasPresetBadge,
  roomForBadge,
  splitKeywords,
  type BadgePresetId,
  type LocalBadgePreset,
} from "@/lib/products/badges";
import { badgeLabelKey } from "@/lib/validation/product";
import { BADGE_LABEL_MAX, BADGES_MAX, type BadgePlacement, type ProductBadge } from "@/types/product";
import { BadgeIconPicker } from "./BadgeIconPicker";
import { BadgePicker } from "./BadgePicker";
import { BadgePlacementPicker } from "./BadgePlacementPicker";
import { BadgePlacementPreview } from "./BadgePlacementPreview";
import { RowButton } from "./RowButton";
import type { BadgeFormValue } from "./form-values";

/** The one-click badges offered beside the search, before any are added: the
 *  four most sellers reach for, one per kind of claim (people, planet, craft,
 *  delivery). A suggestion already on the product is not offered again. */
const SUGGESTED: readonly BadgePresetId[] = ["lovedBy", "ecoFriendly", "handmade", "freeShipping"];

/** The ready-made badges in the seller's language, numbers filled in. */
export function useLocalBadgePresets(): LocalBadgePreset[] {
  const t = useTranslations("Products.badges.presets");
  const locale = useLocale();
  return BADGE_PRESETS.map((preset) => {
    const count = "count" in preset ? preset.count : undefined;
    return {
      id: preset.id,
      icon: preset.icon,
      color: preset.color,
      group: preset.group,
      label: count === undefined ? t(`${preset.id}.label`) : t(`${preset.id}.label`, { count }),
      keywords: splitKeywords(t(`${preset.id}.keywords`)),
      // Formatted the way ICU prints the "#" in the label, so it can be found.
      countText: count === undefined ? null : new Intl.NumberFormat(locale).format(count),
    };
  });
}

/** Where focus goes once the list has re-rendered after an add or a remove. */
type PendingFocus =
  | { kind: "row"; localId: string; range: [number, number] | null }
  | { kind: "picker" };

/**
 * BADGES: a few short words at the top of the product page.
 *
 * The fewest interactions win here, as in OptionsField: the common badges are
 * one click, everything else is one search away, and the seller's own words
 * are typed into the same search. Whatever arrives is an ordinary row: the
 * words edit in place, the icon and its colour are a click, where it goes is a
 * click, and order is two arrows. A ready-made badge with a number in it
 * ("Loved by 1,000+ people") lands with the number selected, so the seller's
 * first keystroke makes it theirs.
 *
 * Above the rows, the page in miniature: the photo and the space beside the
 * product, with each badge where the buyer will see it, dragged between them.
 */
export function BadgesField({
  inputId,
  badges,
  onChange,
  error,
  previewImageUrl = null,
  previewTitle = "",
}: {
  inputId: string;
  badges: BadgeFormValue[];
  onChange: (next: BadgeFormValue[]) => void;
  error?: string;
  /** The cover photo as the form holds it now, for the preview. */
  previewImageUrl?: string | null;
  /** The title as typed so far, for the preview. */
  previewTitle?: string;
}) {
  const t = useTranslations("Products.badgesField");
  const presets = useLocalBadgePresets();
  const room = roomForBadge(badges.length);
  const labelInputs = useRef(new Map<string, HTMLInputElement>());
  const pickerTrigger = useRef<HTMLButtonElement>(null);
  const pendingFocus = useRef<PendingFocus | null>(null);

  // After the list re-renders: the row just added (its number selected), or
  // back to the search when the button that was pressed has gone away.
  useEffect(() => {
    const pending = pendingFocus.current;
    if (!pending) return;
    pendingFocus.current = null;
    const input = pending.kind === "row" ? labelInputs.current.get(pending.localId) : undefined;
    if (input) {
      input.focus();
      if (pending.kind === "row" && pending.range) input.setSelectionRange(...pending.range);
      return;
    }
    const trigger = pickerTrigger.current;
    if (trigger && !trigger.disabled) {
      trigger.focus();
      return;
    }
    // A full list has no search to go back to: the last row is the place.
    [...labelInputs.current.values()].at(-1)?.focus();
  }, [badges]);

  function add(
    badge: Required<Pick<ProductBadge, "icon" | "label" | "color">>,
    preset: LocalBadgePreset | null,
    from: "picker" | "suggestion",
  ) {
    if (!room || hasBadgeLabel(badges, badge.label)) return;
    const localId = crypto.randomUUID();
    const range = preset ? countRange(preset) : null;
    pendingFocus.current = range
      ? { kind: "row", localId, range }
      : from === "suggestion"
        ? { kind: "picker" }
        : null;
    onChange([...badges, { localId, ...badge, placement: DEFAULT_BADGE_PLACEMENT }]);
  }

  function update(localId: string, patch: Partial<Omit<BadgeFormValue, "localId">>) {
    onChange(badges.map((badge) => (badge.localId === localId ? { ...badge, ...patch } : badge)));
  }

  /** Whether one badge may go to a place, given where all the others are. */
  const canPlace = (badge: BadgeFormValue, placement: BadgePlacement) =>
    canPlaceBadge(badges, badge, placement);

  function move(index: number, direction: -1 | 1) {
    const to = index + direction;
    if (to < 0 || to >= badges.length) return;
    const next = badges.slice();
    [next[index], next[to]] = [next[to]!, next[index]!];
    onChange(next);
  }

  function remove(index: number) {
    // The row's own buttons go with it, so focus moves to its neighbour.
    const neighbour = badges[index + 1] ?? badges[index - 1];
    pendingFocus.current = neighbour
      ? { kind: "row", localId: neighbour.localId, range: null }
      : { kind: "picker" };
    onChange(badges.filter((_, at) => at !== index));
  }

  // A later row repeating an earlier one's words is the one marked.
  const seen = new Set<string>();
  const repeats = new Set<string>();
  for (const badge of badges) {
    const key = badgeLabelKey(badge.label);
    if (!key) continue;
    if (seen.has(key)) repeats.add(badge.localId);
    seen.add(key);
  }

  const suggestions = presets.filter(
    (preset) => SUGGESTED.includes(preset.id) && !hasPresetBadge(badges, preset),
  );

  return (
    <div className="space-y-4" data-product-field="badges" data-product-value={badges.length}>
      {badges.length > 0 && (
        <BadgePlacementPreview
          badges={badges}
          imageUrl={previewImageUrl}
          title={previewTitle}
          canPlace={canPlace}
          onPlace={(localId, placement) => update(localId, { placement })}
        />
      )}
      {badges.length > 0 && (
        <ul
          // NOT overflow-hidden: the icon popover opens inside a row (see
          // OptionsField's list for the same reason).
          className={cn(
            "divide-y divide-border rounded-sm border border-border",
            "[&>li:first-child]:rounded-t-sm [&>li:last-child]:rounded-b-sm",
          )}
          aria-label={t("listLabel")}
        >
          {badges.map((badge, index) => {
            const position = index + 1;
            const fieldId = `${inputId}-label-${badge.localId}`;
            return (
              <li
                key={badge.localId}
                className={cn(
                  "group/row flex items-center gap-2 px-2 py-1.5 transition-colors duration-base ease-standard motion-reduce:transition-none",
                  "hover:bg-accent/40 has-[:focus-visible]:bg-accent/40",
                )}
                data-product-badge-row={index}
              >
                {/* The picker takes no data-* of its own, so the datapoints
                    sit on this wrapper. */}
                <span
                  className="flex shrink-0"
                  data-product-field={`badge.${index}.icon`}
                  data-product-value={badge.icon}
                >
                  <span className="contents" data-product-field={`badge.${index}.color`} data-product-value={badge.color}>
                    <BadgeIconPicker
                      id={`${inputId}-icon-${badge.localId}`}
                      value={badge.icon}
                      color={badge.color}
                      label={t("iconFor", { position })}
                      onChange={(icon) => update(badge.localId, { icon })}
                      onColorChange={(color) => update(badge.localId, { color })}
                    />
                  </span>
                </span>
                <label htmlFor={fieldId} className="sr-only">
                  {t("labelFor", { position })}
                </label>
                <input
                  id={fieldId}
                  ref={(node) => {
                    if (node) labelInputs.current.set(badge.localId, node);
                    else labelInputs.current.delete(badge.localId);
                  }}
                  type="text"
                  value={badge.label}
                  maxLength={BADGE_LABEL_MAX}
                  placeholder={t("labelPlaceholder")}
                  aria-invalid={repeats.has(badge.localId) ? true : undefined}
                  onChange={(event) => update(badge.localId, { label: event.target.value })}
                  data-product-field={`badge.${index}.label`}
                  data-product-badge-label=""
                  className={cn(rowFieldClass, "text-sm")}
                />
                <span
                  className="flex shrink-0"
                  data-product-field={`badge.${index}.placement`}
                  data-product-value={badge.placement}
                >
                  <BadgePlacementPicker
                    id={`${inputId}-place-${badge.localId}`}
                    value={badge.placement}
                    label={t("placementFor", { position })}
                    canPlace={(placement) => canPlace(badge, placement)}
                    onChange={(placement) => update(badge.localId, { placement })}
                  />
                </span>
                <div className="flex items-center">
                  <RowButton
                    label={t("moveEarlier", { position })}
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    <ChevronUp className="size-4" strokeWidth={2} aria-hidden="true" />
                  </RowButton>
                  <RowButton
                    label={t("moveLater", { position })}
                    disabled={index === badges.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <ChevronDown className="size-4" strokeWidth={2} aria-hidden="true" />
                  </RowButton>
                  <RowButton label={t("remove", { position })} destructive onClick={() => remove(index)}>
                    <X className="size-4" strokeWidth={2} aria-hidden="true" />
                  </RowButton>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {room ? (
        <div className="space-y-2">
          <p className={cn(labelClass, "text-xs")}>
            {badges.length === 0 ? t("addFirst") : t("addAnother")}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {suggestions.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className={chipButtonClass}
                onClick={() =>
                  add({ icon: preset.icon, label: preset.label, color: preset.color }, preset, "suggestion")
                }
                data-badge-suggestion={preset.id}
              >
                <Plus className="size-3.5" strokeWidth={2} aria-hidden="true" />
                {preset.label}
              </button>
            ))}
            <BadgePicker
              inputId={`${inputId}-picker`}
              presets={presets}
              badges={badges}
              disabled={!room}
              onAdd={(badge, preset) => add(badge, preset, "picker")}
              triggerRef={pickerTrigger}
            />
          </div>
        </div>
      ) : (
        <p className={infoTextClass} data-product-badges-full="">
          {t("full", { max: BADGES_MAX })}
        </p>
      )}

      {error && (
        <p className={errorTextClass} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
