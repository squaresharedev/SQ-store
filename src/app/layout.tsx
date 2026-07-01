import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { cn } from "@/lib/utils";

// Self-hosted (downloaded from Google Fonts into ./fonts) so they build and
// render without a network round-trip to Google. Variable fonts declare a
// weight range; Shadows Into Light ships a single 400 weight. Shared with the
// marketplace (Home) project for a consistent brand.
const spaceGrotesk = localFont({
  src: "./fonts/SpaceGrotesk.woff2",
  weight: "300 700",
  variable: "--font-space-grotesk",
  display: "swap",
});

const geist = localFont({
  src: "./fonts/Geist.woff2",
  weight: "100 900",
  variable: "--font-geist",
  display: "swap",
});

const jetbrainsMono = localFont({
  src: "./fonts/JetBrainsMono.woff2",
  weight: "100 800",
  variable: "--font-jetbrains-mono",
  display: "swap",
});

// Hand-written founder voice, used only for the occasional self-correction, so
// we skip render-time preload.
const shadowsIntoLight = localFont({
  src: "./fonts/ShadowsIntoLight.woff2",
  weight: "400",
  variable: "--font-shadows-into-light",
  display: "swap",
  preload: false,
});

export const metadata: Metadata = {
  title: {
    default: "Square Share Dashboard",
    template: "%s | Square Share",
  },
  description:
    "Manage your products, design your storefront, connect Stripe, and view analytics on Square Share.",
  robots: { index: false, follow: false }, // dashboard is private
};

export const viewport: Viewport = {
  themeColor: "#000000",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={cn(
        "dark",
        spaceGrotesk.variable,
        geist.variable,
        jetbrainsMono.variable,
        shadowsIntoLight.variable,
        "font-sans",
      )}
    >
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
