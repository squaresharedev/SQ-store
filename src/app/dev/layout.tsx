import type { ReactNode } from "react";
import { ScopedIntlProvider } from "@/i18n/ScopedIntlProvider";

/** Harness pages mount any component, so they get the whole catalogue. */
export default function DevLayout({ children }: { children: ReactNode }) {
  return <ScopedIntlProvider scope="full">{children}</ScopedIntlProvider>;
}
