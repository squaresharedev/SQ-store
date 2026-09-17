"use client";

import { useSyncExternalStore } from "react";
import {
  isTourStepId,
  tourStep,
  TOUR_STEP_IDS,
  type TourReveal,
  type TourStepId,
} from "./tour-steps";
import { EDITOR_TOUR_STEP_IDS, isEditorTourStepId, type EditorTourStepId } from "./editor-tour-steps";

/**
 * WHERE A GUIDED TOUR IS, for this browser tab.
 *
 * A module store read through `useSyncExternalStore`, persisted to
 * sessionStorage. Not React state, and not the URL, because the dashboard tour
 * has to survive two things:
 *
 * - The dashboard shell REMOUNTING. DashboardShell is rendered by three sibling
 *   layouts ((dashboard), storefront/(list) and settings), so stepping from
 *   Products to Storefront unmounts the overlay and mounts a new one. A module
 *   outlives both.
 * - A refresh. sessionStorage brings the step back for this tab only.
 *
 * A step per URL param was the alternative: it would refetch the server page on
 * every step, leak into copied links, and be dropped by pages that rebuild their
 * own query strings (Products, Orders).
 *
 * Only UI position is stored ({v, stepId, arrived, updatedAt}). `next` (the
 * setup action the last step offers) stays in memory: it can carry a storefront
 * id, and store data does not go in web storage. A stored position that is
 * unknown, malformed or idle for 30 minutes is ignored.
 *
 * Positions are step IDS, not indexes, because the steps a person gets depend
 * on their role (tour-steps.ts, tourStepsFor).
 *
 * ONE STORE PER TOUR (createTourStore). The dashboard tour and the storefront
 * designer's tour are separate instances with their own storage keys and step
 * lists, so starting, ending or restoring one never touches the other.
 */

export type TourNext = { href: string; label: string };

export type TourSnapshot<Id extends string = TourStepId> =
  | { status: "idle" }
  | {
      status: "active";
      stepId: Id;
      /** The overlay has seen this step's page. False while it navigates there. */
      arrived: boolean;
      next: TourNext | null;
    };

/** What the overlay needs from a tour's store. */
export type TourStore<Id extends string = string> = {
  start(options?: { next?: TourNext | null }): void;
  goTo(stepId: Id, options?: { arrived?: boolean }): void;
  markArrived(stepId: Id): void;
  setNext(next: TourNext | null): void;
  end(): void;
  getSnapshot(): TourSnapshot<Id>;
  useTour(): TourSnapshot<Id>;
  /** Tests only: forget everything, including a broken-storage verdict. */
  reset(): void;
};

const STALE_AFTER_MS = 30 * 60 * 1000;

type Stored = { v: 1; stepId: string; arrived: boolean; updatedAt: number };

export function createTourStore<Id extends string>({
  storageKey,
  stepIds,
  isStepId,
}: {
  storageKey: string;
  /** In order: `start` begins at the first. */
  stepIds: readonly [Id, ...Id[]];
  isStepId: (value: unknown) => value is Id;
}): TourStore<Id> {
  const IDLE: TourSnapshot<Id> = { status: "idle" };
  let current: TourSnapshot<Id> = IDLE;
  let hydrated = false;
  /** Storage threw once (private mode, blocked site data): stay in memory. */
  let storageBroken = false;
  const listeners = new Set<() => void>();

  function readStored(): TourSnapshot<Id> {
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (!raw) return IDLE;
      const parsed: unknown = JSON.parse(raw);
      const stored = parsed && typeof parsed === "object" ? (parsed as Partial<Stored>) : null;
      const stepId = stored?.stepId;
      if (
        !stored ||
        stored.v !== 1 ||
        !isStepId(stepId) ||
        typeof stored.updatedAt !== "number" ||
        Date.now() - stored.updatedAt > STALE_AFTER_MS
      ) {
        sessionStorage.removeItem(storageKey);
        return IDLE;
      }
      return { status: "active", stepId, arrived: stored.arrived === true, next: null };
    } catch {
      return IDLE;
    }
  }

  function persist(snapshot: TourSnapshot<Id>) {
    if (storageBroken) return;
    try {
      if (snapshot.status === "idle") {
        sessionStorage.removeItem(storageKey);
      } else {
        const stored: Stored = {
          v: 1,
          stepId: snapshot.stepId,
          arrived: snapshot.arrived,
          updatedAt: Date.now(),
        };
        sessionStorage.setItem(storageKey, JSON.stringify(stored));
      }
    } catch {
      storageBroken = true;
    }
  }

  function getSnapshot(): TourSnapshot<Id> {
    if (!hydrated) {
      hydrated = true;
      current = readStored();
    }
    return current;
  }

  const getServerSnapshot = (): TourSnapshot<Id> => IDLE;

  function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  function set(next: TourSnapshot<Id>) {
    hydrated = true;
    current = next;
    persist(next);
    for (const listener of listeners) listener();
  }

  return {
    // A no-op while a tour is already running, so a double click or a doubled
    // effect cannot restart one mid-way.
    start(options = {}) {
      if (getSnapshot().status === "active") return;
      set({ status: "active", stepId: stepIds[0], arrived: false, next: options.next ?? null });
    },
    // Pass `arrived` when the step's page is the one already showing.
    goTo(stepId, options = {}) {
      const snapshot = getSnapshot();
      if (snapshot.status !== "active") return;
      set({ ...snapshot, stepId, arrived: options.arrived ?? false });
    },
    markArrived(stepId) {
      const snapshot = getSnapshot();
      if (snapshot.status !== "active" || snapshot.stepId !== stepId || snapshot.arrived) return;
      set({ ...snapshot, arrived: true });
    },
    // Keep the last step's offer current (a seller save can change it mid-tour).
    setNext(next) {
      const snapshot = getSnapshot();
      if (snapshot.status !== "active") return;
      if (snapshot.next?.href === next?.href && snapshot.next?.label === next?.label) return;
      set({ ...snapshot, next });
    },
    end() {
      if (getSnapshot().status === "idle") return;
      set(IDLE);
    },
    getSnapshot,
    useTour() {
      return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
    },
    reset() {
      current = IDLE;
      hydrated = false;
      storageBroken = false;
      listeners.clear();
    },
  };
}

/** The dashboard tour (DashboardShell's overlay, Settings' replay card). */
export const dashboardTour = createTourStore<TourStepId>({
  storageKey: "sq.dashboard.tour",
  stepIds: TOUR_STEP_IDS,
  isStepId: isTourStepId,
});

/** The storefront designer's tour (the sample storefront). */
export const editorTour = createTourStore<EditorTourStepId>({
  storageKey: "sq.editor.tour",
  stepIds: EDITOR_TOUR_STEP_IDS,
  isStepId: isEditorTourStepId,
});

// The dashboard tour's original module-level API, kept so its callers (the
// welcome flow, the Settings replay card, the Orders page) read unchanged.

/** Begin at the first step. A no-op while a tour is already running. */
export function startTour(options: { next?: TourNext | null } = {}): void {
  dashboardTour.start(options);
}

/** Move to a step. Pass `arrived` when its page is the one already showing. */
export function goToStep(stepId: TourStepId, options: { arrived?: boolean } = {}): void {
  dashboardTour.goTo(stepId, options);
}

export function markArrived(stepId: TourStepId): void {
  dashboardTour.markArrived(stepId);
}

/** Keep the last step's offer current (a seller save can change it mid-tour). */
export function setTourNext(next: TourNext | null): void {
  dashboardTour.setNext(next);
}

export function endTour(): void {
  dashboardTour.end();
}

export function useTour(): TourSnapshot {
  return dashboardTour.useTour();
}

/** Whether the tour is on a step that needs `reveal` shown (a page shows a
 *  control it would otherwise hide, only while the tour points at it). */
export function useTourReveal(reveal: TourReveal): boolean {
  const tour = useTour();
  return tour.status === "active" && tourStep(tour.stepId)?.reveal === reveal;
}

/** Tests only: forget everything, including a broken-storage verdict. */
export function __resetTourForTests(): void {
  dashboardTour.reset();
  editorTour.reset();
}
