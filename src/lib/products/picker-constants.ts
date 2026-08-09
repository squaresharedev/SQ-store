/**
 * Shared constants for the storefront designer's product picker.
 *
 * A module of its own because `picker-actions.ts` is a `"use server"` file, and
 * those may only export async functions — a constant exported from there is a
 * build error the moment the client component imports it. Keeping the number
 * here lets the input's `maxLength` and the action's clamp be the SAME value
 * rather than two literals that drift.
 */

/**
 * Longest search term the picker sends.
 *
 * Matched to the product title cap in `lib/validation/product.ts` (200): the
 * picker searches titles only, so a longer term cannot match anything that
 * exists. The client clamps for the affordance, the action clamps again
 * because a server action is a public endpoint and the client is not a gate.
 */
export const PICKER_SEARCH_MAX_LENGTH = 200;
