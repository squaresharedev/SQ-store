"use client";

import { useEffect, useState } from "react";
import { ToastToneIcon } from "@/components/ui/toast-icons";
import {
  toneAccentClass,
  useToast,
  type ToastFn,
  type ToastOptions,
  type ToastTone,
} from "@/components/ui/Toast";
import { ghostButtonClass, helpTextClass, infoTextClass, primaryButtonClass, secondaryButtonClass } from "@/components/ui/control-styles";
import { cn } from "@/lib/utils";

/**
 * Living reference for the toast system. Two things it exists to make cheap:
 *
 *   1. PINNING. Every specimen can be raised with an unlimited lifetime, so a
 *      toast can be stared at, measured and restyled without re-triggering it
 *      every four seconds.
 *   2. THE AWKWARD CASES. A message with no room to breathe, one with five
 *      detail lines, a full stack, an overflowing stack — the states that only
 *      show up in the wild once the copy is already shipped.
 *
 * It renders the REAL provider from the root layout, not a copy, so anything
 * seen here is what a save actually produces.
 */

const TONES: ToastTone[] = ["success", "error", "info"];

const TONE_STORY: Record<ToastTone, string> = {
  success:
    "It worked. The check draws itself on. Four seconds — long enough to read six words.",
  error:
    "It did not work. Twice the lifetime, because an error carries specifics, and role=alert so it interrupts.",
  info: "Neither, and nothing to fix. Reserved for what a user should know but need not act on.",
};

const SPECIMENS: Array<{
  label: string;
  note: string;
  fire: (toast: ToastFn, options: ToastOptions) => void;
}> = [
  {
    label: "The short one",
    note: "Most toasts are this. One clause, a full stop, gone.",
    fire: (toast, o) => toast.success("Profile photo updated.", o),
  },
  {
    label: "Named subject",
    note: "A delete has to say WHAT went — the row leaving is the only other evidence.",
    fire: (toast, o) => toast.success('"Ambient Loops Vol. 1" was deleted.', o),
  },
  {
    label: "With a follow-up line",
    note: "The action that travels with the news, rather than a line the modal loses on close.",
    fire: (toast, o) =>
      toast.success("New embed key issued.", {
        ...o,
        lines: ["Re-paste the snippet everywhere this storefront is embedded."],
      }),
  },
  {
    label: "A refusal",
    note: "What the server said, plus what to do about it.",
    fire: (toast, o) =>
      toast.error("Could not save. Give it another try.", {
        ...o,
        lines: ["Check your connection, then press Save again."],
      }),
  },
  {
    label: "A blocked save",
    note: "The long-form case that forced the whole system: every problem, at the button.",
    fire: (toast, o) =>
      toast.error("This product can't be saved yet, 3 things to fix", {
        ...o,
        lines: [
          "Give your product a title.",
          "Price must be a number greater than zero.",
          "Stock must be a whole number, 0 or more, with no decimals.",
        ],
      }),
  },
  {
    label: "Too many words",
    note: "The stress test. Nothing may overflow the card or push the dismiss button off it.",
    fire: (toast, o) =>
      toast.error(
        "The upload was refused because the file is a supercalifragilisticexpialidocious 214MB uncompressed TIFF, which is well past the cap",
        {
          ...o,
          lines: [
            "Export it as a JPEG or WebP under 10MB and try again. If it still will not go, the original is probably a scan at print resolution, which nothing on a storefront needs.",
          ],
        },
      ),
  },
  {
    label: "Neutral",
    note: "Information, not an outcome. Rare on purpose.",
    fire: (toast, o) => toast.info("Your export is being prepared.", o),
  },
];

function Section({
  title,
  blurb,
  children,
}: {
  title: string;
  blurb: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4 border-t border-border pt-8">
      <div className="max-w-2xl space-y-1">
        <h2 className="text-lg font-semibold tracking-tight text-foreground">
          {title}
        </h2>
        <p className={helpTextClass}>{blurb}</p>
      </div>
      {children}
    </section>
  );
}

export function ToastGallery() {
  const toast = useToast();
  // Pinned toasts never expire, which is the point: styling one is impossible
  // while it keeps walking off the screen.
  const [pinned, setPinned] = useState(true);
  const options = pinned ? { duration: Number.POSITIVE_INFINITY } : {};

  // The app ships light-only for now, so this is the only place a toast can be
  // checked against the dark tokens before a theme toggle exists. Stamped on
  // <html> because that is where the real one will go.
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", dark);
    return () => root.classList.remove("dark");
  }, [dark]);

  return (
    <div className="mx-auto max-w-4xl space-y-8 px-6 py-10">
      <header className="space-y-2">
        <p className="font-inter text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Dev gallery
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Toasts
        </h1>
        <p className="max-w-2xl font-inter text-sm text-muted-foreground">
          The app&apos;s confirmation channel. Everything below raises a real
          toast through the real provider, bottom-right, exactly as a save does.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-3 bg-muted p-4">
        <label className="flex items-center gap-2 font-inter text-sm text-foreground">
          <input
            type="checkbox"
            checked={pinned}
            onChange={(event) => setPinned(event.target.checked)}
            className="size-4 accent-foreground"
          />
          Pin them open (no auto-dismiss)
        </label>
        <label className="flex items-center gap-2 font-inter text-sm text-foreground">
          <input
            type="checkbox"
            checked={dark}
            onChange={(event) => setDark(event.target.checked)}
            className="size-4 accent-foreground"
          />
          Dark surfaces
        </label>
        <span className={helpTextClass}>
          Off = the real lifetimes: 4s success, 8s error, 5s neutral.
        </span>
        <button
          type="button"
          onClick={() => toast.dismiss()}
          className={cn(ghostButtonClass, "ml-auto")}
        >
          Clear the stack
        </button>
      </div>

      <Section
        title="Tones"
        blurb="Three, and no more. A fourth tone is a decision nobody can make at a glance."
      >
        <div className="grid gap-3 sm:grid-cols-3">
          {TONES.map((tone) => (
            <div key={tone} className="space-y-3 border border-border p-4">
              <div className="flex items-center gap-2.5">
                <ToastToneIcon tone={tone} className={toneAccentClass(tone)} />
                <span className="text-sm font-medium capitalize text-foreground">
                  {tone}
                </span>
              </div>
              <p className={helpTextClass}>
                {TONE_STORY[tone]}
              </p>
              <button
                type="button"
                onClick={() =>
                  toast.show({
                    ...options,
                    tone,
                    title: `A ${tone} message, as it really renders.`,
                  })
                }
                className={cn(secondaryButtonClass, "w-full")}
              >
                Raise it
              </button>
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="The marks, up close"
        blurb="A bare stroke in the tone's own colour, with nothing behind it — the card is already a box, and a chip would make a second one inside the first. Click to replay the draw; toggle Dark surfaces above to check every mark against the dark tokens."
      >
        <IconBench />
      </Section>

      <Section
        title="Specimens"
        blurb="Real copy from real call sites, plus the two shapes that break layouts: five detail lines, and a sentence that will not stop."
      >
        <ul className="divide-y divide-border border border-border">
          {SPECIMENS.map((specimen) => (
            <li
              key={specimen.label}
              className="flex flex-wrap items-center justify-between gap-4 p-4"
            >
              <div className="min-w-0 max-w-xl">
                <p className="text-sm font-medium text-foreground">
                  {specimen.label}
                </p>
                <p className={helpTextClass}>
                  {specimen.note}
                </p>
              </div>
              <button
                type="button"
                onClick={() => specimen.fire(toast, options)}
                className={cn(secondaryButtonClass, "shrink-0")}
              >
                Raise it
              </button>
            </li>
          ))}
        </ul>
      </Section>

      <Section
        title="Behaviour"
        blurb="The parts that are easy to get wrong and impossible to see in a screenshot."
      >
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => {
              toast.success("Saved.", options);
              toast.error("Could not upload the image.", options);
              toast.info("Your export is being prepared.", options);
            }}
            className={primaryButtonClass}
          >
            One of each
          </button>
          <button
            type="button"
            onClick={() => {
              // Five into a stack that holds three: the two oldest are dropped
              // rather than queued, because an answer nobody is waiting for any
              // more is not worth showing late.
              for (let i = 1; i <= 5; i++) {
                toast.info(`Message ${i} of 5.`, options);
              }
            }}
            className={secondaryButtonClass}
          >
            Overflow the stack (5 into 3)
          </button>
          <button
            type="button"
            onClick={() => {
              // Same message three times. One toast, its clock restarted and
              // its mark redrawn — not three identical rows.
              for (let i = 0; i < 3; i++) {
                toast.error("Could not save. Give it another try.", options);
              }
            }}
            className={secondaryButtonClass}
          >
            Say the same thing 3×
          </button>
          <button
            type="button"
            onClick={() =>
              toast.success("Hover me, the bar along the bottom stops.", {
                duration: 10_000,
              })
            }
            className={secondaryButtonClass}
          >
            Watch the clock pause (10s)
          </button>
        </div>
        <p className="max-w-2xl font-inter text-sm text-muted-foreground">
          With focus inside the stack, Escape clears all of them. Hover, keyboard
          focus and a backgrounded tab each stop the clock and bank the
          remainder, so a toast read three times still gets its full time and no
          more.
        </p>
      </Section>
    </div>
  );
}

/** The marks at the size they ship, beside each other and blown up. */
function IconBench() {
  const [generation, setGeneration] = useState(0);
  // No size override on the first row: each tone renders at the size it
  // actually ships, which is the only row that answers "do these sit right
  // together". The rest are for inspecting the geometry.
  const scales = [
    { label: "shipping", className: "" },
    { label: "2×", className: "size-16" },
    { label: "4×", className: "size-32" },
  ];

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={() => setGeneration((n) => n + 1)}
        className={secondaryButtonClass}
      >
        Replay the draw
      </button>
      {scales.map((scale) => (
        <div key={scale.label} className="space-y-2">
          <span className="font-inter text-xs uppercase tracking-wide text-muted-foreground">
            {scale.label}
          </span>
          {/* items-center, and on ONE baseline: the whole question here is how
              the three sit next to each other, which a per-tone column hides.

              overflow-x-auto is load-bearing, not tidiness. The 4× row is
              ~496px wide, and a phone answers overflowing content by widening
              its layout viewport to fit — which moves the initial containing
              block that the FIXED toast stack is positioned against. The stack
              then measured 465px on a 390px screen and hung off both edges,
              so this page lied about the one thing it exists to show. */}
          <div className="flex items-center gap-8 overflow-x-auto border border-border p-6">
            {TONES.map((tone) => (
              <ToastToneIcon
                key={`${tone}-${scale.label}-${generation}`}
                tone={tone}
                className={cn(scale.className, toneAccentClass(tone))}
              />
            ))}
          </div>
        </div>
      ))}
      <p className={infoTextClass}>
        The check and the cross ship at size-5, the &quot;i&quot; at size-4.
        Deliberately uneven, and deliberately small: geometry reads at this size
        and carries the whole outcome, a glyph scaled to match starts reading as
        a typo, and a mark sized to compete with the sentence beside it becomes
        the thing being read.
      </p>
    </div>
  );
}
