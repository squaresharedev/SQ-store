// Shared environment + safety gate for the dev seed/reset scripts.
//
// These scripts run with the Supabase service_role key, which BYPASSES RLS and
// can read/write/delete any row. They are dev-only tooling: never imported by
// the Next.js app, never bundled, and gated so they cannot touch production.
//
// The guard fails CLOSED: unless SEED_ENV is explicitly "dev", we abort. A
// production environment never sets SEED_ENV=dev, so it can never be seeded.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export interface SeedConfig {
  url: string;
  serviceRoleKey: string;
  testSellerId: string;
  projectRef: string;
}

/** Print a reason and exit non-zero. Used for every refusal path. */
export function fail(message: string): never {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

/** Derive the Supabase project ref (subdomain) from the project URL. */
function projectRefFromUrl(url: string): string {
  try {
    return new URL(url).hostname.split(".")[0] ?? "";
  } catch {
    return "";
  }
}

/**
 * Validate the environment and refuse to run against anything that is not an
 * explicitly opted-in dev target. This is the PROD GUARD.
 *
 * Reasoning for why this blocks a prod-looking target: the gate is fail-closed.
 * Production deployments do not set SEED_ENV=dev, so the very first check aborts
 * there. If an operator additionally pins SEED_ALLOWED_PROJECT_REF, we also
 * refuse any project ref that is not on that allowlist — so even with
 * SEED_ENV=dev set by mistake, pointing at the wrong project still aborts.
 */
export function requireDevConfig(): SeedConfig {
  const seedEnv = process.env.SEED_ENV;
  if (seedEnv !== "dev") {
    fail(
      `Refusing to run: SEED_ENV must be exactly "dev" (got ${seedEnv ? `"${seedEnv}"` : "unset"}).\n` +
        `  These scripts use the service_role key to write/delete test data and fail closed.\n` +
        `  Production never sets SEED_ENV=dev, so it can never be seeded or reset.\n` +
        `  Only set SEED_ENV=dev in .env.local if this is genuinely a disposable dev target.`,
    );
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) fail("NEXT_PUBLIC_SUPABASE_URL is not set.");

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    fail(
      "SUPABASE_SERVICE_ROLE_KEY is not set. It is a SERVER-ONLY secret — read it from\n" +
        "  .env.local (gitignored). Never prefix it with NEXT_PUBLIC_ and never commit it.",
    );
  }

  const projectRef = projectRefFromUrl(url);

  // Optional belt-and-suspenders: pin the exact dev project ref(s).
  const allowlist = process.env.SEED_ALLOWED_PROJECT_REF;
  if (allowlist) {
    const allowed = allowlist
      .split(",")
      .map((ref) => ref.trim())
      .filter(Boolean);
    if (!allowed.includes(projectRef)) {
      fail(
        `Refusing to run: project ref "${projectRef}" is not in SEED_ALLOWED_PROJECT_REF ` +
          `(${allowed.join(", ")}).`,
      );
    }
  }

  const testSellerId = process.env.TEST_SELLER_ID;
  if (!testSellerId) {
    fail(
      "TEST_SELLER_ID is not set. Refusing to guess an account.\n" +
        "  Set it to the auth user id you sign in to /dashboard with (Supabase → Auth → Users).",
    );
  }

  return { url, serviceRoleKey, testSellerId, projectRef };
}

/** A service_role Supabase client. Server-side only; bypasses RLS. */
export function createServiceClient(config: SeedConfig): SupabaseClient {
  return createClient(config.url, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Confirm TEST_SELLER_ID is a real auth user before we insert rows that FK to
 * auth.users — turns a cryptic FK violation into a clear, actionable message.
 */
export async function assertTestSellerExists(
  supabase: SupabaseClient,
  testSellerId: string,
): Promise<void> {
  const { data, error } = await supabase.auth.admin.getUserById(testSellerId);
  if (error || !data?.user) {
    fail(
      `TEST_SELLER_ID "${testSellerId}" is not a real auth user on this project.\n` +
        `  Use the id of the account you actually sign in to /dashboard with, or the\n` +
        `  dashboard (which shows the session user's rows) will look empty.`,
    );
  }
}
