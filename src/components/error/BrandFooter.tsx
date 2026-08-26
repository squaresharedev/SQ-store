import { transitionClass } from "@/components/ui/control-styles";

/**
 * Company-wide footer for the error surfaces: the same legal, social and
 * attribution links the marketing site (Home) carries, trimmed to what is
 * useful when someone has landed somewhere broken.
 *
 * The legal pages live on the MARKETING origin, not this one — the dashboard
 * is a subdomain and has no /terms of its own — so those hrefs are absolute
 * and plain <a>, never next/link.
 */
const SITE = "https://squareshare.eu";

const LEGAL = [
  { label: "Privacy", href: `${SITE}/legal/privacy-policy/` },
  { label: "Cookies", href: `${SITE}/legal/cookie-policy/` },
  { label: "Terms", href: `${SITE}/terms` },
  { label: "Accessibility", href: `${SITE}/accessibility` },
];

// Brand glyphs as raw simple-icons paths: lucide dropped brand marks for
// trademark reasons, so there is no icon component to import. Kept identical to
// the marketing footer's copy of them.
const SOCIALS = [
  {
    label: "Instagram",
    href: "https://www.instagram.com/_squareshare",
    path: "M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z",
  },
  {
    label: "GitHub",
    href: "https://github.com/squaresharedev",
    path: "M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222 0 1.606-.014 2.898-.014 3.293 0 .322.216.694.825.576C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12",
  },
];

// `acid-ink` rather than raw `acid`: this is small text, and the raw accent
// only clears WCAG AA against a dark surface. The ink token steps itself for
// whichever palette is live (see globals.css).
const linkClass = `font-mono text-xs uppercase tracking-widest text-muted-foreground hover:text-acid-ink ${transitionClass}`;

export function BrandFooter() {
  return (
    <footer className="border-t border-border px-6 py-8">
      <div className="mx-auto flex max-w-5xl flex-col items-center gap-6 sm:flex-row sm:justify-between">
        <nav
          aria-label="Legal"
          className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3"
        >
          {LEGAL.map(({ label, href }) => (
            <a key={href} href={href} className={linkClass}>
              {label}
            </a>
          ))}
          <a href="mailto:squareshare.to@gmail.com" className={linkClass}>
            Contact
          </a>
        </nav>

        <div className="flex items-center gap-2">
          {SOCIALS.map(({ label, href, path }) => (
            <a
              key={label}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={label}
              className={`flex size-9 items-center justify-center border border-border text-muted-foreground hover:border-acid hover:bg-acid hover:text-surface-dark ${transitionClass}`}
            >
              <svg
                viewBox="0 0 24 24"
                width={16}
                height={16}
                fill="currentColor"
                aria-hidden="true"
              >
                <path d={path} />
              </svg>
            </a>
          ))}
        </div>
      </div>

      <p className="mx-auto mt-6 max-w-5xl text-center font-mono text-xs text-muted-foreground sm:text-left">
        © 2026 Squareshare. Built by{" "}
        <a
          href="https://rootlabs.studio"
          target="_blank"
          rel="noopener noreferrer"
          className={`text-foreground underline decoration-border underline-offset-4 hover:text-acid-ink hover:decoration-acid-ink ${transitionClass}`}
        >
          Root Labs
        </a>
        .
      </p>
    </footer>
  );
}
