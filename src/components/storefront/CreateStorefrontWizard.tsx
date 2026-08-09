"use client";

import { useCallback, useId, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { useToast } from "@/components/ui/Toast";
import {
  fieldBaseClass,
  helpTextClass,
  iconNudgeLeftClass,
  iconNudgeRightClass,
  labelClass,
} from "@/components/ui/control-styles";
import { EASE_STANDARD } from "@/components/dashboard/nav-icons/motion-tokens";
import { createStorefront } from "@/lib/storefront/actions";
import { STOREFRONT_NAME_MAX } from "@/lib/validation/storefront";
import { BRIEF_OTHER_CATEGORY_MAX } from "@/types/storefront-brief";
import type {
  StorefrontBrief,
  StorefrontCategory,
  StorefrontFulfilment,
  StorefrontVibe,
} from "@/types/storefront-brief";
import {
  CategoryGrid,
  FulfilmentGrid,
  VibeGrid,
  namePlaceholderFor,
} from "./create-options";

/**
 * The four questions asked before a seller reaches the designer.
 *
 * WHY IT IS THIS SHORT. Every extra field past about five costs roughly twice
 * what the ones before it did, and this is not a signup: sellers do it again
 * for every storefront they make, so annoyance compounds where drop-off would
 * not. Two questions the research would normally ask are missing on purpose.
 * Catalogue size is derived from the seller's real product count instead of
 * asked, and the name is left until last with a placeholder already filled in,
 * because a blank text box is the most expensive input on the screen.
 *
 * WHY IT IS WORTH ASKING AT ALL. The look question does immediate work: it
 * picks the theme the storefront starts on, so the seller lands on a board that
 * already resembles what they chose. The rest is stored for the template
 * recommender (lib/storefront/templates.ts), which does not exist yet.
 *
 * NOTHING HERE IS REQUIRED. Skip creates the storefront now with whatever has
 * been answered so far; closing the dialog creates nothing at all. Those are
 * genuinely different intentions, so they get separate controls, and the row is
 * only inserted at the very end so an abandoned dialog cannot leave an
 * "Untitled storefront" behind.
 */

const STEPS = ["category", "fulfilment", "vibe", "name"] as const;
type Step = (typeof STEPS)[number];

const STEP_COPY: Record<Step, { title: string; description: string }> = {
  category: {
    title: "What do you sell?",
    description: "This is the biggest clue for which layouts will suit you.",
  },
  fulfilment: {
    title: "How do buyers get it?",
    description: "It decides what your storefront needs to handle at checkout.",
  },
  vibe: {
    title: "Pick a look",
    description: "Your starting point. Everything stays editable in the designer.",
  },
  name: {
    title: "Name your storefront",
    description: "Just for you. You can rename it any time.",
  },
};

export function CreateStorefrontWizard({
  open,
  onClose,
  onCreated,
  productCount,
  previousBrief,
}: {
  open: boolean;
  onClose: () => void;
  /** Fired with the new row's id; the caller navigates to the designer. */
  onCreated: (id: string) => void;
  /** The seller's real product count. Used for a hint, never as a gate: the
   *  recommender reads the live count rather than a number captured here. */
  productCount: number;
  /** Answers from their last storefront, so a returning seller confirms rather
   *  than re-answers. Undefined for the first one. */
  previousBrief?: StorefrontBrief;
}) {
  const toast = useToast();
  const fieldId = useId();
  const reducedMotion = useReducedMotion();
  const scrollRef = useRef<HTMLDivElement>(null);

  const [stepIndex, setStepIndex] = useState(0);
  const [category, setCategory] = useState<StorefrontCategory | null>(null);
  const [otherCategory, setOtherCategory] = useState("");
  const [fulfilment, setFulfilment] = useState<StorefrontFulfilment | null>(null);
  const [vibe, setVibe] = useState<StorefrontVibe | null>(null);
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // Direction only drives which way the step slides, so it is deliberately not
  // part of the answer state.
  const [back, setBack] = useState(false);

  const step = STEPS[stepIndex];
  const isLastStep = stepIndex === STEPS.length - 1;

  // Reset on every open, and seed the two store-level answers from the previous
  // storefront: what someone sells has not changed since they last made one, so
  // the flow confirms rather than re-asks. The look is deliberately NOT seeded.
  // A seller making a second storefront usually wants a different one, and
  // pre-selecting it would quietly skip the only question that changes what
  // they are about to see.
  //
  // Adjusted during render rather than in an effect (the pattern StorefrontsList
  // uses to adopt fresh props): an effect would render the stale answers for a
  // frame first, and `previousBrief` is a fresh object on every parent render,
  // so it can never be a stable dependency.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setStepIndex(0);
      setBack(false);
      setSubmitting(false);
      setCategory(previousBrief?.category ?? null);
      setOtherCategory(previousBrief?.otherCategory ?? "");
      setFulfilment(previousBrief?.fulfilment ?? null);
      setVibe(null);
      setName("");
    }
  }

  /**
   * Move focus onto each step as it arrives. Modal only does this when it
   * OPENS, so without it a keyboard user's focus would be left on a control
   * that no longer exists once the step swaps.
   *
   * A callback ref rather than an effect keyed on the step: AnimatePresence
   * runs `mode="wait"`, so the incoming step is not mounted at the moment an
   * effect would fire, and the focus would land on the outgoing content. This
   * fires exactly when the new node attaches.
   *
   * The container takes focus, not the first tile, so assistive tech announces
   * the new question instead of a button whose label says nothing about what
   * just changed.
   *
   * The scroll region persists across steps, so it is rewound here too:
   * arriving at a four-tile step already scrolled past its only row, because
   * the thirteen-tile step before it was scrolled down, reads as an empty
   * dialog.
   */
  const focusStep = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    node.focus({ preventScroll: true });
  }, []);

  function goTo(next: number) {
    setBack(next < stepIndex);
    setStepIndex(next);
  }

  /** Everything answered so far. Partial by design: skipping is allowed at any
   *  point, so this is whatever exists when the seller stops. */
  function collectBrief(): StorefrontBrief {
    return {
      ...(category ? { category } : {}),
      ...(category === "other" && otherCategory.trim()
        ? { otherCategory: otherCategory.trim() }
        : {}),
      ...(fulfilment ? { fulfilment } : {}),
      ...(vibe ? { vibe } : {}),
    };
  }

  async function create() {
    if (submitting) return;
    setSubmitting(true);
    const result = await createStorefront({
      // An empty name is not an error; the server falls back to "Untitled
      // storefront" exactly as it did before this flow existed.
      ...(name.trim() ? { name: name.trim() } : {}),
      brief: collectBrief(),
    });
    if (!result.ok) {
      toast.error(result.error.message, { lines: [result.error.fix] });
      setSubmitting(false);
      return;
    }
    // Leave `submitting` set: we are navigating away, and re-enabling the
    // buttons for the frame before that just invites a second create.
    onCreated(result.id);
  }

  const copy = STEP_COPY[step];

  return (
    <Modal
      open={open}
      // Closing is a cancel, not a skip: no row is created. The two live on
      // separate controls because they are separate intentions.
      onClose={submitting ? () => {} : onClose}
      title={copy.title}
      description={copy.description}
      // The panel becomes a column so ONLY the answers scroll: the question,
      // the progress and the controls are always on screen. `pb-3` trims the
      // panel's own bottom padding, which the footer no longer has to sit on
      // top of.
      className="flex flex-col overflow-y-hidden pb-3 sm:max-w-xl"
    >
      <div className="shrink-0">
        <ProgressBar
          value={(stepIndex + 1) / STEPS.length}
          label={`Step ${stepIndex + 1} of ${STEPS.length}`}
          className="mb-1"
        />
        <p className="mb-4 font-inter text-xs text-muted-foreground">
          Step {stepIndex + 1} of {STEPS.length}
        </p>
      </div>

      {/* The one scrolling region. Bled out to the panel edges and back in
          again on every side: a tile's focus ring sits 4px outside it, which
          the overflow would otherwise shear off the first and last rows. The
          matching negative margins keep the bleed invisible. */}
      <div
        ref={scrollRef}
        className="-mx-6 -my-1 min-h-0 flex-1 overflow-y-auto px-6 py-1"
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={step}
            ref={focusStep}
            tabIndex={-1}
            role="group"
            aria-label={copy.title}
            className="outline-none"
            initial={reducedMotion ? false : { opacity: 0, x: back ? -12 : 12 }}
            animate={reducedMotion ? {} : { opacity: 1, x: 0 }}
            exit={reducedMotion ? {} : { opacity: 0, x: back ? 12 : -12 }}
            transition={{ duration: 0.18, ease: EASE_STANDARD }}
          >
            {step === "category" && (
              <>
                <CategoryGrid value={category} onChange={setCategory} />
                {category === "other" && (
                  <div className="mt-3 space-y-1.5">
                    <label
                      htmlFor={`${fieldId}-other`}
                      className={labelClass}
                    >
                      What do you sell?
                    </label>
                    <input
                      id={`${fieldId}-other`}
                      type="text"
                      value={otherCategory}
                      onChange={(event) => setOtherCategory(event.target.value)}
                      maxLength={BRIEF_OTHER_CATEGORY_MAX}
                      placeholder="e.g. model kits"
                      className={fieldBaseClass}
                    />
                  </div>
                )}
                {productCount === 0 && (
                  <p className={cn(helpTextClass, "mt-3")}>
                    No products yet? Add them after setup.
                  </p>
                )}
              </>
            )}

            {step === "fulfilment" && (
              <FulfilmentGrid value={fulfilment} onChange={setFulfilment} />
            )}

            {step === "vibe" && <VibeGrid value={vibe} onChange={setVibe} />}

            {step === "name" && (
              <div className="space-y-1.5">
                <label htmlFor={`${fieldId}-name`} className={labelClass}>
                  Storefront name
                </label>
                <input
                  id={`${fieldId}-name`}
                  type="text"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void create();
                    }
                  }}
                  maxLength={STOREFRONT_NAME_MAX}
                  placeholder={namePlaceholderFor(category)}
                  className={fieldBaseClass}
                />
                <p className={helpTextClass}>
                  Leave it blank and we will call it Untitled storefront.
                </p>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* A plain flex item, NOT sticky. Sticky lifted it out of flow, so it
          painted over the last row of tiles, and it had to carry the panel's
          own bottom padding to sit flush, which made the bar twice the height
          it needed. As a column child it is always visible and costs only its
          own padding. */}
      <div className="-mx-6 mt-3 flex shrink-0 items-center justify-between gap-3 border-t border-border px-6 pt-2.5">
        {stepIndex > 0 ? (
          <Button
            variant="ghost"
            onClick={() => goTo(stepIndex - 1)}
            disabled={submitting}
          >
            <ArrowLeft className={cn("size-4", iconNudgeLeftClass)} aria-hidden />
            Back
          </Button>
        ) : (
          <Button variant="ghost" onClick={create} disabled={submitting}>
            Skip setup
          </Button>
        )}

        <div className="flex items-center gap-2">
          {stepIndex > 0 && !isLastStep && (
            <Button variant="ghost" onClick={create} disabled={submitting}>
              Skip
            </Button>
          )}
          {isLastStep ? (
            <Button onClick={create} disabled={submitting}>
              {submitting ? "Creating…" : "Create storefront"}
            </Button>
          ) : (
            <Button onClick={() => goTo(stepIndex + 1)} disabled={submitting}>
              Next
              <ArrowRight
                className={cn("size-4", iconNudgeRightClass)}
                aria-hidden
              />
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
