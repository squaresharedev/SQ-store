"use client";

import { useState, type MouseEvent, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import { DeviceSizeSwitch, type PreviewDevice } from "./DeviceSizeSwitch";
import { useNaturalSize } from "./useNaturalSize";
import { useSettingTarget } from "@/lib/storefront/setting-context";
import type { SettingRef } from "@/lib/storefront/setting-ref";

/**
 * How much smaller a page's own card renders on the canvas than the width
 * its device switch actually asks for.
 *
 * A CSS transform, not a smaller `width` handed to the page: the page still
 * LAYS OUT at its full realistic width and is only shrunk in paint, so it
 * keeps the exact desktop or mobile layout a buyer's browser would give it
 * (the same breakpoints, the same line wraps), just smaller, rather than a
 * genuinely narrower render reflowing into a different shape. The real, hosted
 * page a buyer visits never passes through this component at all, so it
 * always renders full size regardless of what the seller's canvas is showing.
 */
export const ARTBOARD_SCALE = 0.75;

/**
 * ONE HOSTED PAGE, as an artboard on the storefront canvas: the product page,
 * the checkout, the thank-you page. The frame they share, so all three behave
 * as one kind of thing.
 *
 * The board and the pages it leads to live on the same workspace, joined by
 * connectors (see PageConnectors), so a seller can see a tile and everything
 * behind it at once and design it all without changing screens.
 *
 * WIDTH is a REALISTIC PHONE OR DESKTOP BROWSER WIDTH, at whichever device
 * this frame's own switch is on: a hosted page is a real route a buyer's
 * browser renders on its own, not a panel scaled to whatever the board
 * measures. Independent of the board's own device, too. Height is natural,
 * not a fixed frame: a real page is exactly as tall as its content.
 *
 * CLICK THE PAGE, GET THE SETTING. One delegated capture-phase listener
 * rather than a control wrapped around each region: the page is full of real
 * interactive elements, and nesting them inside buttons would be invalid
 * markup and a worse page to read with a screen reader. The nearest
 * `data-setting-hotspot` wins; a `data-setting-skip` subtree opts out (the
 * controls that belong to the product or the buyer, not the page's design).
 * Links are neutralised, and only links: a mailto or a document must not take
 * the editor away, while a disclosure still expands as its settings open.
 */
export function ArtboardFrame({
  artboardId,
  title,
  kindLabel,
  closeLabel,
  onClose,
  widths,
  initialDevice,
  resolveHotspot,
  actions,
  children,
}: {
  /** What the connectors and tests find this artboard by. */
  artboardId: string;
  /** The product's title, first in the label row. */
  title: string;
  /** " · Product page", " · Checkout": what kind of page this is. */
  kindLabel: string;
  closeLabel: string;
  onClose: () => void;
  /** This page's own two widths, which its switch picks between. */
  widths: Record<PreviewDevice, number>;
  /** What the board is showing, so a freshly opened page starts in step. */
  initialDevice: PreviewDevice;
  /** The setting a hotspot name opens here, or null for none. */
  resolveHotspot: (name: string) => SettingRef | null;
  /** More chrome beside the device switch (a node to the next page). */
  actions?: ReactNode;
  /** The page itself, rendered at the full width. */
  children: ReactNode;
}) {
  const t = useTranslations("Storefront.artboard");
  const [device, setDevice] = useState<PreviewDevice>(initialDevice);
  const width = widths[device];
  const scaledWidth = width * ARTBOARD_SCALE;
  const { ref: contentRef, size: naturalSize } = useNaturalSize<HTMLDivElement>();
  // Null outside the designer (the dev gallery, a component test), which
  // simply means clicking the page opens nothing.
  const setting = useSettingTarget();

  function openSettingForTarget(event: MouseEvent<HTMLDivElement>) {
    if (!setting) return;
    const from = event.target instanceof Element ? event.target : null;
    if (!from || from.closest("[data-setting-skip]")) return;
    const anchor = from.closest("a");
    if (anchor) event.preventDefault();
    const hotspot = from.closest("[data-setting-hotspot]");
    const ref = resolveHotspot(hotspot?.getAttribute("data-setting-hotspot") ?? "");
    if (ref) setting.open(ref);
  }

  return (
    <div data-artboard-id={artboardId} className="flex shrink-0 flex-col gap-2" style={{ width: scaledWidth }}>
      {/* The frame's label, outside the page itself: this chrome belongs to
          the editor, never to the design. At the CARD's width, so the
          controls stay a comfortable size rather than shrinking with it. */}
      <div className="flex items-center gap-2" data-artboard-label="">
        <p className="min-w-0 flex-1 truncate font-inter text-sm font-medium text-foreground">
          {title}
          <span className="text-muted-foreground">{kindLabel}</span>
        </p>
        <div className="flex shrink-0 items-center gap-1">
          {actions}
          <DeviceSizeSwitch
            device={device}
            onChange={setDevice}
            labels={{ desktop: t("desktopSize"), mobile: t("mobileSize") }}
          />
          <button
            type="button"
            onClick={onClose}
            aria-label={closeLabel}
            title={closeLabel}
            className="flex size-7 shrink-0 items-center justify-center rounded-sm border border-border bg-background text-muted-foreground transition-colors duration-base ease-standard hover:text-foreground"
          >
            <X className="size-3.5" strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* THE CARD. Sized to the shrunk footprint and clipping to it, while the
          frame itself (border, radius, shadow) stays crisp at full strength.
          Height comes from the page's own measured natural height; before
          that lands it is unset and the box sizes to the content. */}
      <div
        data-artboard-card=""
        className="overflow-hidden rounded-md border border-border bg-background shadow-lg"
        style={{
          width: scaledWidth,
          height: naturalSize.height > 0 ? naturalSize.height * ARTBOARD_SCALE : undefined,
        }}
      >
        <div
          ref={contentRef}
          onClickCapture={openSettingForTarget}
          style={{ width, transform: `scale(${ARTBOARD_SCALE})`, transformOrigin: "top left" }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
