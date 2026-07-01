import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * Root route placeholder.
 *
 * ⚠️ NEXT AGENT: this becomes the authenticated dashboard home. Once auth is
 * wired, protect this route (read the session via @/lib/supabase/server and
 * redirect unauthenticated users to /login), then render the real dashboard
 * (products, storefront designer, Stripe, analytics — later phases).
 */
export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-black px-6 text-center">
      <p className="mb-4 font-mono text-xs uppercase tracking-[0.25em] text-white/30">
        store.squareshare.to
      </p>
      <h1 className="font-display text-5xl font-black leading-[0.95] tracking-tight text-white md:text-7xl">
        Creator Dashboard<span className="text-acid">.</span>
      </h1>
      <p className="mt-5 max-w-md text-base text-white/50">
        Scaffold ready. Auth screen is live at{" "}
        <span className="font-mono text-white/70">/login</span>. The dashboard
        itself lands next.
      </p>
      <Link href="/login" className="mt-10">
        <Button className="px-8 py-4 text-base">Go to sign in</Button>
      </Link>
    </main>
  );
}
