"use client";

import { useEffect } from "react";

/**
 * Last-resort boundary for crashes in the ROOT layout itself (error.tsx only
 * covers segments below it). When this renders, the layout that carries our
 * stylesheet and our fonts may not exist, so everything here is deliberately
 * self-contained: inline styles, system font stack, no imports from the design
 * system, and its own <html>/<body> pair (required by Next.js).
 *
 * That is why it does NOT reuse ErrorScreen or the pixel display — those are
 * built out of Tailwind tokens that this surface cannot assume are loaded. It
 * mirrors their palette by hand instead (black / white / grey / acid purple),
 * so the family still reads as one even when nothing else survived.
 */

// The palette this file has to hard-code, as custom properties so both themes
// can be declared without a second copy of every rule. Named after the tokens
// they mirror, so it is obvious what to update when globals.css moves.
//
// System-only, unlike the other error screens: a saved preference lives in
// localStorage, and reading it needs a script this surface deliberately does not
// run. When the root layout has failed badly enough to land here, following the
// OS is the right amount of cleverness.
const PALETTE = `
:root {
  color-scheme: light dark;
  --ge-surface: #ffffff;   /* --background */
  --ge-ink: #0a0a0a;       /* --foreground */
  --ge-muted: #737373;     /* --muted-foreground */
  --ge-border: #e5e5e5;    /* --border */
  --ge-cta: #0a0a0a;       /* --primary (light is black, per styles.md) */
  --ge-cta-ink: #fafafa;   /* --primary-foreground */
}
@media (prefers-color-scheme: dark) {
  :root {
    --ge-surface: #000000;
    --ge-ink: #ffffff;
    --ge-muted: #a1a1aa;
    --ge-border: rgba(255, 255, 255, 0.12);
    --ge-cta: #a855f7;     /* the brand purple carries the CTA on black */
    --ge-cta-ink: #000000;
  }
}`;

const INK = "var(--ge-ink)";
const SURFACE = "var(--ge-surface)";
const MUTED = "var(--ge-muted)";
const BORDER = "var(--ge-border)";

const linkStyle: React.CSSProperties = {
  fontFamily: "ui-monospace, monospace",
  fontSize: "0.75rem",
  textTransform: "uppercase",
  letterSpacing: "0.1em",
  color: MUTED,
  textDecoration: "none",
};

export default function GlobalError({
  error,
  unstable_retry,
  reset,
}: {
  error: Error & { digest?: string };
  // See error.tsx: Next 16.2 supersedes `reset` with a retry that re-fetches
  // first, which is what a root-layout crash usually needs.
  unstable_retry?: () => void;
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[global error boundary]", error);
  }, [error]);

  return (
    <html lang="en">
      <head>
        {/* Passed as a string child rather than through a raw-HTML prop:
            <style> is a raw-text element so the CSS lands verbatim, and the
            codebase's no-HTML-sink rule stays absolute. See layout.tsx for why
            that matters. */}
        <style>{PALETTE}</style>
      </head>
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          background: SURFACE,
          color: INK,
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
        }}
      >
        <main
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "2.5rem 1.5rem",
            textAlign: "center",
          }}
        >
          <p
            style={{
              margin: 0,
              fontFamily: "ui-monospace, monospace",
              fontSize: "clamp(4rem, 18vw, 9rem)",
              fontWeight: 700,
              lineHeight: 1,
              letterSpacing: "0.08em",
              color: INK,
            }}
          >
            500
          </p>
          <h1
            style={{
              margin: "1.5rem 0 0",
              fontSize: "1.25rem",
              fontWeight: 600,
              letterSpacing: "-0.01em",
            }}
          >
            Something went wrong
          </h1>
          <p
            style={{
              margin: "0.75rem 0 0",
              maxWidth: "24rem",
              fontSize: "0.875rem",
              lineHeight: 1.6,
              color: MUTED,
            }}
          >
            The app failed to load. This is usually temporary: your account and
            data are fine.
          </p>
          <button
            type="button"
            onClick={() => (unstable_retry ?? reset)()}
            style={{
              marginTop: "2rem",
              background: "var(--ge-cta)",
              color: "var(--ge-cta-ink)",
              border: "none",
              padding: "0.625rem 1rem",
              fontSize: "0.875rem",
              fontWeight: 500,
              fontFamily: "inherit",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
          {error.digest && (
            <p
              style={{
                margin: "1.5rem 0 0",
                fontFamily: "ui-monospace, monospace",
                fontSize: "0.75rem",
                color: MUTED,
              }}
            >
              Reference: {error.digest}
            </p>
          )}
        </main>

        <footer
          style={{
            borderTop: `1px solid ${BORDER}`,
            padding: "1.5rem",
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "center",
            gap: "1.5rem",
          }}
        >
          <a style={linkStyle} href="https://squareshare.eu/legal/privacy-policy/">
            Privacy
          </a>
          <a style={linkStyle} href="https://squareshare.eu/terms">
            Terms
          </a>
          <a style={linkStyle} href="mailto:squareshare.to@gmail.com">
            Contact
          </a>
          <span style={{ ...linkStyle, textTransform: "none" }}>
            © 2026 Squareshare
          </span>
        </footer>
      </body>
    </html>
  );
}
