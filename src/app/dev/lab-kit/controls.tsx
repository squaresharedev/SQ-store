"use client";

import { useState, type ReactNode } from "react";
import { Button, buttonClassName } from "@/components/ui/button";
import { infoTextClass, labelClass, panelEyebrowClass } from "@/components/ui/control-styles";
import { Slider } from "@/components/ui/slider";
import { badgeClass } from "@/components/ui/surface-styles";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { LabFit } from "./state";

// The controls every lab's playground is built from (~/.claude/lab.md), on the
// app's own primitives so a lab reads like the product it tunes.

/** How long a copy button says "Copied". */
const COPIED_MS = 1500;

const FIT_CLASS: Record<LabFit, string> = {
  "on-brand": "text-success",
  stretch: "text-foreground",
  "off-brand": "text-muted-foreground",
};

/** A preset's brand fit, as a chip. */
export function LabFitBadge({ fit, className }: { fit: LabFit; className?: string }) {
  return <span className={cn(badgeClass, FIT_CLASS[fit], className)}>{fit}</span>;
}

/** A titled run of controls in the playground's column. */
export function LabGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 border-t border-border pt-4 first:border-t-0 first:pt-0">
      <h2 className={panelEyebrowClass}>{title}</h2>
      {children}
    </section>
  );
}

/** A labelled slider with its value read out. */
export function LabKnob({
  id,
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className={labelClass}>
          {label}
        </label>
        <span className={cn(infoTextClass, "tabular-nums")}>{Number.isInteger(step) ? value : value.toFixed(2)}</span>
      </div>
      <Slider id={id} value={value} min={min} max={max} step={step} onChange={onChange} ariaLabel={label} />
    </div>
  );
}

/** A labelled switch. */
export function LabToggle({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span id={id} className={labelClass}>
        {label}
      </span>
      <Switch checked={checked} onCheckedChange={onChange} aria-labelledby={id} />
    </div>
  );
}

/** Copy JSX and Copy link: how a pick is handed back. */
export function LabCopyButtons({ jsx }: { jsx: string }) {
  const [copied, setCopied] = useState<"jsx" | "link" | null>(null);
  const copy = async (what: "jsx" | "link") => {
    await navigator.clipboard.writeText(what === "jsx" ? jsx : window.location.href);
    setCopied(what);
    window.setTimeout(() => setCopied(null), COPIED_MS);
  };
  return (
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="secondary" onClick={() => copy("jsx")}>
        {copied === "jsx" ? "Copied" : "Copy JSX"}
      </Button>
      <Button type="button" variant="secondary" onClick={() => copy("link")}>
        {copied === "link" ? "Copied" : "Copy link"}
      </Button>
    </div>
  );
}

/** The JSX a pick hands back, shown under the preview. */
export function LabJsx({ jsx }: { jsx: string }) {
  return (
    <pre className="overflow-x-auto rounded-sm border border-border bg-muted p-4 font-mono text-xs text-foreground">{jsx}</pre>
  );
}

/** The preset tabs: one at a time, each with its count; empty tabs are left out. */
export function LabTabs({
  groups,
  active,
  count,
  onChange,
}: {
  groups: readonly { id: string; label: string }[];
  active: string;
  count: (id: string) => number;
  onChange: (id: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2" data-lab-tabs>
      {groups.map((tab) => {
        const n = count(tab.id);
        return n ? (
          <button
            key={tab.id}
            type="button"
            aria-pressed={tab.id === active}
            onClick={() => onChange(tab.id)}
            className={buttonClassName(tab.id === active ? "primary" : "secondary")}
          >
            {tab.label} ({n})
          </button>
        ) : null;
      })}
    </div>
  );
}
