// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * WHERE the toast system is mounted, and what it must sit above.
 *
 * Both were learned the hard way and neither shows up in a component test:
 *
 *   - a provider mounted per route group unmounts on a cross-group navigation,
 *     which is exactly when a "saved" message is travelling (product form →
 *     product list, invite accepted → team page);
 *   - a toast that renders behind the modal that raised it is not a
 *     confirmation. The invite modal, the password modal and the delete
 *     confirms all report through toasts, and they are all z-50.
 */

const src = (...parts: string[]) =>
  readFileSync(join(process.cwd(), "src", ...parts), "utf8");

const globals = () => src("app", "globals.css");

describe("toast provider placement", () => {
  it("is mounted once, at the root layout", () => {
    expect(src("app", "layout.tsx")).toContain("<ToastProvider>");
  });

  it("is not re-mounted per route group", () => {
    // A nested provider would shadow the root one for everything under it, and
    // take its toasts down with the segment when the user navigates away.
    const groups = [
      join("app", "(dashboard)", "layout.tsx"),
      join("app", "settings", "layout.tsx"),
      join("app", "storefront", "layout.tsx"),
    ];
    const offenders = groups.filter((file) =>
      src(file).includes("<ToastProvider"),
    );
    expect(offenders).toEqual([]);
  });

  it("stacks above modals and the search overlay", () => {
    const toast = src("components", "ui", "Toast.tsx");
    // Modals are z-50, the universal-search panel is z-[60]. Anything at or
    // below those can be covered by the very surface that raised the message.
    expect(toast).toContain("z-[70]");
    expect(src("components", "ui", "modal.tsx")).toContain("z-50");
  });

  it("anchors bottom-RIGHT, clear of the left nav rail", () => {
    const toast = src("components", "ui", "Toast.tsx");
    // The rail is a fixed 16rem column with live controls (Settings, Discover)
    // at its foot; a 24rem toast in the opposite corner never sits on them.
    expect(toast).toContain("sm:right-6");
    expect(toast).not.toContain("sm:left-6");
  });

  it("never lets a tone colour the card's border", () => {
    const toast = src("components", "ui", "Toast.tsx");
    // Tone lives in the mark. A red-bordered card restates it louder, and
    // three toasts in three border colours stop reading as one channel.
    expect(toast).not.toMatch(/border-(destructive|success)/);
  });

  it("keeps the dismiss control on the card's vertical axis", () => {
    // Not top-aligned: a five-line error would leave the X stranded at the
    // top corner, away from the mass of the card it closes.
    expect(src("components", "ui", "Toast.tsx")).toContain("self-center");
  });

  it("grows the dismiss target on touch without growing the card", () => {
    // A 44px CONTROL is taller than the line of text beside it and inflates
    // every single-line toast into a box with dead space under the words. The
    // hit area is grown with a pseudo-element instead.
    const toast = src("components", "ui", "Toast.tsx");
    expect(toast).toContain("after:-inset-2");
    expect(toast).toContain("sm:after:hidden");
  });

  it("keeps the dev-tools badge out of the stack's corner", () => {
    // Next pins it bottom-right by default, directly on top of every
    // confirmation raised in development.
    const config = readFileSync(join(process.cwd(), "next.config.ts"), "utf8");
    expect(config).toMatch(/devIndicators:\s*\{\s*position:\s*"bottom-left"/);
  });

  it("keeps the marks smaller than the words they introduce", () => {
    // A mark is what you glance at on the way to the message. The outcome
    // tones sit a step above the neutral one — geometry reads small, a glyph
    // scaled to match reads as a typo — but none of them competes with the
    // sentence, which is the thing actually being read.
    const icons = src("components", "ui", "toast-icons.tsx");
    const sizeFor = (tone: string) =>
      icons
        .slice(icons.indexOf(`${tone}: {`))
        .match(/size: "(size-\d+)"/)?.[1];
    expect(sizeFor("success")).toBe("size-5");
    expect(sizeFor("error")).toBe("size-5");
    expect(sizeFor("info")).toBe("size-4");
  });

  it("hangs the mark in a line-height box so it centres on the headline", () => {
    // The marks are taller than the text beside them. Without the box, each
    // tone needs its own nudge and they drift apart the next time one resizes.
    expect(src("components", "ui", "Toast.tsx")).toContain(
      "flex h-5 shrink-0 items-center",
    );
  });

  it("re-steps success for dark surfaces", () => {
    // --color-success is a green-700 tuned for white. On the near-black card
    // it sinks into the surface, so the dark companion is not optional.
    const toast = src("components", "ui", "Toast.tsx");
    expect(toast).toContain("dark:text-success-dark");
    expect(globals()).toContain("--color-success-dark");
  });

  it("clears the phone's bottom furniture", () => {
    // The storefront editor floats its toolbar at bottom-4, and the bottom
    // edge of a phone is the home-indicator strip regardless.
    expect(src("components", "ui", "Toast.tsx")).toContain("bottom-20");
  });

  it("stacks newest nearest the anchor", () => {
    // The list is newest-first, so a bottom anchor needs the reversed axis for
    // the newest toast to land at the bottom and the oldest to expire off the
    // top — otherwise the stack shifts under the message being read.
    expect(src("components", "ui", "Toast.tsx")).toContain("flex-col-reverse");
  });
});
