"use client";

import { useRef, type CSSProperties, type KeyboardEvent } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { isStrictHexColor } from "@/lib/validation/inputs";
import type { ProductOption, ProductOptionGroup } from "@/types/product";
import { controlRadius, readableOn } from "./product-page-maps";
import { useOptionSelection } from "./OptionContext";

/**
 * The version picker: one control per option group, in the seller's order.
 *
 * WHAT A GROUP LOOKS LIKE IS THE SELLER'S CHOICE, not this file's guess, and
 * the three modes exist because the values are genuinely different kinds of
 * thing. Colours are shown, so they get swatches. "750 W", "2 m" and "XL" are
 * read, so they get text chips. A list too long to wrap into readable chips
 * gets a dropdown instead of a wall of pills.
 *
 * Unavailable options stay VISIBLE in every mode (a buyer should learn a
 * version exists and is gone, not wonder whether they missed it) but cannot be
 * chosen, and the arrow keys skip them. The chosen name is printed beside the
 * group's own name, because a swatch is not a name and a pill is easy to lose.
 */
export function OptionPicker({ radius, ink }: { radius: number; ink: string }) {
  const { groups } = useOptionSelection();
  if (groups.length === 0) return null;

  return (
    <div className="flex flex-col gap-4" data-product-options="">
      {groups.map((group) => (
        <OptionGroupControl key={group.id} group={group} radius={radius} ink={ink} />
      ))}
    </div>
  );
}

function OptionGroupControl({
  group,
  radius,
  ink,
}: {
  group: ProductOptionGroup;
  radius: number;
  ink: string;
}) {
  const { selection, select } = useOptionSelection();
  const chosen = selection[group.id] ?? null;
  const groupRef = useRef<HTMLDivElement>(null);

  /** Roving focus across the choosable options, the arrow-key behaviour a
   *  radiogroup is expected to have. Unavailable ones are stepped over. */
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"].includes(event.key)) return;
    event.preventDefault();
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1;
    const choosable = group.options.filter((option) => option.available);
    if (choosable.length === 0) return;
    const at = choosable.findIndex((option) => option.id === chosen?.id);
    const next = choosable[(at + step + choosable.length) % choosable.length]!;
    select(group.id, next.id);
    groupRef.current?.querySelector<HTMLButtonElement>(`[data-option-id="${next.id}"]`)?.focus();
  }

  const label = (
    <p className="text-sm" data-option-group-label={group.id}>
      <span className="opacity-70">{group.name}</span>
      {chosen && (
        <>
          <span className="opacity-70">: </span>
          <span className="font-medium">{chosen.name}</span>
          {!chosen.available && <span className="opacity-70"> (unavailable)</span>}
        </>
      )}
    </p>
  );

  if (group.display === "select") {
    return (
      <div className="flex flex-col gap-2" data-product-option-group={group.id}>
        {label}
        {/* The native arrow goes with `appearance-none` (needed to paint the
            control in the seller's ink rather than the OS chrome), so one is
            drawn back on: a box with no arrow does not read as a dropdown.
            `pointer-events-none` keeps the click on the select underneath. */}
        <div className="relative w-full max-w-xs">
          <select
            aria-label={group.name}
            value={chosen?.id ?? ""}
            onChange={(event) => select(group.id, event.target.value)}
            className="w-full appearance-none bg-transparent py-2 pl-3 pr-9 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            style={{
              borderRadius: `${controlRadius(radius)}px`,
              boxShadow: hairlineStrong(ink),
              color: ink,
              outlineColor: ink,
            }}
          >
            {group.options.map((option) => (
              // Kept in the list so the name is still readable, but disabled
              // so it cannot be chosen — the same bargain the swatches and
              // chips strike visually.
              <option key={option.id} value={option.id} disabled={!option.available}>
                {option.available ? option.name : `${option.name} — unavailable`}
              </option>
            ))}
          </select>
          <ChevronDown
            aria-hidden="true"
            className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 opacity-60"
            strokeWidth={2}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2" data-product-option-group={group.id}>
      {label}
      <div
        ref={groupRef}
        role="radiogroup"
        aria-label={group.name}
        className="flex flex-wrap gap-2"
        onKeyDown={onKeyDown}
      >
        {group.options.map((option) =>
          group.display === "swatch" ? (
            <SwatchOption
              key={option.id}
              option={option}
              checked={option.id === chosen?.id}
              anyChosen={chosen !== null}
              radius={radius}
              ink={ink}
              onSelect={() => select(group.id, option.id)}
            />
          ) : (
            <ChipOption
              key={option.id}
              option={option}
              checked={option.id === chosen?.id}
              anyChosen={chosen !== null}
              radius={radius}
              ink={ink}
              onSelect={() => select(group.id, option.id)}
            />
          ),
        )}
      </div>
    </div>
  );
}

type OptionButtonProps = {
  option: ProductOption;
  checked: boolean;
  anyChosen: boolean;
  radius: number;
  ink: string;
  onSelect: () => void;
};

/** Shared radio wiring: only the checked option is in the tab order (roving
 *  focus), and an unavailable one is announced as such rather than hidden. */
function radioProps({ option, checked, anyChosen }: OptionButtonProps) {
  return {
    type: "button" as const,
    role: "radio" as const,
    "aria-checked": checked,
    "aria-label": option.available ? option.name : `${option.name}, unavailable`,
    "aria-disabled": !option.available || undefined,
    "data-option-id": option.id,
    tabIndex: checked || (!anyChosen && option.available) ? 0 : -1,
  };
}

function SwatchOption(props: OptionButtonProps) {
  const { option, checked, radius, ink, onSelect } = props;
  const swatch = option.swatch && isStrictHexColor(option.swatch) ? option.swatch : null;
  return (
    <button
      {...radioProps(props)}
      onClick={() => option.available && onSelect()}
      className={cn(
        "relative flex size-9 items-center justify-center text-xs font-semibold transition-shadow duration-base ease-standard focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
        !option.available && "cursor-not-allowed opacity-45",
      )}
      style={{
        borderRadius: `${Math.min(radius, 999)}px`,
        backgroundColor: swatch ?? neutralFill(ink),
        color: swatch ? readableOn(swatch) : ink,
        boxShadow: checked ? checkedRing(ink) : hairline(ink),
        outlineColor: ink,
      }}
    >
      {!swatch && option.name.slice(0, 1).toUpperCase()}
      {checked && <Check className="absolute size-4" strokeWidth={3} aria-hidden="true" />}
      {/* Corner to corner on a square: the diagonal has to look deliberate,
          and on a 36px swatch a shallow line just looks like a scratch. */}
      {!option.available && (
        <StrikeThrough color={swatch ? readableOn(swatch) : ink} className="-rotate-45" />
      )}
    </button>
  );
}

/**
 * A text pill, for every axis whose values are words: sizes, wattages,
 * lengths, capacities, materials. The name is the control, so it is never
 * truncated — a long value makes a wide pill rather than an unreadable one.
 */
function ChipOption(props: OptionButtonProps) {
  const { option, checked, radius, ink, onSelect } = props;
  return (
    <button
      {...radioProps(props)}
      onClick={() => option.available && onSelect()}
      className={cn(
        "relative flex min-w-9 items-center justify-center px-3 py-2 text-sm font-medium transition-shadow duration-base ease-standard focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
        !option.available && "cursor-not-allowed opacity-45",
      )}
      style={{
        borderRadius: `${controlRadius(radius)}px`,
        backgroundColor: checked ? neutralFill(ink) : "transparent",
        color: ink,
        boxShadow: checked ? checkedRing(ink) : hairline(ink),
        outlineColor: ink,
      }}
    >
      {option.name}
      {/* Level, not diagonal: a chip is a WORD, so "gone" is struck-through
          text, which is what that means everywhere else. */}
      {!option.available && <StrikeThrough color={ink} />}
    </button>
  );
}

/** The line that says "this one is gone" without removing the name. */
function StrikeThrough({ color, className }: { color: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("pointer-events-none absolute inset-x-1 top-1/2 h-px", className)}
      style={{ backgroundColor: color }}
    />
  );
}

/** A fill that reads on either ink, for a swatch-less chip. */
function neutralFill(ink: string): string {
  return ink === "#ffffff" ? "rgba(255,255,255,0.14)" : "rgba(23,23,23,0.06)";
}

/** The double ring on the chosen option: a gap in the page's own ground, then
 *  the ink, so it reads on a swatch of any colour. */
function checkedRing(ink: string): CSSProperties["boxShadow"] {
  const gap = ink === "#ffffff" ? "#171717" : "#ffffff";
  return `0 0 0 2px ${gap}, 0 0 0 4px ${ink}`;
}

function hairline(ink: string): CSSProperties["boxShadow"] {
  return `inset 0 0 0 1px ${ink === "#ffffff" ? "rgba(255,255,255,0.35)" : "rgba(23,23,23,0.15)"}`;
}

/** The dropdown's border. A shade stronger than a chip's, because a select is
 *  a box the viewer has to find rather than one of a row of buttons. */
function hairlineStrong(ink: string): CSSProperties["boxShadow"] {
  return `inset 0 0 0 1px ${ink === "#ffffff" ? "rgba(255,255,255,0.35)" : "rgba(23,23,23,0.25)"}`;
}
