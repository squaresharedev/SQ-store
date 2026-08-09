"use client";

import { useState } from "react";
import { helpTextClass } from "@/components/ui/control-styles";
import { ColorPicker } from "@/components/ui/ColorPicker";
import { COLOR_PRESETS } from "@/lib/theme/color-presets";

const THEME_ACCENT = "#3b82f6";

/**
 * Living reference for the one shared ColorPicker: the plain form field, the
 * optional-value variant with `inherit`, and the dense side-panel layout the
 * storefront designer actually renders it in. Every swatch below is live —
 * changing one updates the preview so the panel width and popover anchoring can
 * be eyeballed in the same place they ship.
 */
export function PickersGallery() {
  const [accent, setAccent] = useState(THEME_ACCENT);
  const [solid, setSolid] = useState("#fffdf5");
  const [from, setFrom] = useState("#a855f7");
  const [to, setTo] = useState("#0ea5e9");
  const [fill, setFill] = useState("#16a34a");
  // `undefined` = follow the theme, exactly like TextBlock.color.
  const [textColor, setTextColor] = useState<string | undefined>(undefined);

  return (
    <main className="mx-auto max-w-5xl space-y-10 p-6 sm:p-10">
      <header className="space-y-2">
        <h1 className="font-inter text-2xl font-semibold text-foreground">
          Color picker
        </h1>
        <p className={helpTextClass}>
          One picker, every color field. The row is the whole control: a color
          wheel that opens the full picker, an eyedropper (Chromium only), and{" "}
          {COLOR_PRESETS.length} quick swatches. A custom color earns its own
          dot so the row always shows what is selected.
        </p>
      </header>

      <section className="space-y-4">
        <h2 className="font-inter text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Required color
        </h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <ColorPicker label="Accent" value={accent} onChange={setAccent} />
          <ColorPicker label="Background" value={solid} onChange={setSolid} />
          <ColorPicker label="Fill" value={fill} onChange={setFill} />
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="font-inter text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Optional color (inherit)
        </h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <ColorPicker
            label="Text color"
            value={textColor ?? accent}
            onChange={setTextColor}
            inherit={{
              label: "Theme color",
              value: accent,
              active: textColor === undefined,
              onSelect: () => setTextColor(undefined),
            }}
          />
        </div>
        <p className={helpTextClass}>
          Stored value:{" "}
          <code className="font-mono">{textColor ?? "undefined (inherits)"}</code>
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="font-inter text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          In a side panel (the real layout)
        </h2>
        <div className="flex flex-col gap-6 sm:flex-row">
          <div className="w-full shrink-0 space-y-3 border border-border p-4 sm:w-72">
            <ColorPicker label="From" value={from} onChange={setFrom} />
            <ColorPicker label="To" value={to} onChange={setTo} />
          </div>
          <div
            className="min-h-48 flex-1 rounded-md border border-border"
            style={{ background: `linear-gradient(135deg, ${from}, ${to})` }}
          />
        </div>
      </section>
    </main>
  );
}
