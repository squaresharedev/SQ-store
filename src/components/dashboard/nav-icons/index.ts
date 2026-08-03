"use client";

/**
 * Animated nav icons. Geometry is lifted verbatim from lucide-react (ISC) so
 * an icon at rest is pixel-identical to the static original; each sub-element
 * is a motion primitive so the icon can perform its meaning on hover.
 *
 * Trigger contract: an ancestor motion component (the nav row) switches
 * between the "idle" and "hover" variant labels via whileHover/whileFocus/
 * whileTap, and the labels propagate down through the plain SVG to these
 * elements. The whole row is the hover target, not just the glyph, and any
 * container can drive one the same way.
 *
 * One color throughout: everything strokes currentColor and inherits the
 * row's text token (styles.md 2.4). Opacity is the only non-transform channel.
 *
 * Motion v12 applies SVG sub-element transforms as CSS transforms with
 * transform-box: fill-box, so originX/originY (0-1) are relative to each
 * element's own bounding box; every pivot here relies on that.
 */
export type { NavIconProps } from "./types";
export { IconSvg } from "./IconSvg";
export { EASE_STANDARD, EASE_ENTRANCE, SETTLE } from "./motion-tokens";

export { OverviewIcon } from "./OverviewIcon";
export { ProductsIcon } from "./ProductsIcon";
export { StorefrontIcon } from "./StorefrontIcon";
export { OrdersIcon } from "./OrdersIcon";
export { AnalyticsIcon } from "./AnalyticsIcon";
export { PaymentsIcon } from "./PaymentsIcon";
export { SettingsIcon } from "./SettingsIcon";
export { DiscoverIcon } from "./DiscoverIcon";
