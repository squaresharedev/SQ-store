import type { ReactNode } from "react";
import { BrandFooter } from "./BrandFooter";
import { ErrorCode } from "./ErrorCode";
import { ThemeSync } from "./ThemeSync";

/**
 * The shell every failure surface wears. 404 and 500 differ only in what they
 * pass in, so the two screens can never drift apart.
 *
 * The order is the design: the readout and the headline come FIRST, and the
 * giant code sits under them as scenery. The number is the least useful thing
 * on the page — it names the failure to a machine — so it is the thing sunk
 * into the background, while the sentence that actually tells you what
 * happened gets the top of the composition.
 *
 * Not a colour in this file. Everything is a semantic token, and
 * `theme-surface` is what opts this subtree into the resolved light/dark
 * palette — a saved preference if Square Share has one for you, otherwise your
 * system setting (lib/theme-mode.ts). That single class is what lets one
 * component be both the black screen and the white one, with no branch and no
 * second stylesheet.
 */
export function ErrorScreen({
  code,
  readout,
  title,
  description,
  action,
  note,
}: {
  /** The status code. Every `0` in it is drawn as the accent ring. */
  code: string;
  /** Machine-readable name for the failure, in the system's own voice. */
  readout: string;
  title: string;
  description: string;
  /** The single CTA. One, deliberately: a dead end needs one way out. */
  action: ReactNode;
  /** Optional small print under the CTA (e.g. an error reference). */
  note?: ReactNode;
}) {
  return (
    <div className="theme-surface flex min-h-screen flex-col bg-background text-foreground">
      {/* Renders nothing. Guarantees the resolved theme survives onto <html>
          even here, where React may have rebuilt the shell client-side. */}
      <ThemeSync />
      <main className="flex flex-1 flex-col items-center justify-center px-6 py-8 short:py-3">
        <p className="text-center text-sm text-muted-foreground sm:text-base md:text-lg">
          {readout}
        </p>
        <h1 className="mt-1 text-center text-2xl font-semibold tracking-tight sm:text-3xl md:text-4xl">
          {title}
        </h1>
        <div className="mt-6 short:mt-4">
          <ErrorCode value={code} />
        </div>
        {/* Mono and full-strength, against the grey readout above: the readout
            names the failure, this explains it, and the machine voice is what
            ties the sentence to the code it sits under. */}
        {/* Wider when the viewport is short: landscape has width to spare and
            no height to waste, so letting the sentence run to two lines instead
            of three is what keeps the button above the fold on a small phone
            turned sideways. */}
        <p className="mt-8 max-w-xs text-center font-mono text-xs leading-relaxed short:mt-4 short:max-w-md">
          {description}
        </p>
        <div className="mt-8 short:mt-4">{action}</div>
        {note}
      </main>
      <BrandFooter />
    </div>
  );
}
