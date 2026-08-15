"use client";

import { useMemo, useState } from "react";
import { helpTextClass } from "@/components/ui/control-styles";
import { ColorPicker } from "@/components/ui/ColorPicker";
import { ColorPanel } from "@/components/storefront/ColorPanel";
import { COLOR_PRESETS } from "@/lib/theme/color-presets";
import { collectStorefrontColors } from "@/lib/theme/palette";
import {
  DEFAULT_STOREFRONT_CONFIG,
  type StorefrontBlock,
} from "@/types/storefront";

const THEME_ACCENT = "#3b82f6";

/** A stand-in canvas, so "In this design" in the panel below has something to
 *  show: these shapes' fills and border are colors the storefront uses. */
const SAMPLE_BLOCKS: StorefrontBlock[] = [
  {
    type: "shape",
    id: "00000000-0000-4000-8000-000000000001",
    kind: "circle",
    color: "#e11d48",
    x: 0,
    y: 0,
    w: 1,
    h: 1,
  },
  {
    type: "shape",
    id: "00000000-0000-4000-8000-000000000002",
    kind: "square",
    color: "#f59e0b",
    borderColor: "#0f766e",
    borderWidth: 4,
    x: 1,
    y: 0,
    w: 1,
    h: 1,
  },
];

/**
 * Living reference for both halves of the color system: the inline ColorPicker
 * (the one-tap row every color field renders) and the ColorPanel (the left-hand
 * chooser it hands off to inside the designer). Everything below is live —
 * changing a color updates the preview and the panel's "In this design".
 *
 * There is deliberately no ColorTargetProvider here, so the pickers show their
 * standalone behaviour: the wheel opens their own popover. Inside the designer
 * the same wheel aims the panel instead.
 */
export function PickersGallery() {
  const [accent, setAccent] = useState(THEME_ACCENT);
  const [solid, setSolid] = useState("#fffdf5");
  const [from, setFrom] = useState("#a855f7");
  const [to, setTo] = useState("#0ea5e9");
  const [fill, setFill] = useState("#16a34a");
  // `undefined` = follow the theme, exactly like TextBlock.color.
  const [textColor, setTextColor] = useState<string | undefined>(undefined);
  // What the standalone panel below is editing.
  const [panelColor, setPanelColor] = useState("#a855f7");

  const sampleTheme = useMemo(
    () => ({
      ...DEFAULT_STOREFRONT_CONFIG.theme,
      accent,
      background: { kind: "gradient" as const, from, to, angle: 160 },
    }),
    [accent, from, to],
  );

  const inDesign = useMemo(
    () => collectStorefrontColors(sampleTheme, SAMPLE_BLOCKS),
    [sampleTheme],
  );

  return (
    <main className="mx-auto max-w-5xl space-y-10 p-6 sm:p-10">
      <header className="space-y-2">
        <h1 className="font-inter text-2xl font-semibold text-foreground">
          Color picker
        </h1>
        <p className={helpTextClass}>
          One picker, every color field. The row is the whole control: a wheel, an
          eyedropper (Chromium only), and the {COLOR_PRESETS.length} fixed
          neutrals. A custom color earns its own dot so the row always shows what
          is selected. With no palette provider mounted, as here, the wheel opens
          the picker&apos;s own popover.
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

      <section className="space-y-4">
        <h2 className="font-inter text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          The color panel
        </h2>
        <p className={helpTextClass}>
          The left-hand chooser, at the width it docks at in the designer
          (17.5rem). Recently used fills in as you pick; &quot;In this design&quot;
          is fed by the gradient above and two sample shapes.
        </p>
        <div className="flex flex-col gap-6 sm:flex-row">
          <div className="w-full shrink-0 border border-border sm:w-[17.5rem]">
            <ColorPanel
              target={{ label: "Fill", value: panelColor }}
              inDesign={inDesign}
              onPick={setPanelColor}
              onClose={() => setPanelColor("#a855f7")}
            />
          </div>
          <div
            className="min-h-48 flex-1 rounded-md border border-border"
            style={{ backgroundColor: panelColor }}
          />
        </div>
      </section>
    </main>
  );
}
