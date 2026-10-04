"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { AccountPlanProvider } from "@/components/billing/plan-context";
import { PlansPage } from "@/components/billing/PlansPage";
import { BillingSection } from "@/components/settings/BillingSection";
import { msg } from "@/i18n/types";
import { failure, invalidInput, rateLimited, serverError, type ActionError } from "@/lib/errors";
import type { PricingContext } from "@/lib/billing/pricing-context";
import { formatLongDate } from "@/lib/format/date";
import { STAND_IN_DELAY_MS, standInBillingActions, wait } from "../pricing/fixtures";
import { DevOptionGroup, GallerySection } from "../pricing/DevControls";
import { DEV_CANCEL_START, writeDevCancelState, type DevAnswer, type DevCancelState } from "./state";

const PLAN_OPTIONS = [
  { value: "starter", label: "Starter" },
  { value: "pro", label: "Pro" },
] as const;

const INTERVAL_OPTIONS = [
  { value: "month", label: "Monthly" },
  { value: "year", label: "Yearly" },
] as const;

const ANSWER_OPTIONS: readonly { value: DevAnswer; label: string }[] = [
  { value: "ok", label: "Works" },
  { value: "refuse", label: "Refuses (changed in another tab)" },
  { value: "rateLimited", label: "Too many tries" },
  { value: "serverError", label: "Server error" },
  { value: "deletionPending", label: "Account set to be deleted (keep refused)" },
];

/** What the stand-in server says to cancel and to keep, per answer (null:
 *  yes), built from the real error constructors so the copy is the app's. */
const REFUSALS: Record<DevAnswer, { cancel: ActionError | null; keep: ActionError | null }> = {
  ok: { cancel: null, keep: null },
  refuse: {
    cancel: invalidInput(msg("Errors.billing.notCancellable")),
    keep: invalidInput(msg("Errors.billing.notResumable")),
  },
  rateLimited: { cancel: rateLimited("changePlan"), keep: rateLimited("changePlan") },
  serverError: { cancel: serverError("cancelPlan"), keep: serverError("resumePlan") },
  deletionPending: { cancel: null, keep: invalidInput(msg("Errors.billing.deletionPending")) },
};

/**
 * The cancel flow end to end on a pretend subscription: the real Settings
 * plan card and plans page, with stand-in actions that change the pretend
 * plan (see ./state.ts) the way the server changes a real one.
 */
export function CancelGallery({ state, context }: { state: DevCancelState; context: PricingContext }) {
  const router = useRouter();
  const [sent, setSent] = useState<string | null>(null);

  /** Change the pretend subscription and show it, as a reload would. */
  function save(next: DevCancelState) {
    writeDevCancelState(next);
    router.refresh();
  }

  const actions = useMemo(
    () =>
      standInBillingActions(setSent, {
        cancelPlan: async (feedback) => {
          setSent(`cancelPlan ${JSON.stringify(feedback)}`);
          await wait(STAND_IN_DELAY_MS);
          const refusal = REFUSALS[state.answer].cancel;
          if (refusal) return failure(refusal);
          // Saved but not shown yet: the dialog refreshes the page on close.
          writeDevCancelState({ ...state, ending: true });
          return { ok: true, endsAt: context.currentPeriodEnd ?? new Date().toISOString() };
        },
        resumePlan: async () => {
          setSent("resumePlan");
          await wait(STAND_IN_DELAY_MS);
          const refusal = REFUSALS[state.answer].keep;
          if (refusal) return failure(refusal);
          writeDevCancelState({ ...state, ending: false });
          return { ok: true };
        },
      }),
    [state, context.currentPeriodEnd],
  );

  const ends = context.currentPeriodEnd ? formatLongDate(context.currentPeriodEnd, "en") : "";

  return (
    <AccountPlanProvider plan={context.plan}>
      <div className="mx-auto max-w-6xl space-y-4 px-6 pt-10">
        <header>
          <h1 className="text-2xl font-semibold text-foreground">Cancel flow</h1>
          <p className="mt-1 max-w-3xl font-inter text-sm text-muted-foreground">
            Cancel and keep a pretend paid plan with the real dialog and buttons. The plan lives in a cookie,
            so the page changes only when it refreshes, as it does for real. Nothing is billed. Every other
            billing state is on{" "}
            <Link href="/dev/pricing" className="underline underline-offset-4">
              /dev/pricing
            </Link>
            .
          </p>
        </header>
        <DevOptionGroup
          label="Plan"
          options={PLAN_OPTIONS}
          value={state.plan}
          onChange={(plan) => save({ ...state, plan, ending: false })}
        />
        <DevOptionGroup
          label="Billed"
          options={INTERVAL_OPTIONS}
          value={state.interval}
          onChange={(interval) => save({ ...state, interval, ending: false })}
        />
        <DevOptionGroup
          label="The server"
          options={ANSWER_OPTIONS}
          value={state.answer}
          onChange={(answer) => save({ ...state, answer })}
        />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 font-inter text-xs text-muted-foreground">
          <p data-dev-cancel-state={context.cancelAtPeriodEnd ? "ending" : "renewing"}>
            Pretend plan: {context.cancelAtPeriodEnd ? `ends on ${ends}` : `renews on ${ends}`}
          </p>
          <button
            type="button"
            className="underline underline-offset-4"
            onClick={() => {
              setSent(null);
              save(DEV_CANCEL_START);
            }}
          >
            Start over
          </button>
        </div>
        {sent && (
          <p className="font-inter text-xs text-muted-foreground" data-dev-navigation>
            Sent to the server: {sent}
          </p>
        )}
      </div>

      {/* Not keyed on the state: a refresh must not unmount an open dialog. */}
      <GallerySection title="Settings › Plan & billing">
        <div className="max-w-3xl">
          <BillingSection context={context} returned={null} actions={actions} />
        </div>
      </GallerySection>

      <GallerySection title="Plans page (Move to Free, and the ending notice)">
        <PlansPage context={context} source={null} actions={actions} />
      </GallerySection>
    </AccountPlanProvider>
  );
}
