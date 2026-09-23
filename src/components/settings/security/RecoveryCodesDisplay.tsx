"use client";

import * as React from "react";
import { Download, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/CopyButton";
import { helpTextClass } from "@/components/ui/control-styles";

/**
 * A freshly minted set of recovery codes, shown ONCE. The server keeps only
 * their hashes, so once this closes nobody (us included) can show them again.
 *
 * "Done" stays disabled until the person ticks that they saved them: a set of
 * codes nobody kept is worse than none, because the account then looks
 * recoverable when it is not.
 */
export function RecoveryCodesDisplay({
  codes,
  onDone,
  doneLabel = "Done",
}: {
  /** Null when the codes could not be created. */
  codes: string[] | null;
  onDone: () => void;
  doneLabel?: string;
}) {
  const [saved, setSaved] = React.useState(false);
  const checkboxId = React.useId();

  if (!codes) {
    return (
      <div className="flex flex-col gap-4">
        <p role="alert" className="font-inter text-sm text-destructive">
          Two-factor authentication is on, but we couldn&rsquo;t create your
          recovery codes. Generate a set from the Recovery codes card before you
          sign out.
        </p>
        <div className="flex justify-end">
          <Button type="button" onClick={onDone}>
            {doneLabel}
          </Button>
        </div>
      </div>
    );
  }

  const text = [
    "Square Share recovery codes",
    "Each code can be used once to sign in if you lose your authenticator app.",
    "",
    ...codes,
    "",
    `Generated ${new Date().toISOString().slice(0, 10)}`,
  ].join("\n");

  function download() {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "square-share-recovery-codes.txt";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-4" data-recovery-codes>
      <p className="flex items-start gap-2 border border-border bg-muted/40 p-3 font-inter text-sm text-foreground">
        <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
        <span>
          Save these somewhere safe, like a password manager. Each works once,
          they&rsquo;re the only way back in if you lose your phone, and you
          won&rsquo;t see them again.
        </span>
      </p>

      <ol
        aria-label="Recovery codes"
        className="grid grid-cols-1 gap-x-6 gap-y-1.5 border border-border bg-background p-4 font-mono text-sm tabular-nums text-foreground min-[380px]:grid-cols-2"
      >
        {codes.map((code) => (
          <li key={code} className="select-all">
            {code}
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap gap-2">
        <CopyButton value={codes.join("\n")} label="recovery codes" variant="labelled" />
        <Button type="button" variant="secondary" onClick={download}>
          <Download aria-hidden className="size-4" />
          Download
        </Button>
      </div>

      <label htmlFor={checkboxId} className="flex items-start gap-2.5">
        <input
          id={checkboxId}
          type="checkbox"
          checked={saved}
          onChange={(event) => setSaved(event.target.checked)}
          className="mt-0.5 size-4 shrink-0 accent-foreground"
        />
        <span className={helpTextClass}>I&rsquo;ve saved my recovery codes somewhere safe.</span>
      </label>

      <div className="flex justify-end">
        <Button type="button" onClick={onDone} disabled={!saved}>
          {doneLabel}
        </Button>
      </div>
    </div>
  );
}
