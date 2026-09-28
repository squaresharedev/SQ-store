// SERVER ONLY. The one HTTP client for Brevo, which carries the platform's
// transactional email and SMS.
//
// WHY BREVO. It already relays Supabase Auth's mail for this project, from a
// sender domain verified there (scripts/auth-emails.ts), and one REST API with
// one key covers both channels the contact-verification flow needs. It is a
// plain HTTPS call, so it runs on Workers with no SDK and no SMTP socket.
//
// The key (BREVO_API_KEY) is a Worker secret: `wrangler secret put
// BREVO_API_KEY`, never wrangler.jsonc. It is a REST API key (xkeysib-...),
// which is NOT the SMTP key the Auth relay uses.

const BREVO_API = "https://api.brevo.com/v3";

/** How long one call may take before it counts as failed. */
const BREVO_TIMEOUT_MS = 10_000;

/**
 * A deployment that was told to send but has no way to. Thrown rather than
 * returned: "the recipient's server was busy" and "nobody configured the key"
 * are different problems, and the second must surface loudly.
 */
export class OutboundMisconfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutboundMisconfiguredError";
  }
}

/** A call Brevo answered with a refusal (bad number, no credit, rate limit). */
export class BrevoRequestError extends Error {
  constructor(readonly status: number, detail: string) {
    super(`Brevo answered ${status}: ${detail}`);
    this.name = "BrevoRequestError";
  }
}

/** POST a JSON body to a Brevo endpoint. Resolves on 2xx, throws otherwise. */
export async function brevoPost(path: string, body: unknown): Promise<void> {
  const key = process.env.BREVO_API_KEY?.trim();
  if (!key) {
    throw new OutboundMisconfiguredError(
      "Outbound delivery is enabled but BREVO_API_KEY is not set. Add it with `wrangler secret put BREVO_API_KEY`.",
    );
  }

  const response = await fetch(`${BREVO_API}${path}`, {
    method: "POST",
    headers: {
      "api-key": key,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(BREVO_TIMEOUT_MS),
  });
  if (response.ok) return;

  // Brevo's error body names the problem ({code, message}); it never echoes
  // the key, so it is safe to log. Capped so a surprise HTML page cannot flood
  // the log.
  const detail = (await response.text().catch(() => "")).slice(0, 300);
  throw new BrevoRequestError(response.status, detail);
}
