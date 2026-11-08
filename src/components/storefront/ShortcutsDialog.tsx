"use client";

import { useEffect, type ReactNode } from "react";
import { Keyboard } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { HeroMark } from "@/components/ui/HeroMark";
import { Modal, ModalActions } from "@/components/ui/modal";
import {
  helpTextClass,
  infoTextClass,
  kbdClass,
} from "@/components/ui/control-styles";
import { useIsMacPlatform } from "@/lib/hooks/useIsMacPlatform";

/** The rows, in the order a seller reaches for them: each a label and its keys
 *  under Storefront.shortcuts.rows. Undo, redo and zoom are left out because
 *  their own buttons already name their keys. */
const SHORTCUT_ROWS = [
  "save",
  "copyPaste",
  "remove",
  "move",
  "selectMore",
  "selectUnder",
  "layer",
  "pan",
] as const;

/** A press that is someone typing, where "?" is a character, not a request.
 *  The same guard the designer's own shortcuts use, open Select included. */
function isTyping(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return false;
  return (
    element.tagName === "INPUT" ||
    element.tagName === "TEXTAREA" ||
    element.tagName === "SELECT" ||
    element.isContentEditable ||
    element.closest('[role="combobox"][aria-expanded="true"]') !== null
  );
}

/**
 * The designer's keyboard shortcuts on one screen. "?" opens it from anywhere
 * outside a field, and so does the toolbar's keyboard button. A reference
 * only: it lists the shortcuts the designer already has and adds none.
 */
export function ShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("Storefront.shortcuts");
  const tActions = useTranslations("Common.actions");
  const isMac = useIsMacPlatform();
  const mod = isMac ? "⌘" : "Ctrl";
  const alt = isMac ? "Option" : "Alt";

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "?" || event.ctrlKey || event.metaKey || event.altKey) return;
      if (isTyping(event.target)) return;
      event.preventDefault();
      onOpenChange(true);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onOpenChange]);

  const kbd = (chunks: ReactNode) => <kbd className={kbdClass}>{chunks}</kbd>;

  return (
    <Modal
      open={open}
      onClose={() => onOpenChange(false)}
      title={t("title")}
      visual={<HeroMark icon={Keyboard} />}
    >
      <dl className="space-y-2">
        {SHORTCUT_ROWS.map((row) => (
          <div key={row} className="flex items-center justify-between gap-4">
            <dt className={cn(helpTextClass, "min-w-0")}>{t(`rows.${row}.label`)}</dt>
            <dd className={cn(infoTextClass, "flex flex-wrap items-center justify-end gap-1")}>
              {t.rich(`rows.${row}.keys`, { mod, alt, kbd })}
            </dd>
          </div>
        ))}
      </dl>
      <ModalActions className="mt-6">
        <Button onClick={() => onOpenChange(false)}>{tActions("done")}</Button>
      </ModalActions>
    </Modal>
  );
}
