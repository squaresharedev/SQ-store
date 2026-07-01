import { signOut } from "@/lib/auth/actions";
import { getProfile, requireUser } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";

/**
 * Dashboard home — PROTECTED. Unauthenticated users are redirected to /login.
 *
 * ⚠️ NEXT AGENT: this is where the real dashboard goes (products, storefront
 * designer, Stripe, analytics — later phases). Auth + route protection are done.
 */
export default async function Home() {
  const user = await requireUser("/");
  const profile = await getProfile();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[#F9F9F9] px-6 text-center">
      <p className="mb-4 font-inter text-xs uppercase tracking-[0.25em] text-neutral-400">
        store.squareshare.to
      </p>
      <h1 className="font-display text-5xl font-black leading-[0.95] tracking-tight text-neutral-900 md:text-7xl">
        Creator Dashboard<span className="text-acid">.</span>
      </h1>

      <p className="mt-5 text-base text-neutral-600">
        Signed in as <span className="text-neutral-900">{user.email}</span>
      </p>
      <p className="mt-1 font-inter text-xs uppercase tracking-[0.2em] text-neutral-400">
        {profile?.is_seller ? "Seller account" : "Buyer account"}
        {" · profile "}
        {profile ? "loaded ✓" : "missing"}
      </p>

      <form action={signOut} className="mt-10">
        <Button type="submit" variant="secondary" className="px-8 py-4 text-base">
          Sign out
        </Button>
      </form>
    </main>
  );
}
