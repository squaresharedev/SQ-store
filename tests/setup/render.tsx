import { render as rtlRender, type RenderOptions } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { ToastProvider } from "@/components/ui/Toast";
import messages from "../../messages/en";

/**
 * Testing Library, plus the providers the real app always has around a
 * component. Component specs import `render` from HERE rather than from RTL
 * directly: anything that reports an outcome calls `useToast`, and anything
 * with copy calls `useTranslations`, and both throw outside their provider by
 * design. A test that mounts a component in less chrome than production gives
 * it is testing a component that does not exist.
 *
 * Specs render in English, from the real English catalogue, so an assertion on
 * visible copy checks the text a user actually sees rather than a message key.
 *
 * Everything else RTL exports is re-exported unchanged, so this is a drop-in
 * swap for the import path.
 */
export * from "@testing-library/react";

/**
 * The App Router's router, inert. next/navigation's useRouter throws outside
 * it, and AppLink (every in-app link) reads it to fetch a page ahead. A spec
 * that asserts on navigation mocks next/navigation itself, which wins over this.
 */
const NO_ROUTER = {
  back: () => undefined,
  forward: () => undefined,
  refresh: () => undefined,
  push: () => undefined,
  replace: () => undefined,
  prefetch: () => undefined,
  hmrRefresh: () => undefined,
  bfcacheId: "test",
};

function IntlProvider({ children }: { children: ReactNode }) {
  return (
    <AppRouterContext.Provider value={NO_ROUTER}>
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        {children}
      </NextIntlClientProvider>
    </AppRouterContext.Provider>
  );
}

function AppProviders({ children }: { children: ReactNode }) {
  return (
    <IntlProvider>
      <ToastProvider>{children}</ToastProvider>
    </IntlProvider>
  );
}

export function render(
  ui: ReactElement,
  options?: Omit<RenderOptions, "wrapper">,
) {
  return rtlRender(ui, { wrapper: AppProviders, ...options });
}

/**
 * Translations only, no toast stack. For the two kinds of spec the stack gets
 * in the way of: one asserting a component renders NOTHING (the stack's live
 * region sits in the same container), and the toast specs themselves, which
 * mount their own provider or deliberately have none.
 */
export function renderWithoutToasts(
  ui: ReactElement,
  options?: Omit<RenderOptions, "wrapper">,
) {
  return rtlRender(ui, { wrapper: IntlProvider, ...options });
}
