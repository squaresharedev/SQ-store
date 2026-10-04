import { ANATOMY } from "./anatomy";
import { AUTH } from "./auth";
import { BILLING } from "./billing";
import { PRODUCTS } from "./products";
import type { Specimen } from "./types";

export type { Specimen };

/**
 * Every dialog the gallery shows, the real ones first (grouped as the app
 * groups them) and the building blocks they are made of last. A new dialog
 * gets an entry in the file for its area.
 */
export const SPECIMENS: readonly Specimen[] = [...AUTH, ...BILLING, ...PRODUCTS, ...ANATOMY];
