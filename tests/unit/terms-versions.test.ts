import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TERMS_CHANGES } from "@/lib/legal/terms-changes";
import {
  LATEST_TERMS_VERSION,
  TERMS_NOTICE_DAYS,
  TERMS_VERSIONS,
  agreementOutdated,
  resolveTermsStatus,
  termsVersionUrl,
  type TermsVersionRow,
} from "@/lib/legal/terms-versions";
import { LEGAL_VERSION } from "@/lib/settings/constants";
import { english } from "../setup/translate";

const OLD = TERMS_VERSIONS[0].version;
const NEW = TERMS_VERSIONS[1].version;
const NOW = new Date("2026-11-20T12:00:00Z");

function row(version: string, fields: Partial<TermsVersionRow> = {}): TermsVersionRow {
  return { version, planned_effective_at: null, effective_at: null, ...fields };
}

describe("the list of Terms versions", () => {
  const versions = TERMS_VERSIONS.map(({ version }) => version);

  it("is dated, in order, with no repeats", () => {
    for (const version of versions) expect(version).toMatch(/^tos-\d{4}-\d{2}-\d{2}$/);
    expect(versions).toEqual([...new Set(versions)].sort());
  });

  it("is what anyone agreeing today agrees to", () => {
    expect(LEGAL_VERSION).toBe(LATEST_TERMS_VERSION);
    expect(LATEST_TERMS_VERSION).toBe(versions[versions.length - 1]);
  });

  it("says what changed in every version after the first, in words that exist", () => {
    for (const version of versions.slice(1)) {
      const changes = TERMS_CHANGES[version];
      expect(changes?.length, `${version} needs an entry in terms-changes.ts`).toBeGreaterThan(0);
      for (const key of changes) expect(english(key)).not.toBe(key);
    }
  });

  it("gives each version an address that never moves", () => {
    expect(termsVersionUrl(NEW)).toBe(`https://squareshare.eu/terms/v/${NEW}/`);
  });

  it("agrees with the database about how long the notice is", () => {
    const sql = readFileSync("supabase/migrations/20261031_terms_notices.sql", "utf8");
    expect(TERMS_NOTICE_DAYS).toBe(30);
    expect(sql).toContain(`interval '${TERMS_NOTICE_DAYS} days'`);
  });
});

describe("which Terms apply", () => {
  it("is the first version when nothing has been recorded", () => {
    expect(resolveTermsStatus([], NOW)).toEqual({
      inForce: OLD,
      upcoming: { version: NEW, effectiveAt: null },
    });
  });

  it("does not move just because a newer version is listed or its notice started", () => {
    const status = resolveTermsStatus(
      [
        row(OLD, { effective_at: "2026-10-11T00:00:00Z" }),
        row(NEW, { planned_effective_at: "2026-12-01T00:00:00Z" }),
      ],
      NOW,
    );
    expect(status.inForce).toBe(OLD);
    expect(status.upcoming).toEqual({ version: NEW, effectiveAt: "2026-12-01T00:00:00Z" });
  });

  it("keeps the old version until the very moment the new one takes effect", () => {
    const rows = [
      row(OLD, { effective_at: "2026-10-11T00:00:00Z" }),
      row(NEW, { effective_at: NOW.toISOString() }),
    ];
    expect(resolveTermsStatus(rows, new Date(NOW.getTime() - 1)).inForce).toBe(OLD);
    expect(resolveTermsStatus(rows, NOW)).toEqual({ inForce: NEW, upcoming: null });
  });
});

describe("whether someone has to agree again", () => {
  it("asks anyone who never agreed", () => {
    expect(agreementOutdated(null, null)).toBe(true);
    expect(agreementOutdated(null, OLD)).toBe(true);
  });

  it("does not ask during the notice, only once a newer version is in force", () => {
    expect(agreementOutdated(OLD, OLD)).toBe(false);
    expect(agreementOutdated(OLD, NEW)).toBe(true);
  });

  it("counts agreeing early", () => {
    expect(agreementOutdated(NEW, OLD)).toBe(false);
  });

  it("asks nobody who has agreed when the version in force cannot be read", () => {
    expect(agreementOutdated(OLD, null)).toBe(false);
  });
});
