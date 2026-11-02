/**
 * WHOSE LOGO A CONNECTED APP WEARS, decided by where its approval was sent and
 * never by the name it gave. Anyone can register an app called "Claude"; only
 * Anthropic receives codes at claude.ai, so a borrowed name gets a plain letter
 * tile, not someone else's logo.
 *
 * A new brand is one entry here plus its mark in components/agent/AppLogo.
 */
export const APP_BRANDS = {
  claude: { hosts: ["claude.ai", "claude.com"] },
} as const satisfies Record<string, { hosts: readonly string[] }>;

export type AppBrand = keyof typeof APP_BRANDS;

/** The brand whose host this is, or a subdomain of, or null. */
export function brandForHost(host: string | null | undefined): AppBrand | null {
  if (!host) return null;
  const name = host.toLowerCase();
  for (const [brand, { hosts }] of Object.entries(APP_BRANDS) as [AppBrand, { hosts: readonly string[] }][]) {
    if (hosts.some((known) => name === known || name.endsWith(`.${known}`))) return brand;
  }
  return null;
}
