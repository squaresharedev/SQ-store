import type { ReactNode } from "react";
import { ScopedIntlProvider } from "@/i18n/ScopedIntlProvider";

/** Login, reset password and two-factor ship only the sign-in copy. */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return <ScopedIntlProvider scope="auth">{children}</ScopedIntlProvider>;
}
