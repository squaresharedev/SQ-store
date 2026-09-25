import type { ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import { ExtendMessages } from "./ExtendMessages";
import { loadMessages } from "./messages";
import { pickScope, pickShell, type ClientScope } from "./scopes";
import type { Locale } from "./locales";

/**
 * The client-side message provider, carrying only what the browser needs
 * (see ./scopes.ts). The root layout mounts the "shell" scope; every route
 * group below it adds its own namespaces to that instead of repeating it.
 */
export async function ScopedIntlProvider({ scope, children }: { scope: ClientScope; children: ReactNode }) {
  const locale = (await getLocale()) as Locale;
  const messages = await loadMessages(locale);

  if (scope === "shell") {
    return (
      <NextIntlClientProvider locale={locale} messages={pickShell(messages)}>
        {children}
      </NextIntlClientProvider>
    );
  }
  return <ExtendMessages messages={pickScope(messages, scope)}>{children}</ExtendMessages>;
}
