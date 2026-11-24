"use client";

import { useState } from "react";
import {
  NEW_STOREFRONT_THEME,
  newStorefrontConfig,
  type ShapeBlock,
  type StorefrontTheme,
} from "@/types/storefront";
import { derivePalette } from "@/lib/storefront/palette";
import { ToastProvider } from "@/components/ui/Toast";
import { BackgroundEditor } from "@/components/storefront/BackgroundEditor";
import { FinishControls } from "@/components/storefront/FinishControls";
import { ShapeBlockEditor, type ShapeBlockPatch } from "@/components/storefront/ShapeBlockEditor";
import { ShapeTileContent } from "@/components/storefront/ShapeTileContent";

/** A new storefront's theme: what the controls open on for most sellers. */
const START: StorefrontTheme = newStorefrontConfig().theme;

const SHAPE: ShapeBlock = {
  type: "shape",
  id: "00000000-0000-4000-8000-00000000f001",
  kind: "star",
  color: NEW_STOREFRONT_THEME.palette!.accent,
  x: 0,
  y: 0,
  w: 1,
  h: 1,
};

/**
 * The editor side of the motion and finish workstream, at the panel's real
 * width, on a live new-storefront theme so every control can be clicked
 * through. Beside each panel, what it stored.
 */
export function FinishGallery() {
  const [theme, setTheme] = useState(START);
  const [shape, setShape] = useState(SHAPE);
  const palette = derivePalette(theme);
  return (
    <ToastProvider>
      <main className="flex min-h-screen flex-wrap items-start gap-6 bg-muted/40 p-6">
        <section className="w-80 space-y-4 border border-border bg-background p-4" data-gallery-panel="theme">
          <BackgroundEditor
            value={theme.background}
            onChange={(background) => setTheme({ ...theme, background })}
            imageUrl={null}
            onImageChange={() => {}}
            accent={theme.accent}
            palette={palette}
          />
          <FinishControls theme={theme} onChange={setTheme} />
        </section>
        <section className="w-80 border border-border bg-background p-4" data-gallery-panel="shape">
          <ShapeBlockEditor
            block={shape}
            palette={palette}
            onUpdate={(patch: ShapeBlockPatch) => setShape((current) => ({ ...current, ...patch }))}
            onDuplicate={() => {}}
            onRemove={() => {}}
          />
        </section>
        <section className="space-y-3">
          <div className="flex size-40 flex-col p-4" style={{ backgroundColor: palette.background }}>
            <ShapeTileContent block={shape} />
          </div>
          <pre className="max-w-sm overflow-auto font-mono text-xs" data-gallery-theme="">
            {JSON.stringify(
              {
                background: theme.background,
                motion: theme.motion,
                texture: theme.texture,
                shape: { color: shape.color, gradient: shape.gradient },
              },
              null,
              2,
            )}
          </pre>
        </section>
      </main>
    </ToastProvider>
  );
}
