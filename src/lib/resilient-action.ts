import { unstable_isUnrecognizedActionError, unstable_rethrow } from "next/navigation";
import { msg } from "@/i18n/types";
import { actionError, failed, type ActionState } from "@/lib/errors";

/**
 * SERVER ACTIONS THAT SURVIVE A REQUEST THAT NEVER CAME BACK, for the screens a
 * person must get through to use the app at all: signing in, the two-factor
 * challenge, approving a sign-in, and setting two-factor up.
 *
 * Why it exists: Cloudflare stops the Worker mid-request when it runs past its
 * CPU allowance and answers with its own "Error 1102" page (503) instead of
 * the action's reply. Next.js's client turns any answer that is not the
 * action's own into a thrown error, and a thrown error from `useActionState`
 * replaces the WHOLE page with the error boundary: the sign-in screen is gone,
 * the code typed into it with it, and "Try again" reloads into the same wall.
 * Seen in production on 2026-10-28: a phone approving a sign-in had its code
 * check and its tap on the number stopped this way, about sixty times in four
 * minutes. A dropped mobile connection fails the same way.
 *
 * So: ask again, a few times, spread out (the allowance refills within
 * seconds), while the button keeps its spinner; then, if it still has not
 * come back, hand the form an ordinary error it shows in place. The page never
 * goes down.
 *
 * ONLY FOR ACTIONS THAT ARE SAFE TO SEND TWICE. A stopped request may have
 * done some of its work before it was stopped. Every action wrapped with this
 * is single-use on the server already (a code is spent once, a sign-in
 * request is decided once, a passkey challenge is sealed to one session), so
 * a second try either finishes the job or gets a clear refusal. Do not wrap an
 * action whose second run would do its work twice (a payment, an order).
 *
 * What is never retried: an answer the action gave (its returned state, or an
 * error it threw, which arrives with a `digest`), a redirect (the action's
 * answer too), and a page older than the deploy (only a reload helps, and the
 * error boundary offers one).
 */

/**
 * How long to wait before each new try (ms): seven tries over about fifteen
 * seconds. In production a stopped Worker took from a few seconds to over
 * half a minute to answer again, with most pages served within ten.
 * public/sw.js waits on the same schedule for page loads, and
 * tests/unit/pwa.test.ts holds the two copies together.
 */
export const RETRY_DELAYS_MS: readonly number[] = [500, 1000, 2000, 3000, 4000, 5000];

/** What a sign-in, two-factor or approval form shows once its tries run out. */
export const SIGN_IN_UNREACHABLE: ActionState = failed(
  actionError("server_error", msg("Errors.mfa.unreachable")),
);

/** The same, for a form that is not part of signing in. */
export const FORM_UNREACHABLE: ActionState = failed(
  actionError("server_error", msg("Errors.form.unreachable")),
);

/**
 * The request failed on the way (the network) or came back as something that
 * is not the action's reply (Cloudflare's error page, a gateway timeout). An
 * error the action itself threw carries a digest from the server.
 */
function neverAnswered(error: unknown): boolean {
  return !(error instanceof Error && "digest" in error);
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * A new copy of an object answer, so a form that notices its state CHANGING
 * (a passkey form resets its button that way) sees a second failure as new
 * rather than as the same state it already showed.
 */
function fresh<Result>(answer: Result): Result {
  return typeof answer === "object" && answer !== null ? ({ ...answer } as Result) : answer;
}

/**
 * `action`, asking again while its request never comes back, and answering
 * `unreachable` once it has run out of tries (or the action threw). Usable
 * anywhere the action is: `useActionState`, a form's `action`, or a plain
 * call. Define it once, at module scope
 * (`const verifyCode = resilientAction(verifyTwoFactorSignIn, SIGN_IN_UNREACHABLE)`),
 * so each render hands React the same function.
 */
export function resilientAction<Args extends unknown[], Result>(
  action: (...args: Args) => Promise<Result>,
  // The action alone decides the type: a narrower fallback must not narrow it.
  unreachable: NoInfer<Result>,
  delays: readonly number[] = RETRY_DELAYS_MS,
): (...args: Args) => Promise<Result> {
  return async (...args) => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await action(...args);
      } catch (error) {
        // The action's own answer: a redirect (or not-found) to follow.
        unstable_rethrow(error);
        if (unstable_isUnrecognizedActionError(error as unknown)) throw error;
        const delay = delays[attempt];
        if (delay === undefined || !neverAnswered(error)) {
          console.warn(
            "[action] gave up after",
            attempt + 1,
            attempt === 0 ? "try:" : "tries:",
            error instanceof Error ? error.message : String(error),
          );
          return fresh(unreachable);
        }
        await wait(delay);
      }
    }
  };
}
