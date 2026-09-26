import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { getLocale, getTranslations } from "next-intl/server";
import "./globals.css";
import { ScopedIntlProvider } from "@/i18n/ScopedIntlProvider";
import { LocaleSwitchProvider } from "@/i18n/LocaleSwitchProvider";
import { ToastProvider } from "@/components/ui/Toast";
import { THEME_BOOTSTRAP } from "@/lib/theme-mode";
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

// Inter — used for the muted caption/label texts (eyebrows, footer notes, form
// labels). Self-hosted variable face.
const inter = localFont({
  src: "./fonts/Inter.woff2",
  weight: "100 900",
  variable: "--font-inter",
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

// Offered to SELLERS as a storefront typeface; the dashboard itself never sets
// it. preload: false is the whole point: the face is declared on every page but
// fetched only when something actually renders in it, so a font most storefronts
// do not choose costs the app nothing. (Inter, above, is already loaded for the
// dashboard's own caption text, so offering it as a storefront font is free.)
const montserrat = localFont({
  src: "./fonts/Montserrat.woff2",
  weight: "100 900",
  variable: "--font-montserrat",
  display: "swap",
  preload: false,
});

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Dashboard.metadata.app");
  return {
    title: {
      default: t("title"),
      template: "%s | Square Share",
    },
    description: t("description"),
    robots: { index: false, follow: false }, // dashboard is private
  };
}

export const viewport: Viewport = {
  themeColor: "#ffffff",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // The resolved request locale (src/i18n/request.ts). Always a valid BCP 47
  // code from a fixed list, which matters beyond looks: the a11y suite's axe
  // scan fails on an empty or malformed `lang`.
  const locale = await getLocale();

  return (
    <html
      lang={locale}
      // globals.css sets scroll-behavior: smooth; Next 16 wants it declared
      // here too so it can disable smooth scrolling during route transitions.
      data-scroll-behavior="smooth"
      // The theme script below stamps data-theme here before hydration, which
      // is a server/client difference React would otherwise flag. Scoped to
      // this element's own attributes, so nothing in the tree is masked.
      suppressHydrationWarning
      className={cn(
        // Dashboard runs in light mode: it never opts into the resolved palette
        // (see `.theme-surface` in globals.css), so data-theme below has no
        // visual effect here.
        spaceGrotesk.variable,
        geist.variable,
        jetbrainsMono.variable,
        inter.variable,
        shadowsIntoLight.variable,
        montserrat.variable,
        "font-sans",
      )}
    >
      <head>
        {/* Resolves light/dark before first paint (lib/theme-mode.ts). It sets an
            attribute the dashboard deliberately ignores today; see lib/theme-mode.ts
            for what actually opts in.

            A plain <script> in <head>, NOT next/script: `beforeInteractive`
            emits it as a direct child of <html>, which React rejects outright
            ("cannot render a sync or defer script outside the main document").

            React does log one dev-only notice about this element on a route
            that CLIENT-renders its shell, which today means the error boundary.
            That is accepted rather than worked around: an inline script cannot
            execute on a client render whatever wrapper it wears, so the fix is
            not a different tag but a backstop — components/error/ThemeSync,
            which re-resolves the theme for exactly that case.

            The body is passed as a string CHILD rather than through a raw-HTML
            prop. <script> is a raw-text element so React emits it verbatim
            either way, and this keeps the codebase's "no HTML-injection sink
            anywhere" rule intact (tests/unit/search-input-hardening.test.ts).
            That rule is load-bearing here: the CSP in next.config.ts is
            report-only and cannot carry a nonce on this stack, so the absence
            of sinks IS the defence, and it only stays enforceable while it
            stays absolute. */}
        <script>{THEME_BOOTSTRAP}</script>
      </head>
      {/* Toasts are mounted at the ROOT, not per route group. Every surface
          that reports an outcome gets them — settings and the storefront
          editor live outside (dashboard), and a provider per group meant a
          toast raised just before a cross-group navigation was unmounted
          mid-sentence by the very navigation it was confirming. */}
      <body className="min-h-screen antialiased">
        {/* Outside the toast stack so toasts can render translated copy. Ships
            only the shared shell of the catalogue; each route group adds what
            its own client components need (src/i18n/scopes.ts). */}
        <ScopedIntlProvider scope="shell">
          <ToastProvider>
            <LocaleSwitchProvider>{children}</LocaleSwitchProvider>
          </ToastProvider>
        </ScopedIntlProvider>
      </body>
    </html>
  );
}
