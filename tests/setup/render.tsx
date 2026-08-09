import { render as rtlRender, type RenderOptions } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { ToastProvider } from "@/components/ui/Toast";

/**
 * Testing Library, plus the providers the real app always has around a
 * component. Component specs import `render` from HERE rather than from RTL
 * directly: anything that reports an outcome calls `useToast`, which throws
 * outside a provider by design, and a test that mounts a component in less
 * chrome than production gives it is testing a component that does not exist.
 *
 * Everything else RTL exports is re-exported unchanged, so this is a drop-in
 * swap for the import path.
 */
export * from "@testing-library/react";

function AppProviders({ children }: { children: ReactNode }) {
  return <ToastProvider>{children}</ToastProvider>;
}

export function render(
  ui: ReactElement,
  options?: Omit<RenderOptions, "wrapper">,
) {
  return rtlRender(ui, { wrapper: AppProviders, ...options });
}
