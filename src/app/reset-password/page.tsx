import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";
import { BackgroundArrow } from "@/components/ui/BackgroundArrow";
import { SquareShareLogo } from "@/components/ui/square-share-logo";
import { getUser } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Set a new password",
};

/**
 * Landing page for password-recovery links. By the time the user reaches here,
 * /auth/callback has exchanged the recovery code for a session — so an absent
 * session means the link was invalid or expired. Same calm, centered chrome as
 * the sign-in page.
 */
export default async function ResetPasswordPage() {
  const user = await getUser();
  if (!user) redirect("/login?error=reset_expired");

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#f5f5f5] px-6 py-5">
      <div
        aria-hidden
        className="dot-grid pointer-events-none absolute inset-0"
      />
      <BackgroundArrow side="left" />
      <BackgroundArrow side="right" />

      <div className="relative z-10 w-full max-w-md">
        <div className="mb-3 flex items-center gap-3">
          <SquareShareLogo className="h-8 w-8 text-neutral-900" />
          <div className="flex flex-col leading-tight">
            <span className="font-display text-lg font-black tracking-tight text-neutral-900">
              Square Share
            </span>
            <span className="text-xs text-neutral-500">Creator dashboard</span>
          </div>
        </div>

        <div className="border border-neutral-200 bg-white px-6 pt-7 pb-6 shadow-[0_8px_40px_rgba(0,0,0,0.08)] sm:px-7 sm:pt-8">
          <h1 className="text-xl font-semibold tracking-tight text-neutral-900">
            Set a new password
          </h1>
          <p className="mt-1 mb-5 font-inter text-sm text-neutral-500">
            Pick something you&rsquo;ll remember. You&rsquo;re signed in on this
            device once it&rsquo;s set.
          </p>
          <ResetPasswordForm email={user.email ?? undefined} />
        </div>
      </div>
    </main>
  );
}
