"use client";

/**
 * Animated action icons for in-page controls (icon buttons, button leading
 * slots). Geometry is lifted verbatim from lucide-react (ISC) so an icon at
 * rest is pixel-identical to the static original it replaces; each sub-element
 * is a motion primitive so the icon can perform its action on hover.
 *
 * Trigger contract, same as the nav icons: the CONTROL is the motion component
 * and switches between the "idle" and "hover" variant labels (see
 * useIconHoverProps), which propagate down through the plain <svg> to these
 * elements. Hovering anywhere on the button animates the glyph.
 *
 * One color throughout: everything strokes currentColor and inherits the
 * button's text token, so an icon in a destructive button turns red with it.
 */
export { ActionIconSvg } from "./ActionIconSvg";
export { useIconHoverProps } from "./hover-props";

export { EmbedCodeIcon } from "./EmbedCodeIcon";
export { RotateArrowIcon } from "./RotateArrowIcon";
