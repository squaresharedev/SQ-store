/**
 * One client, as an anonymous rate limit should count it. Pure.
 *
 * An IPv4 address is one client. An IPv6 address is not: a home, a phone or a
 * rented server is handed at least a /64, and picks any of its 2^64 addresses
 * at will. Keyed on the whole address, every per-IP limit (checkout, order
 * lookup, OAuth registration, sign-in) would be one new address away from
 * fresh, so an IPv6 address counts as its /64, the smallest block that is
 * reliably one subscriber. IPv4 written as IPv6 (::ffff:a.b.c.d) counts as the
 * IPv4 address it is.
 *
 * Anything that does not parse is returned as it came, so it is still a key.
 */

/** How many leading 16-bit groups of an IPv6 address name one client: /64. */
export const IPV6_CLIENT_PREFIX_GROUPS = 4;

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const GROUP = /^[0-9a-f]{1,4}$/;

/** An IPv6 address as its eight 16-bit groups, or null when it is not one. */
function ipv6Groups(address: string): number[] | null {
  let text = address.toLowerCase();
  // A zone ("%eth0") names an interface on the sender's machine, not a client.
  const zone = text.indexOf("%");
  if (zone >= 0) text = text.slice(0, zone);

  // A trailing dotted IPv4 is the last two groups: write it as them.
  const lastColon = text.lastIndexOf(":");
  const v4 = IPV4.exec(text.slice(lastColon + 1));
  if (v4) {
    const bytes = v4.slice(1).map(Number);
    if (bytes.some((byte) => byte > 255)) return null;
    const hex = (high: number, low: number) => ((high << 8) | low).toString(16);
    text = `${text.slice(0, lastColon + 1)}${hex(bytes[0], bytes[1])}:${hex(bytes[2], bytes[3])}`;
  }

  const halves = text.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string) => (part === "" ? [] : part.split(":"));
  const head = parse(halves[0]);
  const rest = halves.length === 2 ? parse(halves[1]) : [];
  if (![...head, ...rest].every((group) => GROUP.test(group))) return null;
  const known = head.length + rest.length;
  // Without "::" all eight are written; with it, at least one group is implied.
  if (halves.length === 1 ? known !== 8 : known > 7) return null;
  const value = (group: string) => parseInt(group, 16);
  return [...head.map(value), ...new Array<number>(8 - known).fill(0), ...rest.map(value)];
}

export function clientLimitKey(address: string): string {
  if (!address.includes(":")) return address;
  const groups = ipv6Groups(address);
  if (!groups) return address;
  // ::ffff:a.b.c.d, an IPv4 client reaching us over IPv6.
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
    return [groups[6] >> 8, groups[6] & 255, groups[7] >> 8, groups[7] & 255].join(".");
  }
  const prefix = groups.slice(0, IPV6_CLIENT_PREFIX_GROUPS).map((group) => group.toString(16));
  return `${prefix.join(":")}::/${IPV6_CLIENT_PREFIX_GROUPS * 16}`;
}
