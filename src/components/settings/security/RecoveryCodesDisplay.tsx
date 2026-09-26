"use client";

import * as React from "react";
import { Download, TriangleAlert } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/CopyButton";
import { helpTextClass } from "@/components/ui/control-styles";
import { DURATION, EASE_ENTRANCE } from "@/components/ui/motion-tokens";

/**
 * Each code arrives this long after the one before it, the first a beat after
 * the list mounts: a cascade, not a wait.
 */
const CODE_STAGGER = 0.035;

/**
 * A freshly minted set of recovery codes, shown ONCE. The server keeps only
 * their hashes, so once this closes nobody (us included) can show them again.
 *
 * "Done" stays disabled until the person ticks that they saved them: a set of
 * codes nobody kept is worse than none, because the account then looks
 * recoverable when it is not.
 *
 * The codes are data: shown and saved exactly as the server minted them.
 */
export function RecoveryCodesDisplay({
  codes,
  onDone,
  doneLabel,
}: {
  /** Null when the codes could not be created. */
  codes: string[] | null;
  onDone: () => void;
  /** Defaults to "Done". */
  doneLabel?: string;
}) {
  const t = useTranslations("Settings.security.recoveryCodesDisplay");
  const tCommon = useTranslations("Common.actions");
  const [saved, setSaved] = React.useState(false);
  const still = Boolean(useReducedMotion());
  const checkboxId = React.useId();
  const done = doneLabel ?? tCommon("done");

  if (!codes) {
    return (
      <div className="flex flex-col gap-4">
        <p role="alert" className="font-inter text-sm text-destructive">
          {t("notCreated")}
        </p>
        <div className="flex justify-end">
          <Button type="button" onClick={onDone}>
            {done}
          </Button>
        </div>
      </div>
    );
  }

  const text = [
    t("file.title"),
    t("file.explainer"),
    "",
    ...codes,
    "",
    t("file.generated", { date: new Date().toISOString().slice(0, 10) }),
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
        <span>{t("warning")}</span>
      </p>

      <ol
        aria-label={t("listLabel")}
        className="grid grid-cols-1 gap-x-6 gap-y-1.5 border border-border bg-background p-4 font-mono text-sm tabular-nums text-foreground min-[380px]:grid-cols-2"
      >
        {codes.map((code, index) => (
          <motion.li
            key={code}
            className="select-all"
            initial={still ? false : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: DURATION.slow,
              delay: DURATION.fast + index * CODE_STAGGER,
              ease: EASE_ENTRANCE,
            }}
          >
            {code}
          </motion.li>
        ))}
      </ol>

      <div className="flex flex-wrap gap-2">
        <CopyButton
          value={codes.join("\n")}
          messages={{
            copy: "Settings.security.copyRecoveryCodes.copy",
            copied: "Settings.security.copyRecoveryCodes.copied",
            failed: "Settings.security.copyRecoveryCodes.failed",
          }}
          variant="labelled"
        />
        <Button type="button" variant="secondary" onClick={download}>
          <Download aria-hidden className="size-4" />
          {t("download")}
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
        <span className={helpTextClass}>{t("saved")}</span>
      </label>

      <div className="flex justify-end">
        <Button type="button" onClick={onDone} disabled={!saved}>
          {done}
        </Button>
      </div>
    </div>
  );
}
