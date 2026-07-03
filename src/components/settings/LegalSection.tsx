"use client";

import { useActionState } from "react";
import { Check } from "lucide-react";
import { FormStatus } from "@/components/settings/FormStatus";
import { SaveButton } from "@/components/settings/SaveButton";
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
  const isCurrent = acceptedAt !== null && acceptedVersion === LEGAL_VERSION;
  const isOutdated = acceptedAt !== null && !isCurrent;

  return (
    <SettingsCard
      title="Seller Agreement, Terms & Privacy"
      description="The current drafts, in plain language, because nobody reads legalese for fun. Real legal copy is on its way; accepting now covers this draft version."
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col divide-y divide-neutral-200 border border-neutral-200">
          {DOCS.map((doc) => (
            <details key={doc.title} className="group">
              <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-neutral-900 transition-colors hover:bg-neutral-50 group-open:bg-neutral-50">
                {doc.title}
              </summary>
              <p className="px-4 pb-4 font-inter text-sm leading-relaxed text-neutral-500">
                {doc.body}
              </p>
            </details>
          ))}
        </div>

        {isCurrent ? (
          <p className="flex items-start gap-2 border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-700">
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
              <p className="border border-neutral-200 bg-neutral-50 px-4 py-3 font-inter text-sm text-neutral-600">
                You accepted version{" "}
                <span className="font-mono text-xs">{acceptedVersion}</span> on{" "}
                {formatDate(acceptedAt)}, but the docs have changed since. Give
                them another read and accept the current version.
              </p>
            )}
            <input type="hidden" name="version" value={LEGAL_VERSION} />
            <FormStatus state={state} />
            <div className="flex flex-col gap-2">
              <SaveButton pending={isPending} state={state} pendingLabel="Recording…">
                I accept
              </SaveButton>
              <p className="font-inter text-xs text-neutral-400">
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
