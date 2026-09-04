"use client";

import {
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { ChevronDown, ChevronUp, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  fieldBaseClass,
  focusRingClass,
  infoTextClass,
  labelClass,
  secondaryButtonClass,
  transitionClass,
} from "@/components/ui/control-styles";
import { ColorPicker } from "@/components/ui/ColorPicker";
import { InfoTip } from "@/components/ui/InfoTip";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Switch } from "@/components/ui/switch";
import {
  OPTION_GROUP_PRESETS,
  addOptions,
  defaultDisplayFor,
  groupFromPreset,
  splitOptionInput,
  type OptionGroupPreset,
} from "@/lib/products/option-presets";
import {
  OPTION_GROUP_NAME_MAX,
  OPTION_GROUPS_MAX,
  OPTION_NAME_MAX,
  OPTIONS_PER_GROUP_MAX,
  OPTIONS_TOTAL_MAX,
  type OptionDisplay,
  type ProductOptionGroup,
} from "@/types/product";

/** The neutral chip an option with no swatch renders as; shown in the picker
 *  as what "no swatch" currently looks like. */
const NO_SWATCH = "#e5e5e5";

const DISPLAY_OPTIONS: readonly { value: OptionDisplay; label: string }[] = [
  { value: "swatch", label: "Swatches" },
  { value: "chip", label: "Chips" },
  { value: "select", label: "Dropdown" },
];

const DISPLAY_HINTS: Record<OptionDisplay, string> = {
  swatch: "Colour circles. Give each option a swatch, or buyers see its first letter.",
  chip: "Text buttons, for values buyers read: sizes, wattages, lengths.",
  select: "A dropdown. Best when there are more values than fit as buttons.",
};

/**
 * OPTIONS: the axes a product is sold along, and the choices along each.
 *
 * The seller names the axis, so a shirt shop gets Colour and Size while a
 * motor shop gets Power output and Shaft length, with no hard-coded idea of
 * what a "variant" is anywhere in the product.
 *
 * THE WHOLE DESIGN GOAL HERE IS THE NUMBER OF INTERACTIONS. Adding six sizes
 * used to be six "Add" clicks and six focus moves; here a preset button fills
 * them in one click, and any list can be pasted in as "S, M, L, XL" and split
 * on commas, newlines and tabs — which is the form the values are already in,
 * in the spreadsheet or supplier sheet the seller is copying from. Everything
 * beyond that (renaming, reordering, swatches, marking one sold out) is an
 * edit on a row that already exists.
 *
 * Ids are minted here so a photo can be tied to an option before either has
 * been saved.
 */
export function OptionsField({
  inputId,
  groups,
  onChange,
  error,
}: {
  inputId: string;
  groups: ProductOptionGroup[];
  onChange: (groups: ProductOptionGroup[]) => void;
  error?: string;
}) {
  const totalOptions = groups.reduce((total, group) => total + group.options.length, 0);
  const roomForGroup = groups.length < OPTION_GROUPS_MAX && totalOptions < OPTIONS_TOTAL_MAX;

  function updateGroup(id: string, next: ProductOptionGroup) {
    onChange(groups.map((group) => (group.id === id ? next : group)));
  }

  function addPreset(preset: OptionGroupPreset) {
    if (!roomForGroup) return;
    // Trimmed to the total cap, so clicking "Size" with 45 options already
    // present adds three rather than being refused outright.
    const room = OPTIONS_TOTAL_MAX - totalOptions;
    const group = groupFromPreset(
      { ...preset, values: preset.values.slice(0, room) },
      () => crypto.randomUUID(),
    );
    onChange([...groups, group]);
  }

  /** Move a group among its siblings: the order the page prints them in. */
  function moveGroup(id: string, direction: -1 | 1) {
    const at = groups.findIndex((group) => group.id === id);
    const to = at + direction;
    if (at === -1 || to < 0 || to >= groups.length) return;
    const next = groups.slice();
    [next[at], next[to]] = [next[to]!, next[at]!];
    onChange(next);
  }

  // Presets already on the product are dropped rather than disabled: a row of
  // greyed-out buttons is noise, and a second "Colour" group is almost always
  // a misclick rather than an intent.
  const taken = new Set(groups.map((group) => group.name.trim().toLowerCase()));
  const available = OPTION_GROUP_PRESETS.filter(
    (preset) => !taken.has(preset.name.toLowerCase()),
  );

  return (
    <div className="space-y-4" data-product-field="optionGroups" data-product-value={groups.length}>
      {groups.map((group, index) => (
        <OptionGroupEditor
          key={group.id}
          inputId={`${inputId}-${group.id}`}
          group={group}
          position={index}
          count={groups.length}
          totalOptions={totalOptions}
          onChange={(next) => updateGroup(group.id, next)}
          onMove={(direction) => moveGroup(group.id, direction)}
          onRemove={() => onChange(groups.filter((candidate) => candidate.id !== group.id))}
        />
      ))}

      {roomForGroup ? (
        <div className="space-y-2">
          <p className={cn(labelClass, "text-xs")}>
            {groups.length === 0 ? "Sold in more than one version?" : "Add another way it varies"}
          </p>
          <div className="flex flex-wrap gap-2">
            {available.map((preset) => (
              <button
                key={preset.name}
                type="button"
                className={cn(secondaryButtonClass, "px-3 py-1.5 text-xs")}
                onClick={() => addPreset(preset)}
              >
                <Plus className="size-3.5" strokeWidth={2} aria-hidden="true" />
                {preset.name}
              </button>
            ))}
            <button
              type="button"
              className={cn(secondaryButtonClass, "px-3 py-1.5 text-xs")}
              onClick={() =>
                addPreset({ name: "", display: "chip", values: [], placeholder: "First option" })
              }
            >
              <Plus className="size-3.5" strokeWidth={2} aria-hidden="true" />
              Something else
            </button>
          </div>
        </div>
      ) : (
        <p className={infoTextClass}>
          {groups.length >= OPTION_GROUPS_MAX
            ? `That is all ${OPTION_GROUPS_MAX} option groups.`
            : `That is all ${OPTIONS_TOTAL_MAX} options.`}
        </p>
      )}

      {error && (
        <p className="font-inter text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * A row's own control: reorder, remove.
 *
 * Borderless, and dimmed until the row is hovered or something in it takes
 * focus. Three bordered boxes per row, times five options, times two groups is
 * thirty little squares competing with the five names that are the actual
 * content — but they still have to be reachable by keyboard the moment they
 * are tabbed to, which is what `group-has-[:focus-visible]` buys that a plain
 * hover rule would not.
 */
function RowButton({
  label,
  onClick,
  disabled,
  destructive,
  groupName = "row",
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
  /** Which named group reveals it: an option `row`, or the whole `group` card.
   *  Both class strings are spelled out because Tailwind cannot see a computed
   *  `group-hover/${name}`. */
  groupName?: "row" | "group";
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        "flex size-7 items-center justify-center rounded-sm text-muted-foreground",
        "focus-visible:opacity-100 disabled:pointer-events-none disabled:opacity-0",
        groupName === "row"
          ? "opacity-0 group-hover/row:opacity-100 group-has-[:focus-visible]/row:opacity-100"
          : "opacity-0 group-hover/group:opacity-100 group-has-[:focus-visible]/group:opacity-100",
        destructive
          ? "hover:bg-destructive/10 hover:text-destructive"
          : "hover:bg-accent hover:text-foreground",
        transitionClass,
        focusRingClass,
      )}
    >
      {children}
    </button>
  );
}

/** One axis: its name, how it draws, and its choices. */
function OptionGroupEditor({
  inputId,
  group,
  position,
  count,
  totalOptions,
  onChange,
  onMove,
  onRemove,
}: {
  inputId: string;
  group: ProductOptionGroup;
  position: number;
  count: number;
  totalOptions: number;
  onChange: (group: ProductOptionGroup) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}) {
  const [draft, setDraft] = useState("");
  // Whether the seller has overridden the display for this group. Until they
  // do, renaming it keeps re-deriving one, so typing "Colour" over "Style"
  // gets swatches without a second decision.
  const displayTouched = useRef(group.options.length > 0);
  const heading = group.name.trim() || `Option group ${position + 1}`;
  const preset = OPTION_GROUP_PRESETS.find(
    (candidate) => candidate.name.toLowerCase() === group.name.trim().toLowerCase(),
  );
  const full =
    group.options.length >= OPTIONS_PER_GROUP_MAX || totalOptions >= OPTIONS_TOTAL_MAX;

  function commit(names: string[]) {
    if (names.length === 0) return;
    onChange(addOptions(group, names, () => crypto.randomUUID()));
    setDraft("");
  }

  function commitDraft() {
    commit(splitOptionInput(draft));
  }

  function onDraftKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    // Enter commits without submitting the form around it: this input is a
    // list builder, and a stray Enter would otherwise try to save the whole
    // product.
    if (event.key === "Enter") {
      event.preventDefault();
      commitDraft();
    }
  }

  /**
   * PASTE IS HANDLED, NOT LEFT TO THE INPUT.
   *
   * A single-line input strips the newlines out of pasted text, so a column
   * copied from a spreadsheet — the most likely way a seller has their sizes
   * or wattages already written down — would land as one run-on value with no
   * hint that anything was lost. Reading the clipboard directly is the only
   * way that paste can mean what it looks like it means.
   *
   * Only intercepted when the paste actually contains several values; a
   * one-value paste behaves like ordinary typing so it can still be edited
   * before being committed.
   */
  function onDraftPaste(event: ClipboardEvent<HTMLInputElement>) {
    const pasted = splitOptionInput(event.clipboardData.getData("text"));
    if (pasted.length < 2) return;
    event.preventDefault();
    commit([...splitOptionInput(draft), ...pasted]);
  }

  function updateOption(id: string, patch: Partial<ProductOptionGroup["options"][number]>) {
    onChange({
      ...group,
      options: group.options.map((option) =>
        option.id === id ? { ...option, ...patch } : option,
      ),
    });
  }

  function moveOption(id: string, direction: -1 | 1) {
    const at = group.options.findIndex((option) => option.id === id);
    const to = at + direction;
    if (at === -1 || to < 0 || to >= group.options.length) return;
    const options = group.options.slice();
    [options[at], options[to]] = [options[to]!, options[at]!];
    onChange({ ...group, options });
  }

  return (
    <div
      className="group/group space-y-3 rounded-md border border-border p-3"
      data-option-group={group.id}
    >
      {/* THE GROUP'S NAME IS ITS TITLE, so it is set like one: no field label
          above it, no box around it until you touch it. "What varies" was a
          label explaining an empty input; the placeholder does that job, and
          once the input says "Colour" the label is restating the obvious in
          the loudest position on the card. */}
      <div className="flex items-center gap-2">
        <label htmlFor={`${inputId}-name`} className="sr-only">
          What varies
        </label>
        <input
          id={`${inputId}-name`}
          type="text"
          value={group.name}
          maxLength={OPTION_GROUP_NAME_MAX}
          placeholder="What varies? e.g. Power output"
          onChange={(event) => {
            const name = event.target.value;
            onChange({
              ...group,
              name,
              ...(displayTouched.current ? {} : { display: defaultDisplayFor(name) }),
            });
          }}
          className={cn(
            "min-w-0 flex-1 rounded-sm border border-transparent bg-transparent px-2 py-1 font-inter text-base font-semibold text-foreground",
            "placeholder:font-normal placeholder:text-muted-foreground hover:border-input focus:border-input focus:bg-background",
            transitionClass,
            focusRingClass,
          )}
        />
        <span className={cn(infoTextClass, "shrink-0 tabular-nums")}>
          {group.options.length === 1 ? "1 option" : `${group.options.length} options`}
        </span>
        <div className="flex items-center">
          <RowButton
            label={`Move ${heading} earlier`}
            disabled={position === 0}
            onClick={() => onMove(-1)}
            groupName="group"
          >
            <ChevronUp className="size-4" strokeWidth={2} aria-hidden="true" />
          </RowButton>
          <RowButton
            label={`Move ${heading} later`}
            disabled={position === count - 1}
            onClick={() => onMove(1)}
            groupName="group"
          >
            <ChevronDown className="size-4" strokeWidth={2} aria-hidden="true" />
          </RowButton>
          <RowButton label={`Remove ${heading}`} destructive onClick={onRemove} groupName="group">
            <X className="size-4" strokeWidth={2} aria-hidden="true" />
          </RowButton>
        </div>
      </div>

      {/* The control and its consequence on one line: what a seller wants to
          know is what picking "Chips" will do, and that answer belongs beside
          the choice rather than under a second heading. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <div className="w-full max-w-[19rem]">
          <SegmentedControl
            value={group.display}
            options={DISPLAY_OPTIONS}
            ariaLabel={`How buyers pick ${heading}`}
            onChange={(display) => {
              displayTouched.current = true;
              onChange({ ...group, display });
            }}
          />
        </div>
        {/* A STABLE name, not one built from the chosen display. "What
            Swatches looks like" sits in the same group as the "Swatches"
            button and is a second match for it — confusing to anything
            querying by accessible name, a screen reader included. */}
        <InfoTip label="How buyers pick it">{DISPLAY_HINTS[group.display]}</InfoTip>
      </div>

      {/* THE OPTIONS ARE A LIST, so they are drawn as one.
          Each was a grey card carrying a labelled swatch row, a labelled
          toggle and three bordered buttons — about a dozen controls per line,
          repeated, with the one thing you actually scan for (the NAME) given
          no more weight than any of them. Now: hairline-separated rows in a
          single frame, the name leading, and every repeated label carried by
          the column instead of by each row. */}
      {group.options.length > 0 && (
        <ul
          // NOT `overflow-hidden`, however tempting for the rounded corners:
          // the swatch popover is absolutely positioned inside a row, and
          // clipping the list clips the picker. The end rows round themselves
          // instead, which is all the corners were ever for.
          className={cn(
            "divide-y divide-border rounded-sm border border-border",
            "[&>li:first-child]:rounded-t-sm [&>li:last-child]:rounded-b-sm",
          )}
          aria-label={`${heading} options`}
        >
          {group.options.map((option, index) => {
            const optionName = option.name || `option ${index + 1}`;
            return (
              <li
                key={option.id}
                // `group/row` so the reorder and remove controls can stay out
                // of the way until this row is pointed at or tabbed into.
                className={cn(
                  "group/row flex items-center gap-2.5 px-2.5 py-2 transition-colors duration-base ease-standard motion-reduce:transition-none",
                  "hover:bg-accent/40 has-[:focus-visible]:bg-accent/40",
                  // A sold-out option stays legible but visibly stood down,
                  // which is what it is: still listed, not orderable.
                  !option.available && "bg-muted/30",
                )}
                data-option-row={option.id}
              >
                {/* Only where it means something. A swatch on a "Power output"
                    row is a control the page will never draw. One dot, not a
                    row of seven — see ColorPicker's `compact`. */}
                {group.display === "swatch" && (
                  <ColorPicker
                    compact
                    id={`${inputId}-swatch-${option.id}`}
                    label={`Colour for ${optionName}`}
                    value={option.swatch ?? NO_SWATCH}
                    onChange={(hex) => updateOption(option.id, { swatch: hex })}
                    inherit={{
                      label: "No swatch",
                      value: NO_SWATCH,
                      active: option.swatch === undefined,
                      onSelect: () => {
                        const { swatch, ...rest } = option;
                        void swatch;
                        onChange({
                          ...group,
                          options: group.options.map((candidate) =>
                            candidate.id === option.id ? rest : candidate,
                          ),
                        });
                      },
                    }}
                  />
                )}

                {/* The name is the row. Borderless until you touch it, so a
                    list of five reads as five words rather than five boxes. */}
                <label htmlFor={`${inputId}-option-${option.id}`} className="sr-only">
                  {heading} option {index + 1}
                </label>
                <input
                  id={`${inputId}-option-${option.id}`}
                  type="text"
                  value={option.name}
                  maxLength={OPTION_NAME_MAX}
                  placeholder={preset?.placeholder ?? `Option ${index + 1}`}
                  onChange={(event) => updateOption(option.id, { name: event.target.value })}
                  className={cn(
                    "min-w-0 flex-1 rounded-sm border border-transparent bg-transparent px-2 py-1 font-inter text-sm text-foreground",
                    "placeholder:text-muted-foreground hover:border-input focus:border-input focus:bg-background",
                    transitionClass,
                    focusRingClass,
                    !option.available && "line-through decoration-muted-foreground/50",
                  )}
                />

                {/* One word, not one per row: the label is the column, and the
                    switch carries the state for the row it is on. */}
                <Switch
                  id={`${inputId}-available-${option.id}`}
                  checked={option.available}
                  onCheckedChange={(available) => updateOption(option.id, { available })}
                  aria-label={`${optionName} is available`}
                />

                <div className="flex items-center">
                  <RowButton
                    label={`Move ${optionName} earlier`}
                    disabled={index === 0}
                    onClick={() => moveOption(option.id, -1)}
                  >
                    <ChevronUp className="size-4" strokeWidth={2} aria-hidden="true" />
                  </RowButton>
                  <RowButton
                    label={`Move ${optionName} later`}
                    disabled={index === group.options.length - 1}
                    onClick={() => moveOption(option.id, 1)}
                  >
                    <ChevronDown className="size-4" strokeWidth={2} aria-hidden="true" />
                  </RowButton>
                  <RowButton
                    label={`Remove ${optionName}`}
                    destructive
                    onClick={() =>
                      onChange({
                        ...group,
                        options: group.options.filter((candidate) => candidate.id !== option.id),
                      })
                    }
                  >
                    <X className="size-4" strokeWidth={2} aria-hidden="true" />
                  </RowButton>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* ONE BOX, ANY NUMBER OF VALUES. Type one and press Enter, or paste the
          whole list — "S, M, L, XL", a spreadsheet column, a line per value —
          and each becomes its own option. */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-48 flex-1 space-y-1">
          <div className="flex items-center gap-1.5">
            <label htmlFor={`${inputId}-draft`} className={cn(labelClass, "text-xs")}>
              Add options
            </label>
            <InfoTip label="How to add several options at once">
              Press Enter after each one, or paste a list — &quot;S, M, L, XL&quot;, or a
              column copied from a spreadsheet — to add them all at once.
            </InfoTip>
          </div>
          <input
            id={`${inputId}-draft`}
            type="text"
            value={draft}
            disabled={full}
            placeholder={
              full
                ? "No room for more options"
                : `${preset?.placeholder ?? "First option"}  —  or paste a list`
            }
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onDraftKeyDown}
            onPaste={onDraftPaste}
            // Committed on blur too: clicking straight from the box to Save
            // used to throw away a typed value with no explanation.
            onBlur={commitDraft}
            className={cn(fieldBaseClass, "py-1.5 text-sm")}
          />
        </div>
        <button
          type="button"
          className={cn(secondaryButtonClass, "px-3 py-1.5 text-xs")}
          disabled={full || splitOptionInput(draft).length === 0}
          onClick={commitDraft}
        >
          <Plus className="size-3.5" strokeWidth={2} aria-hidden="true" />
          Add
        </button>
      </div>
    </div>
  );
}
