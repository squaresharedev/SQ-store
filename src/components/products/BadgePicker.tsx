"use client";

import { useId, useState, type KeyboardEvent, type Ref } from "react";
import { Check, Plus, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import {
  chipButtonClass,
  fieldBaseClass,
  infoTextClass,
  panelEyebrowClass,
} from "@/components/ui/control-styles";
import { ActionErrorNotice } from "@/components/ui/ActionErrorNotice";
import { Popover } from "@/components/ui/Popover";
import { Spinner } from "@/components/ui/spinner";
import { BADGE_ICON_COMPONENTS, badgeIconColor } from "@/components/product-page/badge-icons";
import { DARK_INK } from "@/components/product-page/product-page-maps";
import { unexpectedError, type ActionError } from "@/lib/errors";
import { checkBadgeLabel } from "@/lib/products/badge-actions";
import {
  BADGE_PRESET_GROUPS,
  guessBadgeStyle,
  hasBadgeLabel,
  hasPresetBadge,
  findBadgePresets,
  type BadgePresetGroup,
  type LocalBadgePreset,
} from "@/lib/products/badges";
import { badgeLabelKey } from "@/lib/validation/product";
import { BADGE_LABEL_MAX, type BadgeColor, type BadgeIcon, type ProductBadge } from "@/types/product";

/** One row of the list: a ready-made badge, or the seller's own words. */
type Choice =
  | { kind: "preset"; preset: LocalBadgePreset; added: boolean }
  | { kind: "create"; label: string };

/**
 * FIND A BADGE, OR WRITE ONE. One field does both: what is typed searches the
 * ready-made badges (in the seller's language, by their words and by the words
 * people search for them with), and the last row offers the typed words as a
 * badge of their own.
 *
 * A badge the seller wrote is CHECKED BEFORE IT IS ADDED (checkBadgeLabel), so
 * one that breaks the rules never joins the product at all; the row says
 * "Checking" meanwhile and the reason appears under the field if it is
 * refused. Ready-made badges need no check here; the save judges every badge
 * anyway.
 *
 * A combobox: the field keeps focus, the arrow keys walk the rows, Enter picks
 * one, Escape closes. On a phone the panel is a bottom sheet (Popover).
 */
export function BadgePicker({
  inputId,
  presets,
  badges,
  disabled,
  onAdd,
  triggerRef,
}: {
  inputId: string;
  presets: readonly LocalBadgePreset[];
  /** What the product already carries, so a preset can show as added and the
   *  same words cannot be created twice. */
  badges: readonly Pick<ProductBadge, "label">[];
  /** No room for another badge. */
  disabled: boolean;
  onAdd: (badge: { icon: BadgeIcon; label: string; color: BadgeColor }, preset: LocalBadgePreset | null) => void;
  /** So the field can hand focus back here after a one-click add. */
  triggerRef?: Ref<HTMLButtonElement>;
}) {
  const t = useTranslations("Products.badgesField.picker");
  const listboxId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // The row the arrow keys moved to; null until they do, which means the
  // row Enter would take on its own (see defaultIndex).
  const [active, setActive] = useState<number | null>(null);
  const [checking, setChecking] = useState(false);
  const [refusal, setRefusal] = useState<ActionError | null>(null);

  const words = query.trim();
  const found = findBadgePresets(presets, words);
  const results = words ? found.presets : null;
  const sections: { group: BadgePresetGroup | null; presets: LocalBadgePreset[] }[] =
    results === null
      ? BADGE_PRESET_GROUPS.map((group) => ({
          group,
          presets: presets.filter((preset) => preset.group === group),
        }))
      : [{ group: null, presets: results }];
  const isPreset = words !== "" && presets.some((preset) => badgeLabelKey(preset.label) === badgeLabelKey(words));
  const alreadyOn = words !== "" && hasBadgeLabel(badges, words);
  const canCreate = words !== "" && !isPreset && !alreadyOn;

  // Every row in display order, numbered once: the number is what the arrow
  // keys move and what aria-activedescendant names.
  const grouped = sections.map((section, sectionIndex) => ({
    group: section.group,
    choices: section.presets.map(
      (preset): Choice => ({ kind: "preset", preset, added: hasPresetBadge(badges, preset) }),
    ),
    offset: sections
      .slice(0, sectionIndex)
      .reduce((total, earlier) => total + earlier.presets.length, 0),
  }));
  const choices: Choice[] = [
    ...grouped.flatMap((section) => section.choices),
    ...(canCreate ? [{ kind: "create", label: words } as const] : []),
  ];
  const pickable = (choice: Choice | undefined) =>
    choice !== undefined && !(choice.kind === "preset" && choice.added);
  // The highlighted row, kept on something that can be picked.
  const firstPickable = choices.findIndex(pickable);
  // Enter takes a preset only when it answers everything typed; otherwise the
  // seller is writing their own badge, and their words are what Enter adds.
  const defaultIndex = canCreate && !found.complete ? choices.length - 1 : firstPickable;
  const activeIndex = active !== null && pickable(choices[active]) ? active : defaultIndex;
  const optionId = (index: number) => `${listboxId}-option-${index}`;

  function close() {
    setOpen(false);
    setQuery("");
    setActive(null);
    setRefusal(null);
  }

  function changeQuery(next: string) {
    setQuery(next);
    setActive(null);
    setRefusal(null);
  }

  async function create(label: string) {
    if (checking) return;
    setChecking(true);
    setRefusal(null);
    try {
      const result = await checkBadgeLabel(label);
      if (!result.ok) {
        setRefusal(result.error);
        return;
      }
      onAdd({ ...guessBadgeStyle(presets, label), label }, null);
      close();
    } catch (error) {
      setRefusal(unexpectedError(error instanceof Error ? error.message : undefined));
    } finally {
      setChecking(false);
    }
  }

  function choose(choice: Choice) {
    if (!pickable(choice)) return;
    if (choice.kind === "create") {
      void create(choice.label);
      return;
    }
    onAdd({ icon: choice.preset.icon, label: choice.preset.label, color: choice.preset.color }, choice.preset);
    close();
  }

  function step(direction: 1 | -1) {
    if (firstPickable === -1) return;
    let next = activeIndex;
    for (let tries = 0; tries < choices.length; tries += 1) {
      next = (next + direction + choices.length) % choices.length;
      if (pickable(choices[next])) break;
    }
    setActive(next);
    document.getElementById(optionId(next))?.scrollIntoView?.({ block: "nearest" });
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      step(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      step(-1);
    } else if (event.key === "Enter") {
      // Never the form's submit: Enter here means "this one".
      event.preventDefault();
      const choice = choices[activeIndex];
      if (choice) choose(choice);
    }
  }

  const row = (choice: Choice, at: number) => {
    const isActive = at === activeIndex;
    const Icon =
      choice.kind === "preset"
        ? BADGE_ICON_COMPONENTS[choice.preset.icon]
        : checking
          ? null
          : Plus;
    return (
      <div
        key={choice.kind === "preset" ? choice.preset.id : "create"}
        id={optionId(at)}
        role="option"
        aria-selected={isActive}
        aria-disabled={choice.kind === "preset" && choice.added ? true : undefined}
        data-badge-choice={choice.kind === "preset" ? choice.preset.id : "create"}
        // The field keeps focus while the pointer picks, so typing can go on.
        onMouseDown={(event) => event.preventDefault()}
        onMouseMove={() => pickable(choice) && setActive(at)}
        onClick={() => choose(choice)}
        className={cn(
          "flex min-h-10 cursor-pointer items-center gap-2.5 px-2.5 py-1.5 font-inter text-sm text-foreground",
          isActive && "bg-accent",
          choice.kind === "preset" && choice.added && "cursor-default text-muted-foreground",
        )}
      >
        {Icon ? (
          <Icon
            className="size-4 shrink-0"
            strokeWidth={2}
            style={choice.kind === "preset" ? { color: badgeIconColor(choice.preset.color, DARK_INK) } : undefined}
            aria-hidden="true"
          />
        ) : (
          <Spinner className="size-4 shrink-0" />
        )}
        <span className="min-w-0 flex-1 break-words">
          {choice.kind === "preset"
            ? choice.preset.label
            : checking
              ? t("checking")
              : t("create", { label: choice.label })}
        </span>
        {choice.kind === "preset" && choice.added && (
          <span className={cn(infoTextClass, "flex shrink-0 items-center gap-1")}>
            <Check className="size-3.5" strokeWidth={2} aria-hidden="true" />
            {t("added")}
          </span>
        )}
      </div>
    );
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => (next ? setOpen(true) : close())}
      label={t("label")}
      rootClassName="w-auto"
      panelClassName="sm:w-[22rem]"
      trigger={
        <button
          ref={triggerRef}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          disabled={disabled}
          onClick={() => (open ? close() : setOpen(true))}
          data-product-badge-picker=""
          className={chipButtonClass}
        >
          <Search className="size-3.5" strokeWidth={2} aria-hidden="true" />
          {t("open")}
        </button>
      }
    >
      <div className="flex flex-col gap-2">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            strokeWidth={2}
            aria-hidden="true"
          />
          <input
            id={`${inputId}-search`}
            type="text"
            role="combobox"
            aria-label={t("search")}
            aria-autocomplete="list"
            aria-expanded="true"
            aria-controls={listboxId}
            aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
            aria-describedby={refusal ? `${inputId}-refusal` : undefined}
            autoComplete="off"
            enterKeyHint="done"
            data-autofocus=""
            data-product-badge-search=""
            value={query}
            maxLength={BADGE_LABEL_MAX}
            readOnly={checking}
            placeholder={t("placeholder")}
            onChange={(event) => changeQuery(event.target.value)}
            onKeyDown={onKeyDown}
            className={cn(fieldBaseClass, "py-2 pl-9 text-sm")}
          />
        </div>
        {alreadyOn && <p className={infoTextClass}>{t("alreadyOn")}</p>}
        {refusal && (
          <div id={`${inputId}-refusal`} data-product-badge-refusal={refusal.code}>
            <ActionErrorNotice error={refusal} variant="inline" />
          </div>
        )}
        <div
          id={listboxId}
          role="listbox"
          aria-label={t("results")}
          className="-mx-1 max-h-[45vh] overflow-y-auto px-1 sm:max-h-80"
        >
          {grouped.map((section) => {
            const rows = section.choices.map((choice, position) => row(choice, section.offset + position));
            if (!section.group) return rows;
            const headingId = `${listboxId}-${section.group}`;
            return (
              <div key={section.group} role="presentation" className="pb-1">
                <div id={headingId} role="presentation" className={cn(panelEyebrowClass, "px-2.5 pb-1 pt-2")}>
                  {t(`groups.${section.group}`)}
                </div>
                <div role="group" aria-labelledby={headingId}>
                  {rows}
                </div>
              </div>
            );
          })}
          {canCreate && row({ kind: "create", label: words }, choices.length - 1)}
        </div>
        {results !== null && results.length === 0 && !canCreate && !alreadyOn && (
          <p className={infoTextClass}>{t("noMatches")}</p>
        )}
      </div>
    </Popover>
  );
}
