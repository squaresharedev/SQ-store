import type { User } from "@supabase/supabase-js";
import { renderSVG } from "uqr";
import { createAdminClient } from "@/lib/supabase/admin";
import type { createClient } from "@/lib/supabase/server";
import { APPROVAL_FACTOR_NAME, isApprovalFactor } from "@/lib/auth/assurance";
import type { DeviceLabel } from "@/lib/auth/device-label";
import { base64UrlEncode, open, passkeySealingConfigured, seal } from "@/lib/auth/passkey-crypto";
import { approveSignInPath } from "@/lib/auth/paths";

/**
 * SIGN-IN APPROVAL: finishing a sign-in from a device that is already signed in.
 *
 * The session waiting at the two-factor step shows a QR code. The person scans
 * it with their phone's camera, which opens Square Share on the phone, where
 * they are signed in (the session cookie is shared across squareshare.eu, so
 * the dashboard and the SQ app both count). One tap on Approve, and the
 * waiting session is let through. Built for the case that prompted it: the
 * browser's own "use a phone" passkey QR code, scanned with a phone that has
 * no passkey for Square Share because the passkey lives on another device.
 *
 * HOW aal2 STAYS MEANINGFUL. Exactly the passkey bridge (lib/auth/passkeys.ts):
 * the approval is backed by an ordinary GoTrue TOTP factor whose secret only
 * this server knows, sealed under MFA_PASSKEY_KEY in public.mfa_approval_factors.
 * An approval from a fully signed-in session of the SAME account is what makes
 * the server compute that factor's code and complete it, for the waiting
 * session only. GoTrue therefore still issues aal2, and the app gate, the
 * restrictive RLS and step-up all keep working unchanged.
 *
 * WHO COMPLETES THE FACTOR MATTERS. GoTrue deletes every aal1 session of an
 * account whenever any factor is verified (InvalidateSessionsWithAALLessThan,
 * checked in its source), so the approving phone must never verify anything
 * while the computer waits. The phone only ENROLS the factor, the first time
 * approval is used (GoTrue checks assurance at enrol, and the phone is aal2);
 * the waiting session VERIFIES it when it collects the approval (GoTrue does
 * not check assurance at verify). After that first use the factor is verified
 * and simply reused.
 *
 * WHAT A REQUEST IS BOUND TO. The account, and the waiting session's GoTrue
 * session id: only that session can collect an approval, and only once. The
 * QR code carries a 256-bit token that is stored only as its SHA-256.
 *
 * SERVER ONLY, and not a "use server" module: the callable actions live in
 * lib/auth/sign-in-approval-actions.ts.
 */

type ServerClient = Awaited<ReturnType<typeof createClient>>;

/** How long a QR code stays usable: time to find the phone, unlock it and scan. */
export const APPROVAL_REQUEST_SECONDS = 5 * 60;

/**
 * How long an approval waits for the waiting session to collect it. That page
 * checks every few seconds, so this is slack for a tab the browser throttled,
 * not a window anyone should need.
 */
const COLLECT_SECONDS = 2 * 60;

/** Finished requests are kept this long (the account's own housekeeping). */
const KEEP_SECONDS = 24 * 60 * 60;

const REQUESTS = "mfa_sign_in_approvals";
const FACTORS = "mfa_approval_factors";
const OPT_OUTS = "mfa_approval_opt_outs";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** The app's own origin, which the QR code points at. Never the request's Host. */
function appOrigin(): string | null {
  try {
    return new URL(process.env.NEXT_PUBLIC_APP_URL ?? "").origin;
  } catch {
    return null;
  }
}

/** Whether approval can work in this deployment at all (an origin + the sealing key). */
export async function approvalsConfigured(): Promise<boolean> {
  return appOrigin() !== null && (await passkeySealingConfigured());
}

/**
 * Whether the account has sign-in approval on (it is, unless it was turned off
 * in Settings › Security). Null when that cannot be read, which every caller
 * treats as "not available": a way in is never offered on a guess.
 */
export async function approvalsEnabled(userId: string): Promise<boolean | null> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from(OPT_OUTS)
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) {
      console.error("[approval] reading the opt-out failed:", error.message);
      return null;
    }
    return data === null;
  } catch (err) {
    console.error("[approval] reading the opt-out threw:", err instanceof Error ? err.message : String(err));
    return null;
  }
}

/**
 * Turn approval on or off for the account. Off also withdraws every request
 * still waiting, so a QR code already on someone's screen stops working now.
 * The factor itself stays (dormant): removing it would push every device that
 * signed in by approval back to the two-factor step (GoTrue downgrades the
 * sessions a removed factor vouched for).
 */
export async function setApprovalsEnabled(userId: string, enabled: boolean): Promise<boolean> {
  try {
    const admin = createAdminClient();
    if (enabled) {
      const { error } = await admin.from(OPT_OUTS).delete().eq("user_id", userId);
      return !error;
    }
    const { error } = await admin
      .from(OPT_OUTS)
      .upsert({ user_id: userId }, { onConflict: "user_id", ignoreDuplicates: true });
    if (error) return false;
    await admin
      .from(REQUESTS)
      .update({ status: "cancelled" })
      .eq("user_id", userId)
      .in("status", ["pending", "approved"]);
    return true;
  } catch (err) {
    console.error("[approval] switching failed:", err instanceof Error ? err.message : String(err));
    return false;
  }
}

// ---------------------------------------------------------------------------
// Tokens and QR codes
// ---------------------------------------------------------------------------

/** A token as minted here: 32 random bytes, base64url, so 43 characters. */
export function isApprovalToken(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}

function newToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * The QR code for a URL, as an <img>-safe data: URL. Dark modules on white
 * whatever the theme (phone cameras read them that way round), a quiet zone
 * of two modules, and medium error correction so a glare spot still scans.
 */
export function approvalQrCode(url: string): string {
  const svg = renderSVG(url, { ecc: "M", border: 2, pixelSize: 8 });
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export type NewApprovalRequest = {
  id: string;
  /** What the QR code encodes: this app's /approve page, token in the path. */
  url: string;
  qrCode: string;
  /** Unix seconds. */
  expiresAt: number;
};

/**
 * A new request for the waiting session, retiring any it had before (one live
 * QR code per session), and clearing this account's old requests.
 */
export async function createApprovalRequest(input: {
  userId: string;
  sessionId: string;
  device: DeviceLabel;
  country: string | null;
}): Promise<NewApprovalRequest | null> {
  const origin = appOrigin();
  if (!origin) return null;
  try {
    const admin = createAdminClient();
    await admin
      .from(REQUESTS)
      .update({ status: "cancelled" })
      .eq("session_id", input.sessionId)
      .eq("status", "pending");
    await admin
      .from(REQUESTS)
      .delete()
      .eq("user_id", input.userId)
      .lt("created_at", new Date(Date.now() - KEEP_SECONDS * 1000).toISOString());

    const token = newToken();
    const expiresAt = Math.floor(Date.now() / 1000) + APPROVAL_REQUEST_SECONDS;
    const { data, error } = await admin
      .from(REQUESTS)
      .insert({
        user_id: input.userId,
        session_id: input.sessionId,
        token_hash: await hashToken(token),
        browser: input.device.browser,
        os: input.device.os,
        country: input.country,
        expires_at: new Date(expiresAt * 1000).toISOString(),
      })
      .select("id")
      .single();
    if (error || !data) {
      console.error("[approval] creating a request failed:", error?.message);
      return null;
    }
    const url = `${origin}${approveSignInPath(token)}`;
    return { id: data.id, url, qrCode: approvalQrCode(url), expiresAt };
  } catch (err) {
    console.error("[approval] creating a request threw:", err instanceof Error ? err.message : String(err));
    return null;
  }
}

/** A request as the approving phone sees it. */
export type ApprovalRequestView = {
  id: string;
  userId: string;
  /** Still waiting for a decision, and not expired. */
  open: boolean;
  browser: string | null;
  os: string | null;
  country: string | null;
  createdAt: string;
};

/** The request a QR code's token names, or null (unknown, malformed, unreadable). */
export async function findApprovalRequest(token: string): Promise<ApprovalRequestView | null> {
  if (!isApprovalToken(token)) return null;
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from(REQUESTS)
      .select("id, user_id, status, browser, os, country, created_at, expires_at")
      .eq("token_hash", await hashToken(token))
      .maybeSingle();
    if (error || !data) return null;
    return {
      id: data.id,
      userId: data.user_id,
      open: data.status === "pending" && Date.parse(data.expires_at) > Date.now(),
      browser: data.browser,
      os: data.os,
      country: data.country,
      createdAt: data.created_at,
    };
  } catch {
    return null;
  }
}

/**
 * Record the phone's answer: one conditional UPDATE, so a request is decided
 * once, only while open, and only for its own account. True when this call
 * decided it. `factorId` (approve only) is the factor prepared for it.
 */
export async function decideApprovalRequest(input: {
  id: string;
  userId: string;
  decision: "approve" | "deny";
  factorId?: string;
}): Promise<boolean> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from(REQUESTS)
      .update({
        status: input.decision === "approve" ? "approved" : "denied",
        decided_at: new Date().toISOString(),
        factor_id: input.decision === "approve" ? (input.factorId ?? null) : null,
      })
      .eq("id", input.id)
      .eq("user_id", input.userId)
      .eq("status", "pending")
      .gt("expires_at", new Date().toISOString())
      .select("id");
    if (error) {
      console.error("[approval] recording a decision failed:", error.message);
      return false;
    }
    return (data ?? []).length === 1;
  } catch {
    return false;
  }
}

/** Where a waiting session's request stands. "gone": withdrawn, used, or never its own. */
export type WaitingStatus = "pending" | "approved" | "denied" | "expired" | "gone";

type OwnRequest = { id: string; userId: string; sessionId: string };

/** The waiting session's view of its own request. Null when it cannot be read. */
export async function waitingStatus(request: OwnRequest): Promise<WaitingStatus | null> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from(REQUESTS)
      .select("status, expires_at, decided_at")
      .eq("id", request.id)
      .eq("user_id", request.userId)
      .eq("session_id", request.sessionId)
      .maybeSingle();
    if (error) return null;
    if (!data) return "gone";
    const now = Date.now();
    if (data.status === "pending") return Date.parse(data.expires_at) > now ? "pending" : "expired";
    if (data.status === "approved") {
      const decided = data.decided_at ? Date.parse(data.decided_at) : 0;
      return decided + COLLECT_SECONDS * 1000 > now ? "approved" : "expired";
    }
    if (data.status === "denied") return "denied";
    return "gone";
  } catch {
    return null;
  }
}

/**
 * Collect an approval, once: one conditional UPDATE marks it used, so two
 * tabs of the same session racing each other cannot both spend it. Returns
 * the factor to complete, or null (not approved, too late, not this session's).
 */
export async function collectApproval(request: OwnRequest): Promise<string | null> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from(REQUESTS)
      .update({ status: "used", used_at: new Date().toISOString() })
      .eq("id", request.id)
      .eq("user_id", request.userId)
      .eq("session_id", request.sessionId)
      .eq("status", "approved")
      .gt("decided_at", new Date(Date.now() - COLLECT_SECONDS * 1000).toISOString())
      .not("factor_id", "is", null)
      .select("factor_id");
    if (error || !data || data.length !== 1) return null;
    return data[0].factor_id;
  } catch {
    return null;
  }
}

/** The waiting session gave up on its request (switched method, left the page). */
export async function cancelApprovalRequest(request: OwnRequest): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin
      .from(REQUESTS)
      .update({ status: "cancelled" })
      .eq("id", request.id)
      .eq("user_id", request.userId)
      .eq("session_id", request.sessionId)
      .eq("status", "pending");
  } catch {
    // Best-effort: an abandoned request expires by itself.
  }
}

// ---------------------------------------------------------------------------
// The factor
// ---------------------------------------------------------------------------

function secretContext(userId: string, factorId: string): string {
  return `approval-secret:v1:${userId}:${factorId}`;
}

/**
 * The approval factor to complete for a request this APPROVING session is
 * about to approve: the account's existing one when its sealed secret is
 * here, otherwise a new one, enrolled on the approver's own (aal2) client and
 * left for the waiting session to verify. Never verifies anything itself
 * (see the module comment for why). Null when none could be prepared.
 */
export async function prepareApprovalFactor(
  supabase: ServerClient,
  user: Pick<User, "id" | "factors">,
): Promise<string | null> {
  const factors = user.factors ?? [];
  try {
    const admin = createAdminClient();
    const { data: stored, error } = await admin
      .from(FACTORS)
      .select("factor_id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) {
      console.error("[approval] reading the factor failed:", error.message);
      return null;
    }
    // Verified, or still pending from an approval not yet collected: either
    // can be completed, and replacing a pending one would strand that approval.
    if (stored && factors.some((factor) => factor.id === stored.factor_id)) {
      return stored.factor_id;
    }

    // Nothing usable. Clear what is left (GoTrue names are unique per account,
    // and a factor with no secret here could never be completed anyway).
    if (stored) await admin.from(FACTORS).delete().eq("user_id", user.id);
    for (const factor of factors) {
      if (!isApprovalFactor(factor)) continue;
      const removed = await supabase.auth.mfa.unenroll({ factorId: factor.id }).catch(() => null);
      if (!removed || removed.error) {
        console.warn("[approval] could not clear an old approval factor:", removed?.error?.code);
        return null;
      }
    }

    const { data, error: enrollError } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: APPROVAL_FACTOR_NAME,
      issuer: "Square Share",
    });
    if (enrollError || !data || data.type !== "totp" || !data.totp.secret) {
      console.warn("[approval] enroll failed:", enrollError?.code, enrollError?.message);
      return null;
    }
    const sealed = await seal(data.totp.secret, secretContext(user.id, data.id));
    const { error: insertError } = sealed
      ? await admin.from(FACTORS).insert({ factor_id: data.id, user_id: user.id, sealed_secret: sealed })
      : { error: { message: "sealing unavailable" } };
    if (insertError) {
      console.error("[approval] storing the factor failed:", insertError.message);
      await supabase.auth.mfa.unenroll({ factorId: data.id }).catch(() => undefined);
      return null;
    }
    return data.id;
  } catch (err) {
    console.error("[approval] preparing the factor threw:", err instanceof Error ? err.message : String(err));
    return null;
  }
}

/** The approval factor's secret, for completeFactor. Null if it is not this account's. */
export async function approvalSecret(userId: string, factorId: string): Promise<string | null> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from(FACTORS)
      .select("sealed_secret")
      .eq("user_id", userId)
      .eq("factor_id", factorId)
      .maybeSingle();
    if (error || !data) return null;
    const secret = await open(data.sealed_secret, secretContext(userId, factorId));
    if (!secret) console.error("[approval] sealed secret would not open (key changed?)");
    return secret;
  } catch {
    return null;
  }
}

/**
 * Remove the approval factor through the admin API, for when the account's
 * last real factor goes: approval is never a way in on its own, so with no
 * passkey or app left, 2FA is off and this goes too.
 */
export async function removeApprovalFactor(userId: string): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.auth.admin.mfa.listFactors({ userId });
    if (error || !data) return;
    for (const factor of data.factors) {
      if (!isApprovalFactor(factor)) continue;
      const removed = await admin.auth.admin.mfa.deleteFactor({ id: factor.id, userId });
      if (removed.error) console.error("[approval] removing the factor failed:", removed.error.message);
    }
  } catch (err) {
    console.error("[approval] removing the factor threw:", err instanceof Error ? err.message : String(err));
  }
}
