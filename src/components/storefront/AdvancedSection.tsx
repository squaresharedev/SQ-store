"use client";

import { Switch } from "@/components/ui/switch";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import {
  fieldBaseClass,
  helpTextClass,
  labelClass,
  stubBadgeClass,
} from "@/components/ui/control-styles";

const SPACING_OPTIONS: readonly { value: "tight" | "normal" | "roomy"; label: string }[] = [
  { value: "tight", label: "Tight" },
  { value: "normal", label: "Normal" },
  { value: "roomy", label: "Roomy" },
];

/**
 * AdvancedSection — roadmap controls, all stubbed and disabled. No props
 * because nothing here is persisted yet.
 */
export function AdvancedSection() {
  return (
    <div className="space-y-4">
      <p className={helpTextClass}>
        These options are on the roadmap and not saved yet.
      </p>

      {/* TODO(stub): store header — UI only, not wired. */}
      <div className="space-y-1.5">
        <div className="flex items-center">
          <label className={labelClass}>Store header</label>
          <span className={stubBadgeClass}>Soon</span>
        </div>
        <input
          type="text"
          className={fieldBaseClass}
          disabled
          placeholder="Store name shown to buyers"
        />
      </div>

      {/* TODO(stub): bio — UI only, not wired. */}
      <div className="space-y-1.5">
        <div className="flex items-center">
          <label className={labelClass}>Bio</label>
          <span className={stubBadgeClass}>Soon</span>
        </div>
        <textarea
          className={fieldBaseClass}
          rows={2}
          disabled
          placeholder="A short line about your shop"
        />
      </div>

      {/* TODO(stub): block spacing — UI only, not wired. */}
      <div className="space-y-1.5">
        <div className="flex items-center">
          <span className={labelClass}>Block spacing</span>
          <span className={stubBadgeClass}>Soon</span>
        </div>
        <SegmentedControl
          value="normal"
          options={SPACING_OPTIONS}
          onChange={() => {
            // stub — not wired
          }}
          ariaLabel="Block spacing"
          disabled
        />
      </div>

      {/* TODO(stub): hide sold-out products — UI only, not wired. */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center">
          <span className={labelClass}>Hide sold-out products</span>
          <span className={stubBadgeClass}>Soon</span>
        </div>
        <Switch
          checked={false}
          onCheckedChange={() => {
            // stub — not wired
          }}
          disabled
        />
      </div>
    </div>
  );
}
