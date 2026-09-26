/**
 * The passkey mark and the success mark. What is pinned here is what motion
 * cannot be allowed to change: at rest the fingerprint IS lucide's icon, the
 * scanning state is visibly different, reduced motion gets the plain icon in
 * every state, and neither mark ever reaches a screen reader.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { Fingerprint } from "lucide-react";
import { AnimatedFingerprint } from "@/components/auth/AnimatedFingerprint";
import { SuccessMark } from "@/components/auth/SuccessMark";

// Per test: motion caches the real media query module-wide, so it is
// switched here the way the other motion specs do it.
const motionPrefs = vi.hoisted(() => ({ reduced: false }));
vi.mock("motion/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("motion/react")>()),
  useReducedMotion: () => motionPrefs.reduced,
}));

afterEach(() => {
  cleanup();
  motionPrefs.reduced = false;
});

function preferReducedMotion(reduce: boolean) {
  motionPrefs.reduced = reduce;
}

const pathsOf = (container: HTMLElement) =>
  Array.from(container.querySelectorAll("path")).map((path) => path.getAttribute("d"));

describe("AnimatedFingerprint", () => {
  it("at rest draws exactly lucide's fingerprint, ridge for ridge", () => {
    preferReducedMotion(false);
    const lucide = render(<Fingerprint />).container;
    const ours = render(<AnimatedFingerprint />).container;
    expect(new Set(pathsOf(ours))).toEqual(new Set(pathsOf(lucide)));
    expect(ours.querySelector("line")).toBeNull();
  });

  it("scanning adds the reading line", () => {
    preferReducedMotion(false);
    const { container } = render(<AnimatedFingerprint state="scanning" />);
    expect(container.querySelector("svg")).toHaveAttribute("data-fingerprint-state", "scanning");
    expect(container.querySelector("line")).not.toBeNull();
  });

  it("with reduced motion, every state is the plain icon", () => {
    preferReducedMotion(true);
    for (const state of ["scanning", "success", "error"] as const) {
      const { container, unmount } = render(<AnimatedFingerprint state={state} />);
      expect(container.querySelector("svg")).toHaveAttribute("data-fingerprint-state", "idle");
      expect(container.querySelector("line")).toBeNull();
      unmount();
    }
  });

  it("is decoration only", () => {
    preferReducedMotion(false);
    const { container } = render(<AnimatedFingerprint state="success" />);
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });
});

describe("SuccessMark", () => {
  it("shows the passkey's print, or the app's phone, and stays out of the accessibility tree", () => {
    preferReducedMotion(false);
    const passkey = render(<SuccessMark kind="passkey" />).container.firstElementChild!;
    expect(passkey).toHaveAttribute("aria-hidden", "true");
    expect(passkey).toHaveAttribute("data-success-mark", "passkey");
    expect(passkey.querySelector("[data-fingerprint-state]")).not.toBeNull();
    cleanup();

    const app = render(<SuccessMark kind="app" />).container.firstElementChild!;
    expect(app).toHaveAttribute("data-success-mark", "app");
    expect(app.querySelector("[data-fingerprint-state]")).toBeNull();
    expect(app.querySelector(".lucide-smartphone")).not.toBeNull();
  });
});
