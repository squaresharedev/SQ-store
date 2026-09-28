import { SHIP_TO_MAX, type ShipTo } from "@/types/order-view";

/**
 * Reading, writing and printing an order's delivery address.
 *
 * Client-safe (types and strings, nothing else), because the same answers are
 * needed on both sides: the order writer normalises what checkout collected,
 * the query maps the stored jsonb into the view, and the detail panel, the
 * copy button and the seller's "ship this" email all print it. One module, so
 * the address a seller copies is exactly the address they were shown.
 */

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;
const COUNTRY = /^[A-Z]{2}$/;

/** One field: trimmed, control characters dropped, capped. Empty is absent. */
function field(raw: unknown, max: number): string | undefined {
  if (typeof raw !== "string") return undefined;
  const clean = raw.replace(CONTROL_CHARS, " ").replace(/\s+/g, " ").trim().slice(0, max).trim();
  return clean || undefined;
}

/**
 * Anything claiming to be an address -> a ShipTo, or null.
 *
 * DEGRADES, never throws, like parseOrderSelection: orders are written by the
 * service role, so this column sits behind no form, and a malformed value must
 * cost the order its address line rather than the order. It is the WRITE
 * normaliser too (lib/orders/record.ts runs checkout's address through it
 * before storing), so what reaches the column is already in this shape and a
 * read never has to guess.
 *
 * An address missing its name, first line, city or country is not one a
 * parcel can be sent to, and reads as null: "no address" is an honest thing to
 * show a seller, and half an address on a label is a parcel that comes back.
 */
export function parseShipTo(raw: unknown): ShipTo | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const input = raw as Record<string, unknown>;

  const name = field(input.name, SHIP_TO_MAX.name);
  const line1 = field(input.line1, SHIP_TO_MAX.line1);
  const city = field(input.city, SHIP_TO_MAX.city);
  const country = typeof input.country === "string" ? input.country.trim().toUpperCase() : "";
  if (!name || !line1 || !city || !COUNTRY.test(country)) return null;

  const optional = {
    line2: field(input.line2, SHIP_TO_MAX.line2),
    region: field(input.region, SHIP_TO_MAX.region),
    postalCode: field(input.postalCode, SHIP_TO_MAX.postalCode),
    phone: field(input.phone, SHIP_TO_MAX.phone),
  };
  const present = Object.fromEntries(
    Object.entries(optional).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  return { name, line1, ...present, city, country };
}

/** Where the city and postcode lines go, by country. The rest of Europe
 *  writes "postcode city" on one line; these do not. */
const CITY_THEN_POSTCODE = new Set(["GB", "IE"]);
const CITY_REGION_POSTCODE = new Set(["US", "CA", "AU"]);

/**
 * The address as the lines of a parcel label, in the order the destination
 * country's post expects. `countryName` is the country printed in the
 * reader's language (lib/format/country.ts regionName); the code is used when
 * the runtime has no name for it.
 *
 * The phone is NOT a label line: it is shown and copied separately, because a
 * carrier form asks for it in its own field.
 */
export function shipToLines(address: ShipTo, countryName: string | null): string[] {
  const lines = [address.name, address.line1];
  if (address.line2) lines.push(address.line2);

  if (CITY_REGION_POSTCODE.has(address.country)) {
    const tail = [address.region, address.postalCode].filter(Boolean).join(" ");
    lines.push(tail ? `${address.city}, ${tail}` : address.city);
  } else if (CITY_THEN_POSTCODE.has(address.country)) {
    lines.push(address.city);
    if (address.region) lines.push(address.region);
    if (address.postalCode) lines.push(address.postalCode);
  } else {
    lines.push([address.postalCode, address.city].filter(Boolean).join(" "));
    if (address.region) lines.push(address.region);
  }

  lines.push(countryName ?? address.country);
  return lines;
}

/** The label as one block of text: what "Copy address" puts on the clipboard,
 *  and what the seller's email prints. */
export function formatShipTo(address: ShipTo, countryName: string | null): string {
  return shipToLines(address, countryName).join("\n");
}
