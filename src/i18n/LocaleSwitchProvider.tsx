"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useToast } from "@/components/ui/Toast";
import {
  EXIT_MS,
  LanguageSwitchOverlay,
  MIN_SHOW_MS,
} from "@/components/layout/LanguageSwitchOverlay";
import { setLocale } from "./actions";
import { LOCALE_NAMES, type Locale } from "./locales";

type Run = { to: Locale; startedAt: number; failed: boolean };

type LocaleSwitch = {
  /** Switch the UI language, behind the full-screen overlay. */
  switchLocale: (next: Locale) => void;
  /** True from the choice until the overlay has gone. */
  switching: boolean;
};

/**
 * If the new language has not arrived by now, something is stuck: let the
 * seller back into the page rather than hold them behind the overlay.
 */
const GIVE_UP_MS = 12_000;

const LocaleSwitchContext = createContext<LocaleSwitch | null>(null);

/**
 * The one place the UI language is switched from. Every picker (the account
 * menu, the Settings tab, the login page) calls `switchLocale`.
 *
 * Mounted in the ROOT layout so it outlives the switch itself: the refresh
 * that re-renders every Server Component in the new language keeps this
 * component (and the overlay) on screen, and the overlay leaves only once the
 * page behind it is actually in the new language. It also stays for
 * MIN_SHOW_MS, so a server that answers in a few milliseconds still gives a
 * calm moment rather than a flash.
 */
export function LocaleSwitchProvider({ children }: { children: ReactNode }) {
  const locale = useLocale() as Locale;
  const router = useRouter();
  const toast = useToast();
  const t = useTranslations("LocaleSwitcher");
  const [pending, startTransition] = useTransition();
  const [run, setRun] = useState<Run | null>(null);
  const [leaving, setLeaving] = useState(false);

  const switchLocale = useCallback(
    (next: Locale) => {
      if (next === locale || run) return;
      setRun({ to: next, startedAt: performance.now(), failed: false });
      startTransition(async () => {
        let ok = false;
        try {
          ok = (await setLocale(next)).ok;
        } catch {
          ok = false;
        }
        if (ok) router.refresh();
        else setRun((current) => current && { ...current, failed: true });
      });
    },
    [locale, run, router],
  );

  // Leave once the page behind is in the new language (or the switch failed),
  // but not before the minimum, so it never flashes.
  const settled = run !== null && !pending && (run.failed || locale === run.to);
  useEffect(() => {
    if (!run || leaving) return;
    const leaveAt = settled
      ? run.startedAt + (run.failed ? 0 : MIN_SHOW_MS)
      : run.startedAt + GIVE_UP_MS;
    const id = window.setTimeout(() => setLeaving(true), Math.max(0, leaveAt - performance.now()));
    return () => window.clearTimeout(id);
  }, [run, settled, leaving]);

  // Unmount after the exit animation; a failure is reported once the page is back.
  useEffect(() => {
    if (!run || !leaving) return;
    const id = window.setTimeout(() => {
      if (run.failed) toast.error(t("failed"));
      setRun(null);
      setLeaving(false);
    }, EXIT_MS);
    return () => window.clearTimeout(id);
  }, [run, leaving, toast, t]);

  // While it shows, the page behind is inert: no clicks, no Tab stops, hidden
  // from assistive tech. Focus goes back where it was once the overlay is gone.
  const active = run !== null;
  useEffect(() => {
    if (!active) return;
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const siblings = [...document.body.children].filter(
      (el): el is HTMLElement =>
        el instanceof HTMLElement && !el.hasAttribute("data-language-switch-overlay") && !el.inert,
    );
    siblings.forEach((el) => (el.inert = true));
    return () => {
      siblings.forEach((el) => (el.inert = false));
      if (focused?.isConnected) focused.focus({ preventScroll: true });
    };
  }, [active]);

  const value = useMemo(() => ({ switchLocale, switching: active }), [switchLocale, active]);

  return (
    <LocaleSwitchContext.Provider value={value}>
      {children}
      {run && (
        <LanguageSwitchOverlay
          leaving={leaving}
          announcement={t("switching", { language: LOCALE_NAMES[run.to] })}
        />
      )}
    </LocaleSwitchContext.Provider>
  );
}

export function useLocaleSwitch(): LocaleSwitch {
  const value = useContext(LocaleSwitchContext);
  if (!value) throw new Error("useLocaleSwitch must be used inside <LocaleSwitchProvider>");
  return value;
}
