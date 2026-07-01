"use client";

import { useFormStatus } from "react-dom";
import { signInWithGoogle } from "@/lib/auth/actions";
import { Spinner } from "@/components/ui/spinner";

function GoogleButtonInner() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      suppressHydrationWarning
      className="inline-flex w-full items-center justify-center gap-3 border-2 border-neutral-300 bg-white px-7 py-2.5 text-sm font-bold text-neutral-900 transition-colors hover:border-neutral-400 hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:pointer-events-none disabled:opacity-50"
    >
      {pending ? <Spinner className="text-neutral-500" /> : <GoogleLogo />}
      Continue with Google
    </button>
  );
}

/** Google OAuth entry point — its own form so it never nests in the email form. */
export function GoogleButton({ next = "/" }: { next?: string }) {
  return (
    <form action={signInWithGoogle}>
      <input type="hidden" name="next" value={next} />
      <GoogleButtonInner />
    </form>
  );
}

function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.06 12.25c0-.85-.08-1.67-.22-2.45H12v4.64h6.2a5.3 5.3 0 0 1-2.3 3.48v2.9h3.72c2.18-2 3.44-4.96 3.44-8.57Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.1 0 5.7-1.03 7.6-2.78l-3.72-2.9c-1.03.7-2.35 1.1-3.88 1.1-2.98 0-5.5-2.01-6.4-4.72H1.76v2.99A12 12 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.6 14.7a7.2 7.2 0 0 1 0-4.6V7.11H1.76a12 12 0 0 0 0 10.78L5.6 14.7Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.68 0 3.19.58 4.38 1.72l3.28-3.28C17.7 1.19 15.1 0 12 0A12 12 0 0 0 1.76 7.11L5.6 10.1C6.5 7.39 9.02 4.75 12 4.75Z"
      />
    </svg>
  );
}
