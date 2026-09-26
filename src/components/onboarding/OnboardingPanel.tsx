"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { completeOnboarding, markSetupCelebrated } from "@/lib/onboarding/actions";
import type { SetupChecklistData, SetupStepId } from "@/lib/onboarding/steps";
import {
  newlyDoneSteps,
  serializeSeenSteps,
  SETUP_SEEN_COOKIE,
  SETUP_SEEN_MAX_AGE,
} from "@/lib/onboarding/seen-steps";
import { endTour, setTourNext, startTour, type TourNext } from "@/lib/onboarding/tour-store";
import type { TraderIdentityField } from "@/lib/settings/trader-identity";
import { SETUP_ANIMATION_SETTLE_MS, SetupChecklist } from "./SetupChecklist";
import { WelcomeFlow, type SellerPrefill } from "./WelcomeFlow";

/** Everything Overview resolves on the server for the setup slot. */
export type OnboardingData = {
  /** Null for a member on someone else's store, or when the gate read failed. */
  setup: SetupChecklistData | null;
  /** The steps this device last saw done (the setup-seen cookie), or null with
   *  no history. Steps done since then animate on the card. */
  seenSteps: readonly SetupStepId[] | null;
  /** Whose setup this is: the setup-seen cookie is kept per account. */
  accountId: string;
  traderMissing: readonly TraderIdentityField[];
  /** The welcome flow has never been seen by this person. */
  welcomePending: boolean;
  /** This person has agreed to the CURRENT Terms (LEGAL_VERSION). When false,
   *  the welcome flow asks for it, and cannot be left until it has it. */
  termsAccepted: boolean;
  /** The finished setup card ("You're set up") has never been shown to them. */
  celebrationPending: boolean;
  /** The profile's current trader identity, to prefill the seller step. */
  seller: SellerPrefill | null;
  verificationOn: boolean;
  livePageUrl: string | null;
  /** `?tour=1`: someone asked for the guided tour (the search action). */
  tourRequested: boolean;
};

const EMPTY_SELLER: SellerPrefill = { businessName: "", address: "", email: "" };

/**
 * Whether this tab has already shown (and recorded) the finished setup card.
 * The server stops asking for it once the write lands, but Back can restore an
 * Overview payload fetched before that, which still says "pending".
 */
let celebratedInThisTab = false;

/**
 * The client half of the setup slot: the checklist, the welcome flow, the hand
 * over to the guided tour, and the two one-time server writes between them.
 *
 * The dialog starts OPEN from its initial state rather than from an effect:
 * sign-up lands here through a server action's redirect, a soft navigation, and
 * an effect-opened dialog would flash the page it covers first.
 *
 * Whichever way the welcome is left (skipped, closed, or on into the tour), the
 * fact is recorded once.
 *
 * The finished card is LATCHED for the visit: once shown it stays up even after
 * the server has recorded it, because the welcome's own write revalidates this
 * page and would otherwise take the card away while it is being read.
 */
export function OnboardingPanel({
  setup,
  seenSteps,
  accountId,
  traderMissing,
  welcomePending,
  termsAccepted,
  celebrationPending,
  seller,
  verificationOn,
  livePageUrl,
  tourRequested,
}: OnboardingData) {
  const t = useTranslations();
  const router = useRouter();
  const [open, setOpen] = useState(welcomePending);
  const pendingRef = useRef(welcomePending);
  const [celebrate] = useState(() => celebrationPending && !celebratedInThisTab);

  // The checklist's next step is what the tour's last card offers. Kept fresh
  // (a seller save refreshes the page mid-tour) in a ref for the handlers and
  // in the store for a tour already running.
  const nextHref = setup?.next?.action?.href ?? null;
  // Resolved here: the tour store holds display text, not message keys.
  const nextLabel = setup?.next?.action
    ? t(setup.next.cta.key, setup.next.cta.values)
    : null;
  const nextRef = useRef<TourNext | null>(null);
  useEffect(() => {
    const offer = nextHref && nextLabel ? { href: nextHref, label: nextLabel } : null;
    nextRef.current = offer;
    setTourNext(offer);
  }, [nextHref, nextLabel]);

  // A welcome that opens replaces any tour this tab still had running.
  useEffect(() => {
    if (welcomePending) endTour();
  }, [welcomePending]);

  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  // `?tour=1` (the search action). Never over the welcome, which starts the
  // tour itself; the query is dropped either way, or a refresh would restart it.
  useEffect(() => {
    if (!tourRequested) return;
    if (!openRef.current) startTour({ next: nextRef.current });
    router.replace("/dashboard", { scroll: false });
  }, [tourRequested, router]);

  const record = useCallback(async () => {
    if (!pendingRef.current) return;
    pendingRef.current = false;
    await completeOnboarding();
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    void record();
  }, [record]);

  const beginTour = useCallback(() => {
    setOpen(false);
    void record();
    startTour({ next: nextRef.current });
  }, [record]);

  // Steps done since this device last looked animate on the card. The "before"
  // is LATCHED for the visit, not re-read from each server render: the cookie
  // written below comes back on the next refresh, and would otherwise wipe a
  // step's animation the moment it is recorded. It only moves forward once the
  // animation has had time to play (so folding the card away and back does not
  // replay it), and a step finished DURING the visit (the welcome flow's seller
  // save) still counts as new against it.
  const [seenBefore, setSeenBefore] = useState(seenSteps);
  const doneIds = (setup?.steps ?? []).filter((step) => step.done).map((step) => step.id);
  const doneKey = doneIds.join("|");
  const freshSteps = setup ? newlyDoneSteps(setup.steps, seenBefore) : [];

  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
  }, []);

  // The card is on screen, unfolded and not under the welcome: what it shows
  // now has been seen. Recorded at once (a reload mid-animation must not replay
  // it), settled locally once the animation is over.
  const stepsSeen = useCallback(() => {
    const done = doneKey === "" ? [] : (doneKey.split("|") as SetupStepId[]);
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${SETUP_SEEN_COOKIE}=${serializeSeenSteps(accountId, done)}; Path=/; Max-Age=${SETUP_SEEN_MAX_AGE}; SameSite=Lax${secure}`;
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => setSeenBefore(done), SETUP_ANIMATION_SETTLE_MS);
  }, [doneKey, accountId]);

  const recordCelebration = useCallback(() => {
    if (celebratedInThisTab) return;
    celebratedInThisTab = true;
    void markSetupCelebrated();
  }, []);

  return (
    <>
      {setup && (
        <SetupChecklist
          setup={setup}
          livePageUrl={livePageUrl}
          celebrate={celebrate}
          onCelebrated={recordCelebration}
          freshSteps={freshSteps}
          paused={open}
          onStepsSeen={stepsSeen}
        />
      )}
      <WelcomeFlow
        open={open}
        onClose={close}
        onStartTour={beginTour}
        includeTermsStep={!termsAccepted}
        includeSellerStep={seller !== null && setup?.seller === "missing"}
        seller={seller ?? EMPTY_SELLER}
        emailVerified={!traderMissing.includes("emailVerified")}
        verificationOn={verificationOn}
      />
    </>
  );
}
