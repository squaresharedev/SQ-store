import type { ReactNode } from "react";
import { ScopedIntlProvider } from "@/i18n/ScopedIntlProvider";

/** The consent page ships the settings and sign-in copy it draws on. */
export default function OAuthLayout({ children }: { children: ReactNode }) {
  return <ScopedIntlProvider scope="app">{children}</ScopedIntlProvider>;
}
