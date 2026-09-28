import { vi } from "vitest";

/**
 * Install a clipboard stub and hand back its writeText spy.
 *
 * MUST be called after `userEvent.setup()`: user-event installs a clipboard
 * stub of its own, so stubbing first would just be overwritten and every test
 * would silently exercise user-event's always-succeeds clipboard.
 */
export function stubClipboard(impl: () => Promise<void> = () => Promise.resolve()) {
  const writeText = vi.fn(impl);
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
    writable: true,
  });
  return writeText;
}
