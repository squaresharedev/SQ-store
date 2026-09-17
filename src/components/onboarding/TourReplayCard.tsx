"use client";

import { SettingsCard } from "@/components/settings/SettingsCard";
import { Button } from "@/components/ui/button";
import { startTour } from "@/lib/onboarding/tour-store";

/**
 * Settings > Account's way back into the guided tour.
 *
 * The whole tour only: the welcome screen and the seller details form are not
 * replayed (those details are edited in Business & seller details). Starting it
 * here is all this does; the tour's overlay, present in every dashboard shell,
 * takes the seller to its first stop. Lives on Account because the tour is
 * about the person, like the welcome it follows, not about the store.
 */
export function TourReplayCard() {
  return (
    <SettingsCard
      title="Guided tour"
      description="A short walk through the main thing to do on each page, one step at a time."
    >
      <Button variant="secondary" onClick={() => startTour()}>
        Start the tour
      </Button>
    </SettingsCard>
  );
}
