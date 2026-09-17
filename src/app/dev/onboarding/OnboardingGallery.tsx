"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { SellerDetailsBanner } from "@/components/settings/SellerDetailsNotice";
import { SetupChecklist } from "@/components/onboarding/SetupChecklist";
import { WelcomeFlow } from "@/components/onboarding/WelcomeFlow";
import type { SetupChecklistData } from "@/lib/onboarding/steps";
import type { SettingsActionState } from "@/lib/settings/actions";

type Scenario = {
  key: string;
  label: string;
  includeSellerStep: boolean;
  verificationOn: boolean;
};

const SCENARIOS: Scenario[] = [
  { key: "new", label: "New seller", includeSellerStep: true, verificationOn: false },
  {
    key: "verify",
    label: "New seller, confirmation email on",
    includeSellerStep: true,
    verificationOn: true,
  },
  {
    key: "details-on-file",
    label: "Details already on file",
    includeSellerStep: false,
    verificationOn: false,
  },
];

/** Stand-ins for saveTaxInfo and resendSellerEmailVerification: a short wait so
 *  the pending state is visible, then the real success copy. Nothing is saved. */
async function fakeSave(): Promise<SettingsActionState> {
  await new Promise((resolve) => setTimeout(resolve, 600));
  return { success: "Business & seller details saved." };
}

async function fakeResend(): Promise<SettingsActionState> {
  await new Promise((resolve) => setTimeout(resolve, 600));
  return { success: "Sent. Check your inbox for the link." };
}

export function OnboardingGallery({
  checklists,
}: {
  checklists: { name: string; setup: SetupChecklistData; celebrate: boolean }[];
}) {
  const [active, setActive] = useState<Scenario | null>(null);
  // The last way out of the dialog, published for scripts driving this page.
  const [exit, setExit] = useState<"none" | "skipped" | "tour">("none");
  const skip = useCallback(() => {
    console.info("[dev/onboarding] skipped onboarding");
    setExit("skipped");
    setActive(null);
  }, []);
  const startTour = useCallback(() => {
    console.info("[dev/onboarding] would start the guided tour");
    setExit("tour");
    setActive(null);
  }, []);
  const celebrated = useCallback(() => {
    console.info("[dev/onboarding] would record the finished card as shown");
  }, []);

  return (
    <main className="mx-auto max-w-5xl space-y-10 px-6 py-10" data-welcome-exit={exit}>
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-foreground">Onboarding</h1>
        <p className="font-inter text-sm text-muted-foreground">
          The welcome flow, the setup checklist in every state, and the seller
          details banner. Saves are faked; nothing is written. The guided tour the
          flow hands over to has its own page:{" "}
          <Link href="/dev/tour" className="underline underline-offset-4">
            /dev/tour
          </Link>
          .
        </p>
      </header>

      <section className="space-y-3" aria-labelledby="welcome-flow-heading">
        <h2 id="welcome-flow-heading" className="text-lg font-semibold text-foreground">
          Welcome flow
        </h2>
        <div className="flex flex-wrap gap-2">
          {SCENARIOS.map((scenario) => (
            <Button
              key={scenario.key}
              variant="secondary"
              data-scenario={scenario.key}
              onClick={() => setActive(scenario)}
            >
              {scenario.label}
            </Button>
          ))}
        </div>
      </section>

      <section className="space-y-3" aria-labelledby="checklist-heading">
        <h2 id="checklist-heading" className="text-lg font-semibold text-foreground">
          Setup checklist
        </h2>
        <p className="font-inter text-sm text-muted-foreground">
          Collapsing is remembered per device under one key, so every card below
          shares it. The finished card shows once per person, recorded on the
          profile; here that write is only logged.
        </p>
        <div className="grid gap-6 md:grid-cols-2">
          {checklists.map((fixture) => (
            <div key={fixture.name} className="space-y-2" data-fixture={fixture.name}>
              <p className="font-inter text-xs text-muted-foreground">{fixture.name}</p>
              <SetupChecklist
                setup={fixture.setup}
                livePageUrl={fixture.setup.livePage?.path ?? null}
                celebrate={fixture.celebrate}
                onCelebrated={celebrated}
              />
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3" aria-labelledby="banner-heading">
        <h2 id="banner-heading" className="text-lg font-semibold text-foreground">
          Seller details banner
        </h2>
        <div className="space-y-3">
          <p className="font-inter text-xs text-muted-foreground">Owner, nothing typed yet</p>
          <SellerDetailsBanner missing={["businessName", "address", "email"]} />
          <p className="font-inter text-xs text-muted-foreground">Owner, email unconfirmed</p>
          <SellerDetailsBanner missing={["emailVerified"]} />
          <p className="font-inter text-xs text-muted-foreground">
            Team member on someone else&apos;s store
          </p>
          <SellerDetailsBanner missing={["businessName"]} audience="member" />
        </div>
      </section>

      <WelcomeFlow
        open={active !== null}
        onClose={skip}
        onStartTour={startTour}
        includeSellerStep={active?.includeSellerStep ?? false}
        seller={{ businessName: "", address: "", email: "" }}
        emailVerified={false}
        verificationOn={active?.verificationOn ?? false}
        saveAction={fakeSave}
        resendAction={fakeResend}
      />
    </main>
  );
}
