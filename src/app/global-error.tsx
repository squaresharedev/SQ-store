"use client";

import { useEffect } from "react";

/**
 * Last-resort boundary for crashes in the ROOT layout itself (error.tsx only
 * covers segments below it). When this renders, the layout that carries our
 * stylesheet may not exist, so everything here is deliberately self-contained:
 * inline styles, system font stack, no imports from the design system, and its
 * own <html>/<body> pair (required by Next.js for global-error).
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[global error boundary]", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#f4f4f5",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
          color: "#18181b",
        }}
      >
        <div
          style={{
            maxWidth: "28rem",
            width: "100%",
            background: "#ffffff",
            border: "1px solid #e4e4e7",
            padding: "1.75rem 1.5rem",
            boxShadow: "0 10px 15px -3px rgba(0,0,0,0.1)",
          }}
        >
          <h1 style={{ margin: 0, fontSize: "1.125rem", fontWeight: 800 }}>
            Something went wrong
          </h1>
          <p
            style={{
              margin: "0.5rem 0 0",
              fontSize: "0.875rem",
              color: "#71717a",
              lineHeight: 1.5,
            }}
          >
            The app failed to load. This is usually temporary; your account and
            data are fine.
          </p>
          <div
            style={{
              marginTop: "1.25rem",
              display: "flex",
              alignItems: "center",
              gap: "0.75rem",
            }}
          >
            <button
              type="button"
              onClick={reset}
              style={{
                background: "#18181b",
                color: "#fafafa",
                border: "none",
                padding: "0.5rem 1rem",
                fontSize: "0.875rem",
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Try again
            </button>
            <a
              href="/dashboard"
              style={{
                fontSize: "0.875rem",
                fontWeight: 500,
                color: "#18181b",
              }}
            >
              Back to dashboard
            </a>
          </div>
          {error.digest && (
            <p
              style={{
                margin: "1.25rem 0 0",
                fontFamily: "ui-monospace, monospace",
                fontSize: "0.75rem",
                color: "#71717a",
              }}
            >
              Reference: {error.digest}
            </p>
          )}
        </div>
      </body>
    </html>
  );
}
