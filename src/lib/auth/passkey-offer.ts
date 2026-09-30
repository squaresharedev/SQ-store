import { cookies } from "next/headers";
import { open, seal } from "@/lib/auth/passkey-crypto";

/**
 * THE TICKET FOR "CREATE A PASSKEY ON THIS DEVICE".
 *
 * That offer adds a way into the account without the usual second proof in
 * the same request, so it must be reachable ONLY from the end of a sign-in
 * challenge the person passed themselves with a code from their authenticator
 * app. Not after a sign-in approval (someone talked into approving would hand
 * the attacker a permanent passkey), and not from any later step-up (a session
 * found or stolen afterwards must not be able to plant one either).
 *
 * The ticket is a sealed, HttpOnly cookie minted by the code-challenge action
 * alone, bound to the account AND the session, and good for a few minutes.
 * The passkey-here actions refuse without it and spend it once the passkey is
 * made.
 *
 * SERVER ONLY. Not a "use server" module.
 */

const COOKIE = "ss_passkey_offer";
const OFFER_SECONDS = 5 * 60;

function context(userId: string, sessionId: string): string {
  return `passkey-offer:v1:${userId}:${sessionId}`;
}

/** Mint the ticket, right after a successful authenticator-app sign-in. */
export async function grantPasskeyOffer(userId: string, sessionId: string | null): Promise<void> {
  if (!sessionId) return;
  const exp = Math.floor(Date.now() / 1000) + OFFER_SECONDS;
  const sealed = await seal(JSON.stringify({ exp }), context(userId, sessionId));
  if (!sealed) return;
  (await cookies()).set(COOKIE, sealed, {
    path: "/",
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    maxAge: OFFER_SECONDS,
  });
}

/** Whether this session holds a live ticket of its own. */
export async function hasPasskeyOffer(userId: string, sessionId: string | null): Promise<boolean> {
  if (!sessionId) return false;
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw || raw.length > 400) return false;
  const plain = await open(raw, context(userId, sessionId));
  if (!plain) return false;
  try {
    const { exp } = JSON.parse(plain) as { exp?: unknown };
    return typeof exp === "number" && exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

/** Spent: the passkey was made. */
export async function spendPasskeyOffer(): Promise<void> {
  (await cookies()).delete(COOKIE);
}
