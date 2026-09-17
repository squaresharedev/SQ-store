"use client";

import { createContext, useContext } from "react";

/**
 * Whether the designer below is the SAMPLE storefront (lib/storefront/sample.ts),
 * where nothing may reach the server: no save, no upload, no product edit.
 *
 * A context rather than a prop, because the controls that would otherwise talk
 * to the server sit several panels deep (the background and font uploads inside
 * the theme settings, the product editor inside the inspector, the product page
 * artboard on the canvas), and threading one boolean through every panel between
 * them would touch far more of the designer than the few places that ask.
 */
const SampleModeContext = createContext(false);

export const SampleModeProvider = SampleModeContext.Provider;

export function useSampleMode(): boolean {
  return useContext(SampleModeContext);
}
