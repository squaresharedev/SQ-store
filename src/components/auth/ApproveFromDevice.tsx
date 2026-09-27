"use client";

import * as React from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/CopyButton";
import { Spinner } from "@/components/ui/spinner";
import { useResolveMessage } from "@/components/ui/ActionErrorNotice";
import { helpTextClass, infoTextClass } from "@/components/ui/control-styles";
import { QrTile } from "@/components/auth/QrTile";
import {
  cancelSignInApproval,
  checkSignInApproval,
  startSignInApproval,
  type ApprovalPoll,
  type StartApprovalResult,
} from "@/lib/auth/sign-in-approval-actions";
import type { ActionError } from "@/lib/errors";

/** How often the page asks whether the phone has answered. */
const POLL_MS = 2000;
/** The same while the tab is in the background (the browser throttles it anyway). */
const POLL_HIDDEN_MS = 6000;

type ShownRequest = NonNullable<StartApprovalResult["request"]>;

type Phase =
  | { kind: "loading" }
  | { kind: "waiting"; request: ShownRequest }
  | { kind: "denied" }
  | { kind: "lapsed" }
  | { kind: "failed"; error: ActionError | null; signedOut?: boolean };

const THE_STEPS = ["camera", "open", "approve"] as const;

/**
 * "Approve from your phone": a QR code that opens Square Share on a phone
 * where the person is already signed in, and a quiet wait until they tap
 * Approve there (lib/auth/sign-in-approval.ts has the design).
 *
 * The page asks the server every couple of seconds. The answer that lets the
 * person through is also the request that completes the sign-in: its cookies
 * make this session aal2, and `onVerified` hands over to the moment of success.
 * Leaving (another method, a new code) withdraws the request, so a QR code
 * still on screen elsewhere stops working.
 */
export function ApproveFromDevice({
  next,
  email,
  onVerified,
}: {
  next: string;
  email: string;
  onVerified: (next: string) => void;
}) {
  const t = useTranslations("Auth.twoFactor");
  const ta = useTranslations("Auth.twoFactor.approval");
  const resolve = useResolveMessage();
  const [phase, setPhase] = React.useState<Phase>({ kind: "loading" });
  // Bumped by "Show a new code": each value is one request.
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    let live = true;
    // A request that failed outright (offline, a deploy mid-visit) is a
    // failure to show, with a button to try again, not a spinner forever.
    void startSignInApproval()
      .catch(() => null)
      .then((result) => {
        if (!live) return;
        setPhase(
          result?.request
            ? { kind: "waiting", request: result.request }
            : { kind: "failed", error: result?.error ?? null },
        );
      });
    return () => {
      live = false;
    };
  }, [attempt]);

  const requestId = phase.kind === "waiting" ? phase.request.id : null;

  React.useEffect(() => {
    if (!requestId) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ask = async () => {
      const answer: ApprovalPoll = await checkSignInApproval(requestId, next).catch(() => ({
        waiting: true,
      }));
      if (!live) return;
      if (answer.verified) {
        onVerified(answer.verified.next);
        return;
      }
      if (answer.expired) {
        setPhase({ kind: "failed", error: answer.error ?? null, signedOut: true });
        return;
      }
      if (answer.denied) {
        setPhase({ kind: "denied" });
        return;
      }
      if (answer.lapsed) {
        setPhase(answer.error ? { kind: "failed", error: answer.error } : { kind: "lapsed" });
        return;
      }
      timer = setTimeout(ask, document.hidden ? POLL_HIDDEN_MS : POLL_MS);
    };
    timer = setTimeout(ask, POLL_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [requestId, next, onVerified]);

  // Withdraw a request this page is no longer showing. Harmless after it was
  // answered: only a request still waiting can be withdrawn.
  React.useEffect(() => {
    if (!requestId) return;
    return () => {
      void cancelSignInApproval(requestId).catch(() => undefined);
    };
  }, [requestId]);

  function newCode() {
    setPhase({ kind: "loading" });
    setAttempt((count) => count + 1);
  }

  const strong = (chunks: React.ReactNode) => (
    <span className="font-medium text-foreground">{chunks}</span>
  );

  return (
    <div className="flex flex-col gap-5" data-approval-challenge={phase.kind}>
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">{t("heading")}</h1>
        <p className={`${helpTextClass} mt-1`}>
          {email ? ta.rich("introAs", { email, strong }) : ta("intro")}
        </p>
      </div>

      {phase.kind === "loading" && (
        <div className="flex items-center gap-3" role="status">
          <span className="grid size-44 shrink-0 place-items-center border border-border bg-muted/40">
            <Spinner />
          </span>
          <span className={infoTextClass}>{ta("loading")}</span>
        </div>
      )}

      {phase.kind === "waiting" && (
        <>
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
            <QrTile src={phase.request.qrCode} alt={ta("qrAlt")} />
            <ol className="flex min-w-0 list-decimal flex-col gap-2 pl-5">
              {THE_STEPS.map((step) => (
                <li key={step} className={helpTextClass}>
                  {ta(`steps.${step}`)}
                </li>
              ))}
            </ol>
          </div>
          <p
            role="status"
            className="inline-flex items-center gap-2 font-inter text-sm font-medium text-foreground"
            data-approval-url={phase.request.url}
          >
            <span aria-hidden className="size-2 animate-pulse rounded-full bg-foreground motion-reduce:animate-none" />
            {ta("waiting")}
          </p>
          <div className="flex flex-col gap-2">
            <p className={infoTextClass}>{ta("signedInThere")}</p>
            <div className="flex items-center gap-2">
              <span className={infoTextClass}>{ta("cantScan")}</span>
              <CopyButton
                value={phase.request.url}
                messages={{
                  copy: "Auth.twoFactor.approval.copyLink.copy",
                  copied: "Auth.twoFactor.approval.copyLink.copied",
                  failed: "Auth.twoFactor.approval.copyLink.failed",
                }}
              />
            </div>
          </div>
        </>
      )}

      {phase.kind !== "loading" && phase.kind !== "waiting" && (
        <div className="flex flex-col items-start gap-3">
          <p role="alert" className="text-sm font-medium text-destructive">
            {phase.kind === "denied"
              ? ta("denied")
              : phase.kind === "lapsed"
                ? ta("lapsed")
                : phase.error
                  ? resolve(phase.error.message)
                  : ta("failed")}
          </p>
          {phase.kind === "failed" && phase.signedOut ? (
            <Link
              href={`/login?next=${encodeURIComponent(next)}`}
              className="font-inter text-sm font-medium text-foreground underline underline-offset-4"
            >
              {t("signInAgain")}
            </Link>
          ) : (
            <Button type="button" variant="secondary" onClick={newCode}>
              <RefreshCw aria-hidden className="size-4" />
              {ta("newCode")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
