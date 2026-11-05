"use client";

import { Switch } from "@/components/ui/switch";
import { InfoTip } from "@/components/ui/InfoTip";
import { strongLabelClass } from "@/components/ui/control-styles";

/**
 * One on/off setting in a design panel: its name, a "?" that says what it
 * does, and the switch, on one line. The explanation lives behind the "?"
 * (see InfoTip) so a panel of these reads as a list of names, and its words
 * may change with the state around it (a tip saying why the switch does
 * nothing right now) without the row ever growing a paragraph.
 */
export function SwitchRow({
  id,
  label,
  checked,
  onCheckedChange,
  tipLabel,
  tip,
}: {
  id: string;
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** The "?" button's own name: never the setting's words (see InfoTip). */
  tipLabel: string;
  tip: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="flex items-center gap-1.5">
        <label htmlFor={id} className={strongLabelClass}>
          {label}
        </label>
        <InfoTip label={tipLabel}>{tip}</InfoTip>
      </span>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}
