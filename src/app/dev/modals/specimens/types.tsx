"use client";

import { useEffect, type ReactNode } from "react";

/**
 * One thing the gallery can show. A `dialog` opens over the page, as it does
 * in the app; a `page` is a card that lives on a page of its own (the sign-in
 * steps), drawn in a frame.
 */
export type Specimen = {
  id: string;
  group: string;
  label: string;
  kind: "dialog" | "page";
  render: (props: { onClose: () => void }) => ReactNode;
};

/** A stand-in product photo the app already serves. */
export const SAMPLE_PHOTO = "/sample-storefront/camera.webp";

/**
 * For a dialog that owns its trigger (a link or a button that opens it):
 * presses that trigger once the page is up, so the dialog can still be linked
 * to and screenshotted like the rest.
 */
export function PressOnMount({ selector, children }: { selector: string; children: ReactNode }) {
  useEffect(() => {
    const timer = setTimeout(() => document.querySelector<HTMLElement>(selector)?.click(), 150);
    return () => clearTimeout(timer);
  }, [selector]);
  return <>{children}</>;
}
