import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ScopedIntlProvider } from "@/i18n/ScopedIntlProvider";

/**
 * The buyer-facing side of the app. No session, no dashboard chrome, no
 * providers beyond what the root layout already mounts (fonts, toasts).
 *
 * Search engines are refused by default for everything under here; a product
 * page lifts that itself when its seller opted in (see generateMetadata).
 *
 * NOT INSTALLABLE. The root layout offers the seller dashboard as an app
 * (app/manifest.ts, appleWebApp); a buyer looking at a product must not be
 * offered "Install Square Share" and land on a sign-in page, so both are
 * switched off here.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  manifest: null,
  appleWebApp: null,
};

export default function PublicLayout({ children }: { children: ReactNode }) {
  return <ScopedIntlProvider scope="public">{children}</ScopedIntlProvider>;
}
