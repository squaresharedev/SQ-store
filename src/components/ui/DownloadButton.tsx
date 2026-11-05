"use client";

import * as React from "react";
import { Download } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/components/ui/Toast";
import { attachmentFileName, saveFile } from "@/lib/utils/save-file";

/**
 * "Export CSV": fetches a file from one of the app's export routes and saves
 * it in place (lib/utils/save-file.ts), so an error (a rate limit, a failed
 * read) is a toast on this page rather than a browser tab of JSON. The routes
 * answer a refusal as `{ error, fix }` JSON, shown here as written.
 *
 * A route that had more than its file holds says so in a response header
 * carrying the count the file does hold; `truncated` names that header and
 * turns the count into the note shown once the file is saved.
 */
export function DownloadButton({
  href,
  fallbackFileName,
  truncated,
  disabled,
  ...props
}: {
  /** The export route, with whatever query narrows the file. */
  href: string;
  /** The name to save under when the response does not name the file. */
  fallbackFileName: string;
  truncated?: { header: string; message: (count: number) => string };
} & Omit<ButtonProps, "onClick" | "children" | "variant" | "pending">) {
  const t = useTranslations("Common.export");
  const toast = useToast();
  const [busy, setBusy] = React.useState(false);

  async function download() {
    setBusy(true);
    try {
      const response = await fetch(href, { cache: "no-store" });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string; fix?: string } | null;
        toast.error(body?.error ?? t("failed"), { lines: body?.fix ? [body.fix] : undefined });
        return;
      }
      saveFile(await response.blob(), attachmentFileName(response) ?? fallbackFileName);
      const count = truncated ? response.headers.get(truncated.header) : null;
      // Pinned: a file that looks whole but is not must not be missed, and the
      // eye is on the browser's download prompt as this appears.
      if (truncated && count) toast.info(truncated.message(Number(count)), { duration: Number.POSITIVE_INFINITY });
    } catch {
      toast.error(t("failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button variant="secondary" disabled={disabled || busy} onClick={download} {...props}>
      {busy ? <Spinner /> : <Download className="size-4" strokeWidth={2} aria-hidden />}
      {busy ? t("preparing") : t("button")}
    </Button>
  );
}
