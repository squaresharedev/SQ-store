/**
 * The mask, made decisive. A background-removal model answers in degrees:
 * most of the photo is clearly product or clearly not, but a little of it is
 * "a bit of both", and on a card that shows as a haze round the product or a
 * see-through patch in a white one. This pushes those middling answers toward
 * a side, along a smooth curve so an edge still feathers. Pure; rewrites the
 * alpha channel of `rgba` in place.
 */

/** Alpha below which a pixel is background, and above which it is product,
 *  as a share of full (between the two the curve feathers). Tuned on the
 *  sample storefront's photos with ormbg: lower and the haze stays, higher
 *  and thin parts (a headphone cable, a succulent's spikes) start to break. */
export const MASK_EDGE = { low: 0.25, high: 0.6 };

/** Alpha from which a pixel counts as part of the product at all, and from
 *  which the model is sure of it (MASK_EDGE.high). */
const MASK_ANY = 0.1;

/** The least confidence (maskConfidence) a cutout needs to be used. Measured
 *  on the sample storefront's photos with ormbg: every product it cut well
 *  came out 92 to 98% sure, the white mouse it could not tell from its white
 *  ground 26%. A card then shows the photo as is, not a see-through product. */
export const MIN_MASK_CONFIDENCE = 0.8;

/** How sure the model is of the product, 0..1: of the pixels it put in the
 *  product at all, the share it is sure of. Read on the RAW mask, before
 *  sharpenMask makes every answer look sure. */
export function maskConfidence(rgba: ArrayLike<number>): number {
  let any = 0;
  let sure = 0;
  for (let i = 3; i < rgba.length; i += 4) {
    const alpha = rgba[i] / 255;
    if (alpha > MASK_ANY) any += 1;
    if (alpha >= MASK_EDGE.high) sure += 1;
  }
  return any === 0 ? 0 : sure / any;
}

export function sharpenMask(rgba: Uint8ClampedArray, edge = MASK_EDGE): void {
  const span = edge.high - edge.low;
  for (let i = 3; i < rgba.length; i += 4) {
    const t = Math.min(1, Math.max(0, (rgba[i] / 255 - edge.low) / span));
    rgba[i] = Math.round(t * t * (3 - 2 * t) * 255);
  }
}
