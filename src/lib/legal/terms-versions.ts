/**
 * EVERY VERSION OF THE TERMS OF SERVICE, oldest first. The newest is what anyone
 * agreeing today agrees to.
 *
 * TO CHANGE THE TERMS (docs/changing-the-terms.md has the whole recipe): add the
 * new version on the marketing site, add it here and in lib/legal/terms-changes.ts,
 * and deploy Home, then this app. Nothing else. No date is chosen by hand: the
 * daily job (lib/legal/terms-notices.ts) emails everyone, and the version takes
 * effect by itself once the 30 days have run from the last email.
 *
 * `urgentReason` is the only way around the 30 days, for a change the law forces
 * on us or that stops an unforeseen and imminent danger (Terms section 19).
 * Emails still go out; the wait does not apply. Being in a hurry is not a reason.
 *
 * IMPORT-FREE apart from the site's address: lib/settings/constants.ts reads this.
 */
import { SQUARESHARE_SITE } from "./links";

/** The notice everyone gets before new Terms apply. Mirrors the CHECK in
 *  20261031_terms_notices.sql, which refuses anything shorter. */
export const TERMS_NOTICE_DAYS = 30;

type TermsVersion = {
  version: string;
  urgentReason?: "law" | "danger";
};

// tos-2026-10-31 is on the marketing site but deliberately absent here: it was
// replaced by tos-2026-11-06 before any notice went out or anyone agreed to it,
// so it never takes effect (Home marks it `replacedBy`). Listing it would email
// everyone about Terms that were already superseded.
export const TERMS_VERSIONS = [
  { version: "tos-2026-10-11" },
  { version: "tos-2026-11-06" },
] as const satisfies readonly TermsVersion[];

/** What anyone agreeing today agrees to. Agreeing early is always allowed. */
export const LATEST_TERMS_VERSION: string = TERMS_VERSIONS[TERMS_VERSIONS.length - 1].version;

/** Where a seller reads and agrees to the Terms. */
export const LEGAL_SETTINGS_PATH = "/settings/legal";

/** A version's calendar date (tos-YYYY-MM-DD). */
export function termsVersionDate(version: string): string {
  return version.slice("tos-".length);
}

/** Where one version's full text stays readable for good, so an agreement can
 *  point at exactly what was agreed to. */
export function termsVersionUrl(version: string): string {
  return `${SQUARESHARE_SITE}/terms/v/${version}/`;
}

/** Whether someone who last agreed to `accepted` has yet to agree to `inForce`.
 *  Versions are dated, so they sort as text. */
export function agreementOutdated(accepted: string | null, inForce: string | null): boolean {
  if (accepted === null) return true;
  return inForce !== null && accepted < inForce;
}

/** A version's row in terms_versions. */
export type TermsVersionRow = {
  version: string;
  planned_effective_at: string | null;
  effective_at: string | null;
};

export type TermsStatus = {
  /** The version that applies right now. */
  inForce: string;
  /** The next version, if one is on its way. A null date means its notices have
   *  not finished going out, so nobody can say when yet. */
  upcoming: { version: string; effectiveAt: string | null } | null;
};

/**
 * Which version applies at `now`. A version counts only once its row says so:
 * being listed above, or being live on the site, changes nothing.
 */
export function resolveTermsStatus(rows: readonly TermsVersionRow[], now: Date): TermsStatus {
  const byVersion = new Map(rows.map((row) => [row.version, row]));
  const known: readonly string[] = TERMS_VERSIONS.map(({ version }) => version);
  let inForce = known[0];
  for (const version of known) {
    const effective = byVersion.get(version)?.effective_at;
    if (effective && new Date(effective) <= now) inForce = version;
  }
  const next = known.find((version) => version > inForce);
  if (!next) return { inForce, upcoming: null };
  const row = byVersion.get(next);
  return {
    inForce,
    upcoming: { version: next, effectiveAt: row?.effective_at ?? row?.planned_effective_at ?? null },
  };
}
