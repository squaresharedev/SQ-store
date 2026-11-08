"use client";

import Link from "@/components/ui/AppLink";
import { useEffect, useMemo, useRef, useState } from "react";
import { InvoicesCard } from "@/components/billing/invoices/InvoicesCard";
import { cn } from "@/lib/utils";
import { standInBillingActions } from "../pricing/fixtures";
import { DevOptionGroup, GallerySection } from "../pricing/DevControls";
import { invoicesScenarios } from "./fixtures";

const WIDTHS = [
  { value: "full", label: "Settings width" },
  { value: "phone", label: "Phone (390px)" },
] as const;

/** How long the stand-in "asking Stripe" lasts after Try again. */
const RETRY_MS = 900;

export function InvoicesGallery({ nowIso }: { nowIso: string }) {
  const now = useMemo(() => new Date(nowIso), [nowIso]);
  const scenarios = useMemo(() => invoicesScenarios(now), [now]);
  const [scenarioKey, setScenarioKey] = useState(scenarios[0]!.value);
  const [width, setWidth] = useState<(typeof WIDTHS)[number]["value"]>("full");
  const [lastOpened, setLastOpened] = useState<string | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (retryTimer.current && clearTimeout(retryTimer.current)), []);

  const scenario = scenarios.find((candidate) => candidate.value === scenarioKey)!;
  // Stand-ins: every link and portal call says where a real one would go.
  const actions = useMemo(() => standInBillingActions(setLastOpened), []);

  // "Try again" on the failed state: asking, then the answer a working Stripe gives.
  function retry() {
    setLastOpened("retry");
    setScenarioKey("loading");
    retryTimer.current = setTimeout(() => setScenarioKey("active"), RETRY_MS);
  }

  return (
    <>
      <div className="mx-auto max-w-6xl space-y-4 px-6 pt-10">
        <header>
          <h1 className="text-2xl font-semibold text-foreground">Billing &amp; invoices</h1>
          <p className="mt-1 font-inter text-sm text-muted-foreground">
            The Settings card in every store state, on fake Stripe data. Rows open the invoice, the arrow downloads its PDF, Update says where Stripe would open, and nothing leaves the page. Every version tried is at /dev/invoices-lab. The rest of the page is at{" "}
            <Link href="/dev/pricing" className="underline underline-offset-4">
              /dev/pricing
            </Link>
            .
          </p>
        </header>
        <DevOptionGroup label="Store state" options={scenarios} value={scenarioKey} onChange={setScenarioKey} />
        <DevOptionGroup label="Width" options={WIDTHS} value={width} onChange={setWidth} />
        {lastOpened && (
          <p className="font-inter text-xs text-muted-foreground" data-dev-navigation>
            Would open: {lastOpened}
          </p>
        )}
      </div>

      <GallerySection title="Settings › Billing & invoices">
        {/* Keyed on the scenario so the filter, the page of rows and any open dialog start fresh. */}
        <div key={scenarioKey} className={cn("max-w-3xl", width === "phone" && "w-[390px] max-w-full")}>
          <InvoicesCard
            context={scenario.context}
            data={scenario.data}
            actions={actions}
            openLink={setLastOpened}
            onRetry={retry}
            now={now}
          />
        </div>
      </GallerySection>
    </>
  );
}
