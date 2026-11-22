"use client";

import { useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { focusRingClass, labelClass, transitionClass } from "@/components/ui/control-styles";
import { cn } from "@/lib/utils";

/**
 * "MORE": the fold a panel keeps its finer controls behind, so what is in view
 * when it opens is only what most sellers need (the simplicity rules' budget
 * counts what is visible, and this is how a control stops being visible).
 *
 * `defaultOpen` starts it open (a block that already carries an override
 * shows it), and `openKey` opens it from outside: a new non-null value is a
 * request (the selection toolbar pointing at a slider folded in here), and it
 * stays open afterwards, because the request is an instruction, not a mode.
 *
 * Its contents stay MOUNTED while it is shut (hidden, so out of reach and out
 * of the accessibility tree): a summoned field inside opens it and flashes in
 * the same render, which a field mounting fresh could not tell apart from one
 * that was always there.
 */
export function MoreDisclosure({
  children,
  defaultOpen = false,
  openKey = null,
  label,
}: {
  children: ReactNode;
  defaultOpen?: boolean;
  openKey?: number | null;
  /** The fold's words. Absent = "More". */
  label?: string;
}) {
  const t = useTranslations("Storefront.toolbar");
  const contentId = `${useId()}-more`;
  const [open, setOpen] = useState(defaultOpen);
  // Seeded null, not from `openKey`: a fold that mounts already asked for
  // (its panel opened BECAUSE of the request) must still open.
  const [seenKey, setSeenKey] = useState<number | null>(null);
  if (openKey !== seenKey) {
    setSeenKey(openKey);
    if (openKey !== null) setOpen(true);
  }
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-controls={contentId}
        className={cn(
          labelClass,
          "flex w-full items-center justify-between gap-2 py-1 text-left",
          transitionClass,
          focusRingClass,
        )}
      >
        {label ?? t("more")}
        <ChevronDown
          className={cn(
            "size-4 text-muted-foreground transition-transform duration-base ease-standard motion-reduce:transition-none",
            open && "rotate-180",
          )}
          strokeWidth={2}
          aria-hidden="true"
        />
      </button>
      <div id={contentId} hidden={!open} className="space-y-3 pt-2">
        {children}
      </div>
    </div>
  );
}
