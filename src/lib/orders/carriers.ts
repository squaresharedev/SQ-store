import { CARRIER_IDS, type CarrierId, type ShipTo, type TrackingLink } from "@/types/order-view";

/**
 * THE CARRIERS a seller can name beside a tracking number, and where each one's
 * parcels are followed. Client-safe and pure.
 *
 * WHY A FIXED LIST. A tracking number is held to reference-code characters
 * because it is shown to a buyer on the seller's behalf (lib/validation/orders.ts),
 * and a link has to meet the same bar: a seller never types a URL. They pick a
 * carrier, and the link is BUILT here from that carrier's own https tracking
 * page plus the encoded number. Nothing a seller writes can point a buyer
 * anywhere else, and nothing is stored but the carrier's id.
 *
 * Names are the carriers' own (proper nouns, the same in every language), so
 * they are data here and not catalogue messages.
 */

/** What a tracking page may need besides the number: PostNL asks where the
 *  parcel is going before it shows anything. */
type TrackingDestination = Pick<ShipTo, "country" | "postalCode">;

type Carrier = {
  name: string;
  /** The page for one parcel. `code` is already URL-encoded. */
  url: (code: string, to: TrackingDestination | null) => string;
};

const CARRIERS: Record<CarrierId, Carrier> = {
  "an-post": {
    name: "An Post",
    url: (code) => `https://www.anpost.com/Post-Parcels/Track/History?item=${code}`,
  },
  "ceska-posta": {
    name: "Česká pošta",
    url: (code) => `https://www.postaonline.cz/en/trackandtrace/-/zasilka/cislo?parcelNumbers=${code}`,
  },
  colissimo: {
    name: "La Poste (Colissimo)",
    url: (code) => `https://www.laposte.fr/outils/suivre-vos-envois?code=${code}`,
  },
  correos: {
    name: "Correos",
    url: (code) => `https://www.correos.es/es/en/tools/tracker/items/details?tracking-number=${code}`,
  },
  ctt: {
    name: "CTT",
    url: (code) =>
      `https://appserver.ctt.pt/CustomerArea/PublicArea_Detail?ObjectCodeInput=${code}&SearchInput=${code}&IsFromPublicArea=true`,
  },
  dhl: {
    name: "DHL",
    url: (code) => `https://www.dhl.com/global-en/home/tracking.html?tracking-id=${code}`,
  },
  dpd: {
    name: "DPD",
    url: (code) => `https://tracking.dpd.de/status/en_US/parcel/${code}`,
  },
  evri: {
    name: "Evri",
    url: (code) => `https://www.evri.com/track/parcel/${code}`,
  },
  fedex: {
    name: "FedEx",
    url: (code) => `https://www.fedex.com/fedextrack/?trknbr=${code}`,
  },
  gls: {
    name: "GLS",
    url: (code) => `https://gls-group.com/GROUP/en/parcel-tracking?match=${code}`,
  },
  inpost: {
    name: "InPost",
    url: (code) => `https://inpost.pl/sledzenie-przesylek?number=${code}`,
  },
  packeta: {
    name: "Packeta",
    url: (code) => `https://tracking.packeta.com/en/${code}`,
  },
  "poczta-polska": {
    name: "Poczta Polska",
    url: (code) => `https://emonitoring.poczta-polska.pl/?numer=${code}`,
  },
  "poste-italiane": {
    name: "Poste Italiane",
    url: (code) => `https://www.poste.it/cerca/index.html#/risultati-spedizioni/${code}`,
  },
  postnl: {
    name: "PostNL",
    // PostNL shows a parcel only to someone who knows where it is going, so
    // the destination rides in the link. Without a postcode the buyer lands on
    // the tracking page and types the number themselves.
    url: (code, to) => {
      const base = "https://jouw.postnl.nl/track-and-trace/";
      const postcode = to?.postalCode?.replace(/\s+/g, "");
      if (!to || !postcode) return base;
      return `${base}${code}-${encodeURIComponent(to.country)}-${encodeURIComponent(postcode)}`;
    },
  },
  "royal-mail": {
    name: "Royal Mail",
    url: (code) => `https://www.royalmail.com/track-your-item#/tracking-results/${code}`,
  },
  "slovenska-posta": {
    name: "Slovenská pošta",
    url: (code) => `https://www.posta.sk/en/tracking-of-items#parcel=${code}`,
  },
  ups: {
    name: "UPS",
    url: (code) => `https://www.ups.com/track?tracknum=${code}`,
  },
};

/**
 * A stored carrier -> one this app knows, or null. DEGRADES like every other
 * order reader: the column's CHECK holds only the shape of an id, so a value
 * from a newer build (or a carrier since retired) reads as "no carrier" and the
 * order keeps its plain tracking number.
 */
export function parseCarrier(raw: unknown): CarrierId | null {
  return CARRIER_IDS.find((id) => id === raw) ?? null;
}

/** "DHL": the carrier as its customers know it. */
export function carrierName(carrier: CarrierId): string {
  return CARRIERS[carrier].name;
}

/** The picker's options, A to Z by name. */
export const CARRIER_OPTIONS: readonly { value: CarrierId; label: string }[] = CARRIER_IDS.map(
  (id) => ({ value: id, label: CARRIERS[id].name }),
).sort((a, b) => a.label.localeCompare(b.label, "en"));

/**
 * Where a buyer follows this parcel. Spaces a seller typed for legibility
 * ("RR 1234 5678 9IE") are dropped, and the rest is encoded, so the number can
 * only ever be a value in the carrier's own URL.
 */
export function trackingUrl(
  carrier: CarrierId,
  trackingNumber: string,
  to: TrackingDestination | null = null,
): string {
  return CARRIERS[carrier].url(encodeURIComponent(trackingNumber.replace(/\s+/g, "")), to);
}

/**
 * The link for a shipped order, or null when there is nothing to follow (no
 * number, or no carrier named). The one place the seller's panel and the
 * buyer's order page both ask, so they can never disagree about where a
 * parcel is tracked.
 */
export function trackingLinkFor(
  fulfilment: { trackingNumber: string | null; carrier: CarrierId | null },
  to: TrackingDestination | null,
): TrackingLink | null {
  const { trackingNumber, carrier } = fulfilment;
  if (!trackingNumber || !carrier) return null;
  return { carrier: carrierName(carrier), url: trackingUrl(carrier, trackingNumber, to) };
}
