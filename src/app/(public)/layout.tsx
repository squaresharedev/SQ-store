import type { Metadata } from "next";
import type { ReactNode } from "react";

/**
 * The buyer-facing side of the app. No session, no dashboard chrome, no
 * providers beyond what the root layout already mounts (fonts, toasts).
 *
 * Search engines are refused by default for everything under here; a product
 * page lifts that itself when its seller opted in (see generateMetadata).
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function PublicLayout({ children }: { children: ReactNode }) {
  return children;
}
