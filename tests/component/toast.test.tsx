import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, cleanup, fireEvent } from "@testing-library/react";
import { useEffect, useState } from "react";
import {
  ToastProvider,
  useActionToast,
  useToast,
  type ActionResultState,
} from "@/components/ui/Toast";

afterEach(cleanup);

/**
 * The toast system is the app's confirmation channel: every save, upload,
 * invite and delete reports through it. What is pinned here is the behaviour
 * that decides whether a user actually READS the answer — how long it stays,
 * what stops the clock, and what happens when the same thing is said twice.
 *
 * fireEvent, not userEvent, throughout: these are timing tests, so the clock
 * is fully faked, and userEvent's own internal delay never resolves against a
 * faked setTimeout (see date-picker.test.tsx, which hit the same wall).
 */

// Tone lifetimes, mirrored from the component. An error carries specifics
// worth reading, so it gets twice a success's time.
const SUCCESS_MS = 4000;
const ERROR_MS = 8000;
const INFO_MS = 5000;
/** Exit animation, after which the row leaves the DOM. */
const LEAVE_MS = 160;

function elapse(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

/** Push the clock past a remaining lifetime AND the exit that follows it. */
function gone(ms: number) {
  elapse(ms + LEAVE_MS + 10);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function Raise({
  onFire,
}: {
  onFire: (toast: ReturnType<typeof useToast>) => void;
}) {
  const toast = useToast();
  return (
    <button type="button" onClick={() => onFire(toast)}>
      raise
    </button>
  );
}

function renderToaster(onFire: (toast: ReturnType<typeof useToast>) => void) {
  return render(
    <ToastProvider>
      <Raise onFire={onFire} />
    </ToastProvider>,
  );
}

/** Fire whatever the harness was given. */
function raise() {
  fireEvent.click(screen.getByRole("button", { name: "raise" }));
}

// ---------------------------------------------------------------------------
// What a toast says, and how it says it
// ---------------------------------------------------------------------------

describe("Toast: the message", () => {
  it("shows a success as a polite status, not an interruption", () => {
    renderToaster((toast) => toast.success("Profile photo updated."));
    raise();

    const toast = screen.getByRole("status");
    expect(toast).toHaveTextContent("Profile photo updated.");
    expect(toast).toHaveAttribute("aria-live", "polite");
  });

  it("cuts in with an alert when something failed", () => {
    renderToaster((toast) => toast.error("Could not save."));
    raise();

    // assertive, because the user just tried to do something and it did not
    // happen — that must not queue behind a pending polite announcement.
    const toast = screen.getByRole("alert");
    expect(toast).toHaveTextContent("Could not save.");
    expect(toast).toHaveAttribute("aria-live", "assertive");
  });

  it("carries the specifics under the headline", () => {
    renderToaster((toast) =>
      toast.error("This product can't be saved yet", {
        lines: ["Add a title.", "Price must be a number."],
      }),
    );
    raise();

    const toast = screen.getByRole("alert");
    expect(toast).toHaveTextContent("Add a title.");
    expect(toast).toHaveTextContent("Price must be a number.");
  });

  it("names the stack for anyone navigating by landmark", () => {
    renderToaster(() => {});
    expect(
      screen.getByRole("region", { name: /notifications/i }),
    ).toBeInTheDocument();
  });

  it("sets a one-line toast on a single axis, mark to dismiss", () => {
    renderToaster((toast) => toast.success("Profile photo updated."));
    raise();

    // items-center, not items-start: with nothing under the headline there is
    // no second line for the mark to align to, and a dismiss button pinned to
    // the top of a 20px row sits visibly above the words it closes.
    const row = screen.getByRole("status").firstElementChild;
    expect(row).toHaveClass("items-center");
    expect(row).not.toHaveClass("items-start");
  });

  it("lets the mark ride up beside the headline when there are details", () => {
    renderToaster((toast) =>
      toast.error("Blocked", { lines: ["Add a title.", "Set a price."] }),
    );
    raise();

    // The mark belongs to the headline, not to the block of detail lines, so a
    // tall card aligns it to the top rather than floating it in the middle.
    const row = screen.getByRole("alert").firstElementChild;
    expect(row).toHaveClass("items-start");
  });

  it("keeps the dismiss on the card's axis however tall it gets", () => {
    renderToaster((toast) =>
      toast.error("Blocked", { lines: ["One.", "Two.", "Three.", "Four."] }),
    );
    raise();

    // self-center overrides the row's alignment for this one child: five lines
    // of detail must not strand the X in the top corner.
    expect(screen.getByRole("button", { name: "Dismiss" })).toHaveClass(
      "self-center",
    );
  });

  it("never lets a tone colour the card's border", () => {
    renderToaster((toast) => toast.error("Could not save."));
    raise();

    // Tone is carried by the mark alone. A red-bordered card says the same
    // thing louder, and three tones in three border colours stop reading as
    // one channel.
    expect(screen.getByRole("alert").className).not.toMatch(
      /border-(destructive|success)/,
    );
  });

  it("never blocks the page it floats over", () => {
    renderToaster(() => {});
    // The container spans a strip of the viewport at all times. If it took
    // pointer events it would eat clicks on whatever sits beneath it, toast or
    // no toast — only the toasts themselves are clickable.
    expect(screen.getByRole("region", { name: /notifications/i })).toHaveClass(
      "pointer-events-none",
    );
  });
});

describe("Toast: a message with somewhere to go", () => {
  it("stays a plain status when no onClick is given", () => {
    renderToaster((toast) => toast.success("Profile photo updated."));
    raise();

    expect(screen.queryByRole("button", { name: /profile photo updated/i })).toBeNull();
  });

  it("turns the message into a control when onClick is given", () => {
    const onClick = vi.fn();
    renderToaster((toast) =>
      toast.error("This product can't be saved yet", { onClick }),
    );
    raise();

    const control = screen.getByRole("button", {
      name: /this product can't be saved yet/i,
    });
    fireEvent.click(control);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("runs onClick on Enter and Space too, not just a pointer click", () => {
    const onClick = vi.fn();
    renderToaster((toast) => toast.error("Blocked", { onClick }));
    raise();

    const control = screen.getByRole("button", { name: /blocked/i });
    fireEvent.keyDown(control, { key: "Enter" });
    fireEvent.keyDown(control, { key: " " });
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it("dismisses itself once its onClick has run", () => {
    const onClick = vi.fn();
    renderToaster((toast) => toast.error("Blocked", { onClick }));
    raise();

    fireEvent.click(screen.getByRole("button", { name: /blocked/i }));
    // The click did what the toast was for — nothing is left for it to say,
    // once its exit animation (the same one Dismiss plays) finishes.
    elapse(LEAVE_MS + 10);
    expect(screen.queryByText("Blocked")).toBeNull();
  });

  it("leaves the dismiss button as its own target, not swallowed by onClick", () => {
    const onClick = vi.fn();
    renderToaster((toast) => toast.error("Blocked", { onClick }));
    raise();

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onClick).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Lifetime
// ---------------------------------------------------------------------------

describe("Toast: how long it stays", () => {
  it("clears a success after its own reading time", () => {
    renderToaster((toast) => toast.success("Saved."));
    raise();

    elapse(SUCCESS_MS - 100);
    expect(screen.getByRole("status")).toBeInTheDocument();

    gone(100);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("gives an error longer, because an error has more to read", () => {
    renderToaster((toast) => toast.error("Could not save."));
    raise();

    // Still there well past when a success would have gone.
    elapse(SUCCESS_MS + 500);
    expect(screen.getByRole("alert")).toBeInTheDocument();

    gone(ERROR_MS - SUCCESS_MS - 500);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("holds an explicitly pinned toast open indefinitely", () => {
    renderToaster((toast) =>
      toast.info("Import running.", { duration: Number.POSITIVE_INFINITY }),
    );
    raise();

    elapse(INFO_MS * 20);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("stops the clock while the pointer is on it", () => {
    renderToaster((toast) => toast.success("Saved."));
    raise();

    elapse(1000);
    fireEvent.mouseEnter(screen.getByRole("status"));

    // Long enough that an unpaused toast would have gone several times over.
    elapse(SUCCESS_MS * 3);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("resumes with the time it had banked, not a fresh full lifetime", () => {
    renderToaster((toast) => toast.success("Saved."));
    raise();

    elapse(3000); // 1000 left
    fireEvent.mouseEnter(screen.getByRole("status"));
    elapse(10_000); // read at leisure
    fireEvent.mouseLeave(screen.getByRole("status"));

    elapse(900);
    expect(screen.getByRole("status")).toBeInTheDocument();

    gone(100);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("stops the clock while the keyboard is on it", () => {
    renderToaster((toast) => toast.success("Saved."));
    raise();

    // Focus lands on the dismiss button INSIDE the toast, so this only works
    // because the row listens on the capture phase.
    act(() => {
      screen.getByRole("button", { name: "Dismiss" }).focus();
    });
    elapse(SUCCESS_MS * 3);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("stops the clock while the tab is in the background", () => {
    renderToaster((toast) => toast.success("Saved."));
    raise();

    const visibility = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("hidden");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // Someone who tabbed away to check an email should not come back to a
    // question whose answer has already expired unseen.
    elapse(SUCCESS_MS * 3);
    expect(screen.getByRole("status")).toBeInTheDocument();

    visibility.mockReturnValue("visible");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    gone(SUCCESS_MS);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    visibility.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Dismissing
// ---------------------------------------------------------------------------

describe("Toast: getting rid of it", () => {
  it("closes on the dismiss button", () => {
    renderToaster((toast) => toast.error("Could not save."));
    raise();

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    elapse(LEAVE_MS + 10);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("plays an exit before it leaves, rather than blinking out", () => {
    renderToaster((toast) => toast.error("Could not save."));
    raise();

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    // Still mounted for the length of the animation, and marked as leaving.
    expect(screen.getByRole("alert")).toHaveAttribute("data-state", "leaving");
  });

  it("survives the dismiss button being hammered", () => {
    renderToaster((toast) => toast.error("Could not save."));
    raise();

    const dismiss = screen.getByRole("button", { name: "Dismiss" });
    fireEvent.click(dismiss);
    fireEvent.click(dismiss);
    fireEvent.click(dismiss);

    elapse(LEAVE_MS + 10);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("clears the whole stack on Escape from inside it", () => {
    renderToaster((toast) => {
      toast.error("First.");
      toast.error("Second.");
    });
    raise();
    expect(screen.getAllByRole("alert")).toHaveLength(2);

    fireEvent.keyDown(screen.getAllByRole("alert")[0], { key: "Escape" });

    elapse(LEAVE_MS + 10);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// The stack
// ---------------------------------------------------------------------------

describe("Toast: more than one at a time", () => {
  it("puts the newest closest to the anchor", () => {
    renderToaster((toast) => {
      toast.info("First.");
      toast.info("Second.");
    });
    raise();

    const rows = screen.getAllByRole("status");
    expect(rows[0]).toHaveTextContent("Second.");
    expect(rows[1]).toHaveTextContent("First.");
  });

  it("refuses to become a wall, dropping the oldest past three", () => {
    renderToaster((toast) => {
      toast.info("One.");
      toast.info("Two.");
      toast.info("Three.");
      toast.info("Four.");
    });
    raise();

    expect(screen.getAllByRole("status")).toHaveLength(3);
    expect(screen.queryByText("One.")).not.toBeInTheDocument();
    expect(screen.getByText("Four.")).toBeInTheDocument();
  });

  it("says the same thing once, however many times it happens", () => {
    renderToaster((toast) => toast.error("Could not save."));

    raise();
    raise();
    raise();

    // A double-clicked Save that fails the same way twice is ONE piece of
    // news. Three stacked copies of it is a bug report about the toast system.
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

  it("restarts the clock when a repeat lands, so it is not half-expired", () => {
    renderToaster((toast) => toast.success("Saved."));

    raise();
    elapse(SUCCESS_MS - 200);
    raise();

    // Had the repeat merely been swallowed, the toast would go here.
    elapse(300);
    expect(screen.getByRole("status")).toBeInTheDocument();

    gone(SUCCESS_MS);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("treats the same words in a different tone as different news", () => {
    renderToaster((toast) => {
      toast.success("Done.");
      toast.error("Done.");
    });
    raise();

    expect(screen.getByRole("status")).toHaveTextContent("Done.");
    expect(screen.getByRole("alert")).toHaveTextContent("Done.");
  });

  it("keeps two toasts that differ only in their detail lines", () => {
    renderToaster((toast) => {
      toast.error("Upload failed.", { lines: ["logo.png"] });
      toast.error("Upload failed.", { lines: ["cover.png"] });
    });
    raise();

    expect(screen.getAllByRole("alert")).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------

describe("Toast: unmounting", () => {
  it("throws rather than swallowing a message raised with no provider", () => {
    // A toast that silently never appears is a confirmation the user waits
    // for forever. Failing loudly in development is the cheaper bug.
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Raise onFire={() => {}} />)).toThrow(/ToastProvider/);
    quiet.mockRestore();
  });

  it("drops its pending timers when the tree goes", () => {
    const { unmount } = renderToaster((toast) => toast.success("Saved."));
    raise();

    unmount();
    // A removal timer firing into a gone tree is a React warning at best and
    // a crash at worst; nothing should be left to fire.
    expect(() => elapse(SUCCESS_MS * 2)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// useActionToast: the bridge from a server action's result
// ---------------------------------------------------------------------------

function ActionHarness({ results }: { results: ActionResultState[] }) {
  const [index, setIndex] = useState(-1);
  const state = index >= 0 ? results[index] : undefined;
  useActionToast(state);
  return (
    <button type="button" onClick={() => setIndex((i) => i + 1)}>
      submit
    </button>
  );
}

function renderAction(results: ActionResultState[]) {
  return render(
    <ToastProvider>
      <ActionHarness results={results} />
    </ToastProvider>,
  );
}

function submit() {
  fireEvent.click(screen.getByRole("button", { name: "submit" }));
}

describe("useActionToast", () => {
  it("says nothing on mount", () => {
    renderAction([]);
    // A result already present at first render is a page load, not something
    // the user just did.
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("announces a settled success", () => {
    renderAction([{ success: "Username saved." }]);
    submit();

    expect(screen.getByRole("status")).toHaveTextContent("Username saved.");
  });

  it("announces a settled failure as an error", () => {
    renderAction([{ error: "That username is taken." }]);
    submit();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "That username is taken.",
    );
  });

  it("says nothing for a result that carries neither", () => {
    renderAction([{}]);
    submit();

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("reports the second failure too, even worded identically", () => {
    renderAction([
      { error: "Could not save. Give it another try." },
      { error: "Could not save. Give it another try." },
    ]);

    submit();
    elapse(ERROR_MS - 500);
    submit();

    // Watching the message TEXT would have swallowed this: the retry failed
    // the same way, so the string never changed. The occurrence is the object.
    elapse(1000);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("prefers the error when a result somehow carries both", () => {
    renderAction([{ error: "Rate limited.", success: "Saved." }]);
    submit();

    expect(screen.getByRole("alert")).toHaveTextContent("Rate limited.");
    expect(screen.queryByText("Saved.")).not.toBeInTheDocument();
  });

  it("keeps the message when the component that raised it unmounts", () => {
    function ClosesItself() {
      const [state, setState] = useState<ActionResultState | undefined>();
      const [open, setOpen] = useState(true);
      useActionToast(state);
      // Stand-in for the password modal: it closes itself a moment after the
      // change lands, taking any inline confirmation down with it.
      useEffect(() => {
        if (!state?.success) return;
        const timer = setTimeout(() => setOpen(false), 1200);
        return () => clearTimeout(timer);
      }, [state]);
      if (!open) return null;
      return (
        <button
          type="button"
          onClick={() => setState({ success: "Password updated." })}
        >
          submit
        </button>
      );
    }

    render(
      <ToastProvider>
        <ClosesItself />
      </ToastProvider>,
    );
    submit();

    elapse(1300);
    expect(
      screen.queryByRole("button", { name: "submit" }),
    ).not.toBeInTheDocument();
    // The confirmation outlives the form it came from — which is the entire
    // reason the provider lives at the root layout.
    expect(screen.getByRole("status")).toHaveTextContent("Password updated.");
  });
});
