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
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ToastToneIcon } from "@/components/ui/toast-icons";
import {
  overlayCloseButtonClass,
  overlaySurfaceClass,
} from "@/components/ui/control-styles";

/**
 * Transient messages, for feedback that must be seen from wherever the user is
 * looking.
 *
 * THE RULE, so this stays predictable across the app:
 *
 *   - TOAST for the OUTCOME of something the user just did — saved, uploaded,
 *     invited, removed, and the failures of all of those. Success and error
 *     alike: a save whose only evidence is "the page looks the same" is
 *     indistinguishable from a no-op, and an outcome is over by definition.
 *   - INLINE for anything the user must act on or might need to re-read:
 *     WHICH field is wrong (the field says so, beside itself), and page-level
 *     states that need a decision. A toast leaves; those must not.
 *
 * The case that forced this: a long form's validation summary sits at the top,
 * so pressing Save at the bottom appeared to do nothing at all. Inline field
 * messages stay — they say which field — but something has to reach the eye at
 * the point of action, and that is this.
 */

export type ToastTone = "success" | "error" | "info";

export type ToastOptions = {
  /** Optional specifics — e.g. exactly which fields are wrong, and why. */
  lines?: string[];
  /**
   * Override the tone's default lifetime, in ms. `Infinity` pins the toast
   * open until it is dismissed — reserve that for a message that must not be
   * missed, since a toast nobody closes is a toast that crowds out the next.
   */
  duration?: number;
};

export type ToastInput = ToastOptions & {
  tone?: ToastTone;
  /** One line. The headline the user reads first. */
  title: string;
};

/**
 * One method per tone, because `toast.success("Saved.")` is the shape that
 * reads at a call site, plus `show` for the rare caller whose tone is a
 * variable. Each returns the new toast's id, for callers that want to dismiss
 * it themselves.
 */
export type ToastFn = {
  show: (input: ToastInput) => number;
  success: (title: string, options?: ToastOptions) => number;
  error: (title: string, options?: ToastOptions) => number;
  info: (title: string, options?: ToastOptions) => number;
  /** Dismiss one toast, or every toast when called with no id. */
  dismiss: (id?: number) => void;
};

type Toast = ToastOptions & {
  id: number;
  tone: ToastTone;
  title: string;
  /** Identity of the MESSAGE (not of the occurrence) — see `show`. */
  key: string;
  /** True while it plays its exit; the row stays mounted for that moment. */
  leaving?: boolean;
};

/** Errors get longer: they carry specifics worth reading before they go. */
const DISMISS_MS: Record<ToastTone, number> = {
  error: 8000,
  info: 5000,
  success: 4000,
};

/** How long the exit animation gets before the row is unmounted. */
const LEAVE_MS = 160;

/**
 * Three at a time. Past that the stack stops being a message and becomes a
 * wall: the oldest is dropped rather than queued, because by the time a queue
 * drained, the user would be reading answers to questions they had already
 * stopped asking.
 */
const MAX_VISIBLE = 3;

const ToastContext = createContext<ToastFn | null>(null);

/**
 * Show a toast. Safe to call from anywhere under the provider; outside one it
 * throws rather than silently swallowing the message, because a toast that
 * never appears is worse than a crash in development.
 */
export function useToast(): ToastFn {
  const toast = useContext(ToastContext);
  if (!toast) {
    throw new Error("useToast must be used inside <ToastProvider>");
  }
  return toast;
}

function messageKey(tone: ToastTone, title: string, lines?: string[]) {
  return `${tone} :: ${title} :: ${lines?.join(" :: ") ?? ""}`;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);
  // Removal timers for toasts currently playing their exit. Cleared on
  // unmount so a removal can't fire into a gone tree.
  const removals = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  // A backgrounded tab is not a tab anyone is reading. Without this, every
  // toast raised before the user switched away has already expired by the time
  // they switch back, and the answer to "did that save?" went with them.
  const [documentHidden, setDocumentHidden] = useState(false);
  useEffect(() => {
    const sync = () => setDocumentHidden(document.visibilityState === "hidden");
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);

  const close = useCallback((id: number) => {
    // Already on its way out: leave the in-flight removal timer alone rather
    // than stacking a second one on the same id.
    if (removals.current.has(id)) return;
    setToasts((current) =>
      current.map((toast) =>
        toast.id === id ? { ...toast, leaving: true } : toast,
      ),
    );
    removals.current.set(
      id,
      setTimeout(() => {
        removals.current.delete(id);
        setToasts((current) => current.filter((toast) => toast.id !== id));
      }, LEAVE_MS),
    );
  }, []);

  const show = useCallback((input: ToastInput): number => {
    const tone = input.tone ?? "info";
    const key = messageKey(tone, input.title, input.lines);
    // The id is minted OUT HERE, once per call: the updater below has to stay
    // pure, since React may run it more than once for a single dispatch.
    nextId.current += 1;
    const id = nextId.current;
    const toast: Toast = {
      id,
      key,
      tone,
      title: input.title,
      lines: input.lines,
      duration: input.duration ?? DISMISS_MS[tone],
    };

    setToasts((current) => {
      // Same message already on screen (a double-clicked Save, a retry that
      // failed the same way) refreshes THAT toast in place instead of stacking
      // a second identical copy. The new id remounts the row, restarting both
      // its lifetime and its entrance — so a repeat still reads as "that
      // happened again" rather than as a frozen leftover.
      const index = current.findIndex((existing) => existing.key === key);
      if (index !== -1) {
        const next = current.slice();
        next[index] = toast;
        return next;
      }
      // Newest sits closest to the anchor, so the oldest expires from the far
      // end of the stack and nothing below a fresh toast shifts out from under
      // the eye that is reading it.
      return [toast, ...current].slice(0, MAX_VISIBLE);
    });

    return id;
  }, []);

  useEffect(() => {
    const pending = removals.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  // What is on screen right now, for dismiss-all. Mirrored into a ref rather
  // than read through a setState updater: an updater that closes toasts is an
  // updater with side effects, and React is free to run those twice.
  const visible = useRef<number[]>([]);
  useEffect(() => {
    visible.current = toasts.map((toast) => toast.id);
  }, [toasts]);

  const dismiss = useCallback(
    (id?: number) => {
      if (typeof id === "number") {
        close(id);
        return;
      }
      // `close` guards on its own timer map, so anything already leaving is
      // left to finish its exit.
      for (const open of visible.current) close(open);
    },
    [close],
  );

  const toast = useMemo<ToastFn>(
    () => ({
      show,
      success: (title, options) => show({ ...options, tone: "success", title }),
      error: (title, options) => show({ ...options, tone: "error", title }),
      info: (title, options) => show({ ...options, tone: "info", title }),
      dismiss,
    }),
    [show, dismiss],
  );

  return (
    <ToastContext.Provider value={toast}>
      {children}
      {/* BOTTOM-right: the corner the eye returns to after pressing a button,
          and the one that stays clear of the left nav rail. Never blocks clicks
          on the page behind it — only the toasts themselves take pointer
          events, so the Save button underneath one stays pressable.

          Lifted to bottom-20 on phones: the storefront editor floats its
          toolbar at bottom-4, and the very bottom edge of a phone is the
          home-indicator strip either way. From `sm` up there is nothing down
          there to clear, so it settles onto bottom-6.

          z-[70] puts it above modals (z-50) and the search overlay (z-[60]).
          The invite and password modals both raise toasts, and a confirmation
          that renders behind the thing that triggered it is not one. */}
      <ol
        // A region, not a live region: each toast below carries its own role,
        // so an error interrupts and a success waits its turn. Nesting a live
        // region inside another gets the message announced twice.
        role="region"
        aria-label="Notifications"
        onKeyDown={(event) => {
          // Only reachable with focus already inside the stack, so this can
          // never steal Escape from a modal or a popover.
          if (event.key === "Escape") {
            event.stopPropagation();
            toast.dismiss();
          }
        }}
        // flex-col-REVERSE with the newest-first list: the newest toast lands
        // nearest the bottom edge, and the oldest expires off the TOP of the
        // stack — so nothing ever shifts out from under the one being read.
        // sm:w-96 is not cosmetic: without a width on the column, each card
        // sizes to its own text and a stack of three lands as three different
        // widths, which reads as three unrelated things rather than one
        // channel. Full-bleed (inset-x-4) does the same job on a phone.
        className="pointer-events-none fixed inset-x-4 bottom-20 z-[70] flex list-none flex-col-reverse items-end gap-2 sm:inset-x-auto sm:bottom-6 sm:right-6 sm:w-96"
      >
        {toasts.map((item) => (
          <ToastCard
            key={item.id}
            toast={item}
            close={close}
            paused={documentHidden}
          />
        ))}
      </ol>
    </ToastContext.Provider>
  );
}

/**
 * What a tone changes: the MARK, and the hairline clock under it. Nothing else.
 *
 * The border is deliberately absent from this map — every toast wears the same
 * neutral `border-border` as every other overlay in the app. A red-bordered
 * card is a second, louder signal for something the mark has already said, and
 * three toasts in three border colours stop reading as one channel.
 *
 * Dark mode: `destructive` and `foreground` are already re-stepped for dark
 * surfaces by the token layer, but `--color-success` is a green-700 tuned for
 * white — on a near-black card it sinks into the surface, so success is the one
 * tone that names its dark companion explicitly.
 */
const TONE: Record<ToastTone, { accent: string; bar: string }> = {
  error: {
    accent: "text-destructive",
    bar: "bg-destructive/50",
  },
  info: {
    // The neutral tone is the FOREGROUND, not the muted grey: muted-on-card is
    // the colour of the detail lines, and the mark must outrank those.
    accent: "text-foreground",
    bar: "bg-muted-foreground/40",
  },
  success: {
    accent: "text-success dark:text-success-dark",
    bar: "bg-success/50 dark:bg-success-dark/50",
  },
};

/** The mark's colour for a tone, exported so the dev gallery renders the real
 *  thing rather than its own guess at it. */
export const toneAccentClass = (tone: ToastTone) => TONE[tone].accent;

function ToastCard({
  toast,
  close,
  paused: pausedByTab,
}: {
  toast: Toast;
  close: (id: number) => void;
  /** Tab-level pause, shared by every toast on screen. */
  paused: boolean;
}) {
  const isError = toast.tone === "error";
  const tone = TONE[toast.tone];

  // Pointer or keyboard ON the toast means someone is reading it. Both pause
  // the clock: a message still being parsed must not expire mid-sentence, and
  // a close button that walks away from the cursor is a joke.
  const [engaged, setEngaged] = useState(false);
  const paused = engaged || pausedByTab;

  const onClose = useCallback(() => close(toast.id), [close, toast.id]);

  const lifetime = toast.duration ?? DISMISS_MS[toast.tone];
  const timed = Number.isFinite(lifetime);
  const hasLines = Boolean(toast.lines && toast.lines.length > 0);

  // Time LEFT, not time elapsed: each pause banks the remainder, so a toast
  // hovered three times still gets its full reading time and no more. Only
  // the effect touches this — the drawn bar below runs off `lifetime` and the
  // same pause flag, which keeps the two in step without reading it.
  const remaining = useRef(lifetime);
  const startedAt = useRef(0);

  useEffect(() => {
    if (toast.leaving || paused || !timed) return;
    startedAt.current = Date.now();
    const timer = setTimeout(onClose, Math.max(0, remaining.current));
    return () => {
      clearTimeout(timer);
      remaining.current -= Date.now() - startedAt.current;
    };
  }, [paused, timed, toast.leaving, onClose]);

  return (
    <li
      // assertive for errors: the user just tried to do something and it did
      // not happen, so it should cut in rather than queue politely.
      role={isError ? "alert" : "status"}
      aria-live={isError ? "assertive" : "polite"}
      aria-atomic="true"
      data-tone={toast.tone}
      data-state={toast.leaving ? "leaving" : "open"}
      onMouseEnter={() => setEngaged(true)}
      onMouseLeave={() => setEngaged(false)}
      // Capturing phase: focus/blur do not bubble, and the focusable thing
      // inside is the close button, not this row.
      onFocusCapture={() => setEngaged(true)}
      onBlurCapture={() => setEngaged(false)}
      className={cn(
        overlaySurfaceClass,
        // Uneven on purpose: the mark needs room to the left of it to read as
        // placed rather than crammed against the edge, while the right side is
        // tighter because the dismiss button carries its own padding.
        "pointer-events-auto relative w-full overflow-hidden py-3 pl-4 pr-2",
        toast.leaving ? "toast-leave" : "toast-enter",
      )}
    >
      {/* A one-line toast centres everything on one axis — mark, words and
          dismiss. Detail lines make the card tall, and then only the dismiss
          stays centred (below) while the mark rides up beside the headline it
          belongs to. */}
      <div className={cn("flex gap-3", hasLines ? "items-start" : "items-center")}>
        {/* The marks are taller than the line of text beside them, so they hang
            in a box the height of that line (h-5) and overflow it evenly. That
            centres every tone on the headline's optical axis without a per-tone
            nudge — and keeps doing so when a tone's size changes.

            Keyed on the id so a repeat of the same message remounts the mark
            and replays its draw: that stamp is what makes "it happened again"
            legible when the words have not changed. */}
        <span className="flex h-5 shrink-0 items-center">
          <ToastToneIcon key={toast.id} tone={toast.tone} className={tone.accent} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-inter text-sm font-medium break-words text-foreground">
            {toast.title}
          </p>
          {hasLines && (
            <ul className="mt-1 space-y-0.5">
              {toast.lines?.map((line) => (
                <li
                  key={line}
                  className="font-inter text-sm break-words text-muted-foreground"
                >
                  {line}
                </li>
              ))}
            </ul>
          )}
        </div>
        {/* self-center, not the row's default start: the row is the card's
            content box, so its centre IS the card's vertical centre, and the
            dismiss stays on that axis whether the toast is one line or five.

            The thumb target is grown with a pseudo-element rather than by
            sizing the button to 44px. A 44px control is taller than the line
            of text beside it, so it inflates every single-line toast into a
            box with a band of dead space under the words — this keeps the
            card the height of its content and the target the size of a
            thumb. */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Dismiss"
          className={cn(
            overlayCloseButtonClass,
            "relative size-9 self-center",
            "after:absolute after:-inset-2 after:content-[''] sm:after:hidden",
          )}
        >
          <X className="size-4" strokeWidth={2} aria-hidden="true" />
        </button>
      </div>

      {/* The clock, drawn. It is what makes "hover to keep it" discoverable —
          the bar visibly stops. Decorative: the text above is the message. */}
      {timed && !toast.leaving && (
        <span
          aria-hidden="true"
          data-testid="toast-timer"
          className={cn("toast-timer absolute inset-x-0 bottom-0 h-0.5", tone.bar)}
          style={{
            animationDuration: `${lifetime}ms`,
            animationPlayState: paused ? "paused" : "running",
          }}
        />
      )}
    </li>
  );
}

/** The result shape the server actions in this app settle into. */
export type ActionResultState = {
  error?: string;
  success?: string;
};

/**
 * Bridge from a `useActionState` result to a toast: one line in a form
 * component, replacing the inline status paragraph it used to render.
 *
 * WHY IT WATCHES IDENTITY rather than the message text: a resend that fails the
 * same way twice returns the same STRING both times, so comparing text would
 * announce the first failure and silently swallow every one after it. Each
 * dispatch settles into a fresh object, so the object IS the occurrence.
 *
 * Whatever state is present at mount is never announced — that is a page load,
 * not something the user just did.
 */
export function useActionToast(state: ActionResultState | undefined) {
  const toast = useToast();
  const announced = useRef(state);

  useEffect(() => {
    if (state === announced.current) return;
    announced.current = state;
    if (!state) return;
    if (state.error) {
      toast.error(state.error);
      return;
    }
    if (state.success) toast.success(state.success);
  }, [state, toast]);
}
