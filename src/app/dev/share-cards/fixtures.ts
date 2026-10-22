import type { ShareCardProduct } from "@/components/share-card/types";

/**
 * Products to judge the share cards on: one per thing a card has to survive
 * (a sale, sold out, a long name, a product its photo cropped, a white
 * product, no photo at all), on the sample storefront's
 * photos (same origin, so the cutout engine can read them) so the gallery
 * needs no account.
 */

const STORE = {
  storeName: "Loft & Grain",
  url: "https://squareshare.eu/s/loft-and-grain",
  urlLabel: "squareshare.eu",
} as const;

export const SHARE_CARD_FIXTURES: readonly (ShareCardProduct & { id: string; note: string })[] = [
  {
    id: "plain",
    note: "Plain",
    title: "Studio Headphones",
    price: 189,
    currency: "EUR",
    imageUrl: "/sample-storefront/headphones.webp",
    photo: { src: "/sample-storefront/headphones.webp", key: "/sample-storefront/headphones.webp" },
    soldOut: false,
    ...STORE,
  },
  {
    id: "sale",
    note: "On sale",
    title: "Field Camera",
    price: 249,
    currency: "EUR",
    sale: { price: 199, offerPercent: 20 },
    imageUrl: "/sample-storefront/camera.webp",
    photo: { src: "/sample-storefront/camera.webp", key: "/sample-storefront/camera.webp" },
    soldOut: false,
    ...STORE,
  },
  {
    id: "sold-out",
    note: "Sold out",
    title: "Desert Succulent",
    price: 24,
    currency: "EUR",
    imageUrl: "/sample-storefront/succulent.webp",
    photo: { src: "/sample-storefront/succulent.webp", key: "/sample-storefront/succulent.webp" },
    soldOut: true,
    ...STORE,
  },
  {
    id: "long",
    note: "Long name, big price",
    title: "Brushed Steel Wristwatch with a Hand-Stitched Leather Strap",
    price: 1120,
    currency: "EUR",
    imageUrl: "/sample-storefront/watch.webp",
    photo: { src: "/sample-storefront/watch.webp", key: "/sample-storefront/watch.webp" },
    soldOut: false,
    ...STORE,
  },
  {
    id: "cropped",
    note: "Cropped in its photo",
    title: "Bookshelf Speaker",
    price: 74.5,
    currency: "EUR",
    imageUrl: "/sample-storefront/speaker.webp",
    photo: { src: "/sample-storefront/speaker.webp", key: "/sample-storefront/speaker.webp" },
    soldOut: false,
    ...STORE,
  },
  {
    id: "white",
    note: "White product",
    title: "Wireless Mouse",
    price: 59,
    currency: "EUR",
    imageUrl: "/sample-storefront/mouse.webp",
    photo: { src: "/sample-storefront/mouse.webp", key: "/sample-storefront/mouse.webp" },
    soldOut: false,
    ...STORE,
  },
  {
    id: "no-photo",
    note: "No photo",
    title: "Untitled Print No. 4",
    price: 45,
    currency: "EUR",
    imageUrl: null,
    photo: null,
    soldOut: false,
    ...STORE,
  },
];
