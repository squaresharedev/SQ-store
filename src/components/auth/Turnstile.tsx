"use client";

import * as React from "react";
import Script from "next/script";

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement,
        options: {
          sitekey: string;
          callback: (token: string) => void;
          "expired-callback"?: () => void;
          "error-callback"?: () => void;
        },
      ) => string;
      remove: (widgetId: string) => void;
    };
  }
}

/**
 * Cloudflare Turnstile widget. Renders the container div unconditionally so
 * the parent never has to know whether the script has loaded yet; the widget
 * itself paints into it once `window.turnstile` is ready.
 *
 * The parent decides WHETHER to mount this at all — see LoginForm, which only
 * does so when a site key is configured, so local dev and any environment
 * without Cloudflare credentials render the ordinary form.
 */
export function Turnstile({
  siteKey,
  onVerify,
  onExpire,
}: {
  siteKey: string;
  onVerify: (token: string) => void;
  onExpire?: () => void;
}) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const widgetIdRef = React.useRef<string | null>(null);

  const render = React.useCallback(() => {
    if (!containerRef.current || !window.turnstile || widgetIdRef.current) return;
    widgetIdRef.current = window.turnstile.render(containerRef.current, {
      sitekey: siteKey,
      callback: onVerify,
      "expired-callback": onExpire,
      "error-callback": onExpire,
    });
  }, [siteKey, onVerify, onExpire]);

  React.useEffect(() => {
    // The script may already be loaded (e.g. switching sign-up mode off and
    // back on), in which case Script's onReady never fires again — try once
    // on mount too.
    render();
    return () => {
      if (widgetIdRef.current) window.turnstile?.remove(widgetIdRef.current);
      widgetIdRef.current = null;
    };
  }, [render]);

  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js"
        strategy="afterInteractive"
        onReady={render}
      />
      <div ref={containerRef} />
    </>
  );
}
