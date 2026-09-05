"use client";

import { useActionState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { infoTextClass } from "@/components/ui/control-styles";
import { useActionToast } from "@/components/ui/Toast";
import { SaveButton } from "@/components/ui/SaveButton";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { acceptLegal, type SettingsActionState } from "@/lib/settings/actions";
import { LEGAL_VERSION } from "@/lib/settings/constants";

const INITIAL: SettingsActionState = {};

// Placeholder drafts. REAL LEGAL COPY IS PENDING legal review. Swap the
// bodies (and bump LEGAL_VERSION) when it lands.
const DOCS = [
  {
    title: "Seller Agreement",
    body: "You own your work, always. We take a small cut per sale, handle payments through Stripe, and keep the servers humming along. You keep it legal and ship what you actually sell. This is a draft placeholder; the real agreement is on its way.",
  },
  {
    title: "Terms of Service",
    body: "Don't abuse the platform, don't sell things that hurt people, and play nice with other creators' stores. This is a draft placeholder; the real terms are on their way.",
  },
  {
    title: "Privacy Policy",
    body: "We store what you give us (profile, products, storefront), never sell it, and delete it when you leave. Payments run through Stripe, so your card details stay with them, not us. This is a draft placeholder; the real policy is on its way.",
  },
] as const;

function formatDate(iso: string) {
  // Fixed locale so server and client render identically.
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function LegalSection({
  acceptedAt,
  acceptedVersion,
}: {
  acceptedAt: string | null;
  acceptedVersion: string | null;
}) {
  const [state, formAction, isPending] = useActionState(acceptLegal, INITIAL);
  useActionToast(state);
  const isCurrent = acceptedAt !== null && acceptedVersion === LEGAL_VERSION;
  const isOutdated = acceptedAt !== null && !isCurrent;

  return (
    <SettingsCard
      title="Seller Agreement, Terms & Privacy"
      description="The current drafts, in plain language, because nobody reads legalese for fun. Real legal copy is on its way; accepting now covers this draft version."
    >
      <div className="flex flex-col gap-4">
        {/* NOTE ON LEGAL EFFECT: acceptance is recorded (version + timestamp)
            but not yet checked anywhere in the app. Under GDPR and consumer
            law a gating flow you never enforce is worse than none, because it
            creates a record of consent without any real checkpoint behind it.
            Do not add gating logic here until the real legal copy lands and the
            product decides what accepting actually unlocks. */}
        <div className="flex flex-col divide-y divide-border border border-border">
          {DOCS.map((doc) => (
            <details key={doc.title} className="group/doc">
              {/* The chevron rotates open/closed via group-open/doc, giving the
                  <details> a visible and recognisable disclosure affordance.
                  list-none removes the browser's own triangle so we can control
                  its placement and style. */}
              <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-medium text-foreground transition-colors duration-base ease-standard hover:bg-accent group-open/doc:bg-accent motion-reduce:transition-none">
                {doc.title}
                <ChevronDown
                  aria-hidden
                  className="size-4 shrink-0 text-muted-foreground transition-transform duration-base ease-standard group-open/doc:rotate-180 motion-reduce:transition-none"
                />
              </summary>
              <p className="px-4 pb-4 font-inter text-sm leading-relaxed text-muted-foreground">
                {doc.body}
              </p>
            </details>
          ))}
        </div>

        {isCurrent ? (
          <p className="flex items-start gap-2 border border-border bg-accent px-4 py-3 text-sm text-foreground">
            <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
            <span>
              You accepted version{" "}
              <span className="font-mono text-xs">{acceptedVersion}</span> on{" "}
              {formatDate(acceptedAt)}. Nothing more to do here.
            </span>
          </p>
        ) : (
          <form action={formAction} className="flex flex-col gap-4">
            {isOutdated && (
              <p className="border border-border bg-accent px-4 py-3 font-inter text-sm text-muted-foreground">
                You accepted version{" "}
                <span className="font-mono text-xs">{acceptedVersion}</span> on{" "}
                {formatDate(acceptedAt)}, but the docs have changed since. Give
                them another read and accept the current version.
              </p>
            )}
            <input type="hidden" name="version" value={LEGAL_VERSION} />
            <div className="flex flex-col gap-2">
              <SaveButton pending={isPending} state={state} pendingLabel="Recording…">
                I accept
              </SaveButton>
              <p className={infoTextClass}>
                Accepting records the date and version{" "}
                <span className="font-mono">{LEGAL_VERSION}</span> to your
                account.
              </p>
            </div>
          </form>
        )}
      </div>
    </SettingsCard>
  );
}
