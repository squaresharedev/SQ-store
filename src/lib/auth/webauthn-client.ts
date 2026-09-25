import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";

/**
 * The browser half of passkeys: run the WebAuthn prompt, hand back the signed
 * result as JSON text for a server action to verify (lib/auth/passkeys.ts).
 * Nothing here decides anything; a result is worthless until the server has
 * checked it against its own copy of the challenge.
 *
 * Each call must start from a click: Safari refuses a passkey prompt that was
 * not triggered by one, which is why the options are always fetched BEFORE
 * the button is pressed.
 */

export type CeremonyOutcome =
  | { ok: true; credential: string }
  | {
      ok: false;
      /**
       * cancelled: the person closed the prompt (or it timed out).
       * exists: this device already holds a passkey for the account.
       * unsupported: no WebAuthn in this browser.
       * failed: anything else.
       */
      reason: "cancelled" | "exists" | "unsupported" | "failed";
    };

export function passkeysSupported(): boolean {
  try {
    return browserSupportsWebAuthn();
  } catch {
    return false;
  }
}

function outcomeOf(error: unknown): CeremonyOutcome {
  const name = error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "AbortError") return { ok: false, reason: "cancelled" };
  if (name === "InvalidStateError") return { ok: false, reason: "exists" };
  if (name === "NotSupportedError") return { ok: false, reason: "unsupported" };
  return { ok: false, reason: "failed" };
}

/** Create a passkey from registration options. */
export async function createPasskey(
  optionsJSON: PublicKeyCredentialCreationOptionsJSON,
): Promise<CeremonyOutcome> {
  if (!passkeysSupported()) return { ok: false, reason: "unsupported" };
  try {
    const response = await startRegistration({ optionsJSON });
    return { ok: true, credential: JSON.stringify(response) };
  } catch (error) {
    return outcomeOf(error);
  }
}

/** Prove possession of one of the account's passkeys. */
export async function assertPasskey(
  optionsJSON: PublicKeyCredentialRequestOptionsJSON,
): Promise<CeremonyOutcome> {
  if (!passkeysSupported()) return { ok: false, reason: "unsupported" };
  try {
    const response = await startAuthentication({ optionsJSON });
    return { ok: true, credential: JSON.stringify(response) };
  } catch (error) {
    return outcomeOf(error);
  }
}
