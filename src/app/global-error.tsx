"use client";

import { useEffect, useSyncExternalStore } from "react";

/**
 * Last-resort boundary for crashes in the ROOT layout itself (error.tsx only
 * covers segments below it). When this renders, the layout that carries our
 * stylesheet and our fonts may not exist, so everything here is deliberately
 * self-contained: inline styles, system font stack, no imports from the design
 * system, and its own <html>/<body> pair (required by Next.js).
 *
 * That is why it does NOT reuse ErrorScreen or the pixel display — those are
 * built out of Tailwind tokens that this surface cannot assume are loaded. It
 * mirrors their palette by hand instead (black / white / grey / acid purple),
 * so the family still reads as one even when nothing else survived.
 */

// The palette this file has to hard-code, as custom properties so both themes
// can be declared without a second copy of every rule. Named after the tokens
// they mirror, so it is obvious what to update when globals.css moves.
//
// System-only, unlike the other error screens: a saved preference lives in
// localStorage, and reading it needs a script this surface deliberately does not
// run. When the root layout has failed badly enough to land here, following the
// OS is the right amount of cleverness.
const PALETTE = `
:root {
  color-scheme: light dark;
  --ge-surface: #ffffff;   /* --background */
  --ge-ink: #0a0a0a;       /* --foreground */
  --ge-muted: #737373;     /* --muted-foreground */
  --ge-border: #e5e5e5;    /* --border */
  --ge-cta: #0a0a0a;       /* --primary (light is black, per styles.md) */
  --ge-cta-ink: #fafafa;   /* --primary-foreground */
}
@media (prefers-color-scheme: dark) {
  :root {
    --ge-surface: #000000;
    --ge-ink: #ffffff;
    --ge-muted: #a1a1aa;
    --ge-border: rgba(255, 255, 255, 0.12);
    --ge-cta: #a855f7;     /* the brand purple carries the CTA on black */
    --ge-cta-ink: #000000;
  }
}`;

/**
 * This surface's only copy, in every UI language (the locales in
 * src/i18n/locales.ts; a unit test holds the two lists together). In code
 * rather than in messages/, like DELETE_CONFIRM_PHRASES, because the
 * translation provider lives in the root layout, which is what failed. Not
 * imported from anywhere for the same reason: this file must not depend on a
 * module that could be part of the crash.
 */
export const GLOBAL_ERROR_COPY = {
  en: {
    title: "Something went wrong",
    body: "The app failed to load. This is usually temporary: your account and data are fine.",
    retry: "Try again",
  },
  cs: {
    title: "Něco se pokazilo",
    body: "Aplikaci se nepodařilo načíst. Obvykle jde o dočasný problém: váš účet i data jsou v pořádku.",
    retry: "Zkusit znovu",
  },
  de: {
    title: "Etwas ist schiefgelaufen",
    body: "Die App konnte nicht geladen werden. Das ist meist nur vorübergehend: Dein Konto und deine Daten sind in Ordnung.",
    retry: "Erneut versuchen",
  },
  fr: {
    title: "Une erreur est survenue",
    body: "L’application n’a pas pu se charger. C’est généralement temporaire : votre compte et vos données n’ont rien.",
    retry: "Réessayer",
  },
  es: {
    title: "Algo ha ido mal",
    body: "No se ha podido cargar la aplicación. Suele ser algo temporal: tu cuenta y tus datos están bien.",
    retry: "Inténtalo de nuevo",
  },
  it: {
    title: "Qualcosa è andato storto",
    body: "Non è stato possibile caricare l’app. Di solito è un problema temporaneo: il tuo account e i tuoi dati sono al sicuro.",
    retry: "Riprova",
  },
  nl: {
    title: "Er is iets misgegaan",
    body: "De app kon niet worden geladen. Dit is meestal tijdelijk: je account en gegevens zijn in orde.",
    retry: "Opnieuw proberen",
  },
  pl: {
    title: "Coś poszło nie tak",
    body: "Nie udało się wczytać aplikacji. To zwykle chwilowy problem: twoje konto i dane są bezpieczne.",
    retry: "Spróbuj ponownie",
  },
  "pt-PT": {
    title: "Ocorreu um erro",
    body: "Não foi possível carregar a aplicação. Normalmente, é temporário: a sua conta e os seus dados estão bem.",
    retry: "Tentar novamente",
  },
  sk: {
    title: "Niečo sa pokazilo",
    body: "Aplikáciu sa nepodarilo načítať. Zvyčajne ide o dočasný problém: váš účet aj údaje sú v poriadku.",
    retry: "Skúsiť znova",
  },
} as const;

export type GlobalErrorLocale = keyof typeof GLOBAL_ERROR_COPY;

function isGlobalErrorLocale(value: string): value is GlobalErrorLocale {
  return Object.hasOwn(GLOBAL_ERROR_COPY, value);
}

/**
 * The copy's language for a browser language tag: its primary subtag
 * ("cs-CZ" is cs), with every Portuguese meaning pt-PT, the one shipped, and
 * anything unsupported meaning English.
 */
export function globalErrorLocale(language: string | undefined): GlobalErrorLocale {
  const primary = (language ?? "").split("-")[0].toLowerCase();
  if (primary === "pt") return "pt-PT";
  return isGlobalErrorLocale(primary) ? primary : "en";
}

// The browser's language, read through useSyncExternalStore: the server
// snapshot is English, so the server render and the hydrating render agree
// and only then does the copy switch. It never changes while this is on
// screen, hence the no-op subscribe.
const subscribeNever = () => () => {};
const readBrowserLocale = () => globalErrorLocale(navigator.language);
const readServerLocale = (): GlobalErrorLocale => "en";

const INK = "var(--ge-ink)";
const SURFACE = "var(--ge-surface)";
const MUTED = "var(--ge-muted)";
const BORDER = "var(--ge-border)";

const linkStyle: React.CSSProperties = {
  fontFamily: "ui-monospace, monospace",
  fontSize: "0.75rem",
  textTransform: "uppercase",
  letterSpacing: "0.1em",
  color: MUTED,
  textDecoration: "none",
};

export default function GlobalError({
  error,
  unstable_retry,
  reset,
}: {
  error: Error & { digest?: string };
  // See error.tsx: Next 16.2 supersedes `reset` with a retry that re-fetches
  // first, which is what a root-layout crash usually needs.
  unstable_retry?: () => void;
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[global error boundary]", error);
  }, [error]);

  const locale = useSyncExternalStore(
    subscribeNever,
    readBrowserLocale,
    readServerLocale,
  );
  const copy = GLOBAL_ERROR_COPY[locale];

  return (
    <html lang={locale}>
      <head>
        {/* Passed as a string child rather than through a raw-HTML prop:
            <style> is a raw-text element so the CSS lands verbatim, and the
            codebase's no-HTML-sink rule stays absolute. See layout.tsx for why
            that matters. */}
        <style>{PALETTE}</style>
      </head>
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          background: SURFACE,
          color: INK,
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
        }}
      >
        <main
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "2.5rem 1.5rem",
            textAlign: "center",
          }}
        >
          <p
            style={{
              margin: 0,
              fontFamily: "ui-monospace, monospace",
              fontSize: "clamp(4rem, 18vw, 9rem)",
              fontWeight: 700,
              lineHeight: 1,
              letterSpacing: "0.08em",
              color: INK,
            }}
          >
            500
          </p>
          <h1
            style={{
              margin: "1.5rem 0 0",
              fontSize: "1.25rem",
              fontWeight: 600,
              letterSpacing: "-0.01em",
            }}
          >
            {copy.title}
          </h1>
          <p
            style={{
              margin: "0.75rem 0 0",
              maxWidth: "24rem",
              fontSize: "0.875rem",
              lineHeight: 1.6,
              color: MUTED,
            }}
          >
            {copy.body}
          </p>
          <button
            type="button"
            onClick={() => (unstable_retry ?? reset)()}
            style={{
              marginTop: "2rem",
              background: "var(--ge-cta)",
              color: "var(--ge-cta-ink)",
              border: "none",
              padding: "0.625rem 1rem",
              fontSize: "0.875rem",
              fontWeight: 500,
              fontFamily: "inherit",
              cursor: "pointer",
            }}
          >
            {copy.retry}
          </button>
          {error.digest && (
            <p
              style={{
                margin: "1.5rem 0 0",
                fontFamily: "ui-monospace, monospace",
                fontSize: "0.75rem",
                color: MUTED,
              }}
            >
              Reference: {error.digest}
            </p>
          )}
        </main>

        <footer
          style={{
            borderTop: `1px solid ${BORDER}`,
            padding: "1.5rem",
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "center",
            gap: "1.5rem",
          }}
        >
          {/* Hard-coded ON PURPOSE, unlike every other surface, which imports
              them from lib/legal/links.ts. This boundary renders when the root
              layout itself has failed, so it must not depend on a module that
              could be part of what failed. The cost is that these two hrefs
              have to be updated alongside that file. They are the only copies
              left, and nothing else may add a third. */}
          <a style={linkStyle} href="https://squareshare.eu/legal/privacy-policy/">
            Privacy
          </a>
          <a style={linkStyle} href="https://squareshare.eu/terms">
            Terms
          </a>
          <a style={linkStyle} href="mailto:squareshare.to@gmail.com">
            Contact
          </a>
          <span style={{ ...linkStyle, textTransform: "none" }}>
            © 2026 Squareshare
          </span>
        </footer>
      </body>
    </html>
  );
}
