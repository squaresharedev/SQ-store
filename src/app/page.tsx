import { redirect } from "next/navigation";
import { OVERVIEW_PATH } from "@/lib/dashboard/paths";

// "/" ONLY FORWARDS, to the Overview.
//
// It lives OUTSIDE the (dashboard) group on purpose: inside it, the group's
// layout booted DashboardShell (a dozen database reads) before this redirect
// threw, on every visit to the bare root. Up here only the root layout runs.
// The Overview itself is still protected by (dashboard)/layout.tsx.
//
// NOT a next.config redirects() rule, though that looks cheaper. A server
// action that ends in redirect("/") (safeInternalPath falls back to "/" after
// sign-in, password reset and the like) has Next fetch "/" internally to
// render it, that fetch follows a config redirect without telling the
// browser, and the browser is left on "/" showing the Overview: the sidebar
// and every "is this /dashboard?" check then read the wrong path. A redirect
// thrown from a page travels in the response, so the address bar follows it.
export default function RootPage() {
  redirect(OVERVIEW_PATH);
}
