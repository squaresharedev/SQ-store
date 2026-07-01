import type { Metadata } from "next";
import { LoginForm } from "@/components/auth/LoginForm";
import { MARKETPLACE_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your Square Share creator dashboard.",
};

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-black px-6 py-16">
      <div className="w-full max-w-md">
        {/* Wordmark */}
        <div className="mb-10">
          <p className="mb-3 font-mono text-xs uppercase tracking-[0.25em] text-white/30">
            Creator Dashboard
          </p>
          <h1 className="font-display text-4xl font-black leading-[0.95] tracking-tight text-white md:text-5xl">
            SQUARE
            <br />
            SHARE<span className="text-acid">.</span>
          </h1>
          <p className="mt-4 text-base text-white/50">
            Sign in to manage your products, storefront, and payouts.
          </p>
        </div>

        {/* Auth card */}
        <div className="border border-white/10 bg-white/[0.02] px-6 py-8 sm:px-8">
          <LoginForm />
        </div>

        {/* Access note — creators onboard via the marketplace waitlist. */}
        <p className="mt-8 text-center font-mono text-xs uppercase tracking-[0.2em] text-white/30">
          No account yet?{" "}
          <a
            href={MARKETPLACE_URL}
            className="text-white/50 underline decoration-white/20 underline-offset-4 transition-colors hover:text-acid hover:decoration-acid"
          >
            Request access
          </a>
        </p>
      </div>
    </main>
  );
}
