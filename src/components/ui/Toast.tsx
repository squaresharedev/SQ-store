"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AlertCircle, CheckCircle2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { focusRingClass, transitionClass } from "@/components/ui/control-styles";

/**
 * Transient messages, for feedback that must be seen from wherever the user is
 * looking.
 *
 * The case that forced this: a long form's validation summary sits at the top,
 * so pressing Save at the bottom appeared to do nothing at all. Inline field
 * messages stay — they say WHICH field — but something has to reach the eye at
 * the point of action, and that is this.
 *
 * NOT for anything the user must act on or might need again: a toast leaves.
 * Errors that need a decision belong in the page (ActionErrorNotice).
 */

export type ToastTone = "error" | "success";

export type ToastInput = {
  tone?: ToastTone;
  /** One line. The headline the user reads first. */
  title: string;
  /** Optional specifics — e.g. exactly which fields are wrong, and why. */
  lines?: string[];
};

type Toast = ToastInput & { id: number; tone: ToastTone };

/** Errors get longer: they carry specifics worth reading before they go. */
const DISMISS_MS: Record<ToastTone, number> = {
  error: 8000,
  success: 4000,
};

const ToastContext = createContext<((toast: ToastInput) => void) | null>(null);

/**
 * Show a toast. Safe to call from anywhere under the provider; outside one it
 * throws rather than silently swallowing the message, because a toast that
 * never appears is worse than a crash in development.
 */
export function useToast() {
  const show = useContext(ToastContext);
  if (!show) {
    throw new Error("useToast must be used inside <ToastProvider>");
  }
  return show;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);
  // Timers are cleared on unmount so a dismissal can't fire into a gone tree.
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback(
    (input: ToastInput) => {
      nextId.current += 1;
      const id = nextId.current;
      const tone = input.tone ?? "error";
      setToasts((current) => [...current, { ...input, id, tone }]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), DISMISS_MS[tone]),
      );
    },
    [dismiss],
  );

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  const value = useMemo(() => show, [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* TOP-right, clear of the header. Deliberately not bottom-right: form
          actions live there, so a toast about a failed save would cover the
          Save button the user needs to press again. Never blocks clicks on
          the page behind it — only the toasts take pointer events. */}
      <div
        className="pointer-events-none fixed inset-x-4 top-16 z-50 flex flex-col items-end gap-2 sm:inset-x-auto sm:right-6"
        // The region is a live one; each toast below carries its own role so
        // an error interrupts and a success waits its turn.
        aria-live="polite"
        aria-atomic="false"
      >
        {toasts.map((toast) => (
          <ToastCard key={toast.id} toast={toast} onDismiss={() => dismiss(toast.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const isError = toast.tone === "error";
  const Icon = isError ? AlertCircle : CheckCircle2;

  return (
    <div
      // assertive for errors: the user just tried to do something and it did
      // not happen, so it should cut in rather than queue politely.
      role={isError ? "alert" : "status"}
      aria-live={isError ? "assertive" : "polite"}
      className={cn(
        "pointer-events-auto w-full max-w-sm rounded-sm border bg-card p-3 shadow-lg",
        "animate-in fade-in slide-in-from-top-2 duration-base ease-entrance motion-reduce:animate-none",
        isError ? "border-destructive/40" : "border-success/40",
      )}
    >
      <div className="flex items-start gap-2.5">
        <Icon
          className={cn("mt-0.5 size-4 shrink-0", isError ? "text-destructive" : "text-success")}
          strokeWidth={2}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <p className="font-inter text-sm font-medium text-foreground">{toast.title}</p>
          {toast.lines && toast.lines.length > 0 && (
            <ul className="mt-1 space-y-0.5">
              {toast.lines.map((line) => (
                <li key={line} className="font-inter text-sm text-muted-foreground">
                  {line}
                </li>
              ))}
            </ul>
          )}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className={cn(
            "-m-1 shrink-0 rounded-sm p-1 text-muted-foreground hover:text-foreground",
            transitionClass,
            focusRingClass,
          )}
        >
          <X className="size-4" strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
