"use client";

import { useState } from "react";
import type { StorefrontTheme } from "@/types/storefront";
import { ToastProvider } from "@/components/ui/Toast";
import { FinishControls } from "@/components/storefront/FinishControls";

/**
 * The editor side of the motion and finish workstream, at the panel's real
 * width, on a live fixture theme so every control can be clicked through.
 */
export function FinishGallery({ theme: initial }: { theme: StorefrontTheme }) {
  const [theme, setTheme] = useState(initial);
  return (
    <ToastProvider>
      <main className="flex min-h-screen flex-wrap items-start gap-8 bg-muted/40 p-6">
        <section className="w-80 border border-border bg-background p-4" data-gallery-panel="theme">
          <FinishControls theme={theme} onChange={setTheme} />
        </section>
        <pre className="max-w-md overflow-auto font-mono text-xs" data-gallery-theme="">
          {JSON.stringify({ motion: theme.motion }, null, 2)}
        </pre>
      </main>
    </ToastProvider>
  );
}
