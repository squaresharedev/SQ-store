/**
 * A fingerprint of a storefront's saved name and design, as the database holds
 * them.
 *
 * The editor is handed one when it loads and sends it back when it saves
 * (lib/storefront/actions.ts saveStorefront): a different fingerprint on the
 * row by then means someone else saved in between, from another tab or another
 * team member, and the save asks before overwriting their work instead of
 * silently winning.
 *
 * Not updated_at: the content check and staff decisions update the row as
 * well, and those must not read as somebody else's save. Always computed from
 * the row as read back (the database orders a design's keys its own way), so
 * two reads of the same saved design always agree.
 */
export async function storefrontVersion(name: string, config: unknown): Promise<string> {
  // One JSON array, so no name can run into the design that follows it.
  const text = JSON.stringify([name, config ?? null]);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
