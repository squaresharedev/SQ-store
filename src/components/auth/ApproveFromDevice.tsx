"use client";

import * as React from "react";
import Link from "next/link";
import { QrCode, RefreshCw } from "lucide-react";
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
import { cn } from "@/lib/utils";

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
 *
 * Kept to one line of words: the viewfinder corners say "scan this", the
 * phone's own page says who is asking and what to tap, and a phone that is
 * not signed in is told so there.
 */
export function ApproveFromDevice({
  next,
  onVerified,
}: {
  next: string;
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

  const failed = phase.kind === "denied" || phase.kind === "lapsed" || phase.kind === "failed";

  return (
    <div className="flex flex-col gap-5" data-approval-challenge={phase.kind}>
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">{ta("heading")}</h1>
        <p className={`${helpTextClass} mt-1`}>{ta("hint")}</p>
      </div>

      <div className="flex flex-col items-center gap-4">
        <ScanFrame>
          {phase.kind === "waiting" ? (
            <QrTile src={phase.request.qrCode} alt={ta("qrAlt")} className="size-48 border-0" />
          ) : (
            <span className="grid size-48 place-items-center bg-muted/40 text-muted-foreground">
              {phase.kind === "loading" ? <Spinner /> : <QrCode aria-hidden className="size-10 opacity-40" />}
            </span>
          )}
        </ScanFrame>

        {phase.kind === "loading" && (
          <p role="status" className={infoTextClass}>
            {ta("loading")}
          </p>
        )}

        {phase.kind === "waiting" && (
          <div className="flex flex-col items-center gap-1">
            <p
              role="status"
              className="inline-flex items-center gap-2 font-inter text-sm font-medium text-foreground"
              data-approval-url={phase.request.url}
            >
              <span aria-hidden className="size-2 animate-pulse rounded-full bg-foreground motion-reduce:animate-none" />
              {ta("waiting")}
            </p>
            {/* For a phone that cannot scan it, or is signed in somewhere the
                camera does not open (an installed app). */}
            <CopyButton
              variant="quiet"
              value={phase.request.url}
              messages={{
                copy: "Auth.twoFactor.approval.copyLink.copy",
                copied: "Auth.twoFactor.approval.copyLink.copied",
                failed: "Auth.twoFactor.approval.copyLink.failed",
              }}
            />
          </div>
        )}

        {failed && (
          <div className="flex flex-col items-center gap-3 text-center">
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
    </div>
  );
}

/** Where each viewfinder corner sits, and which two edges it draws. */
const CORNERS = [
  "left-0 top-0 border-l-2 border-t-2",
  "right-0 top-0 border-r-2 border-t-2",
  "bottom-0 left-0 border-b-2 border-l-2",
  "bottom-0 right-0 border-b-2 border-r-2",
] as const;

/** Viewfinder corners round the code: "point a camera here", without words. */
function ScanFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative p-3">
      {CORNERS.map((corner) => (
        <span key={corner} aria-hidden className={cn("absolute size-5 border-foreground", corner)} />
      ))}
      {children}
    </div>
  );
}
