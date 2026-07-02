import { requireUser } from "@/lib/auth/session";

// PROTECTED — unauthenticated users are redirected to /login.
export default async function DashboardHomePage() {
  await requireUser("/");

  return (
    <main className="p-6">
      <p className="text-foreground">Coming soon</p>
    </main>
  );
}
