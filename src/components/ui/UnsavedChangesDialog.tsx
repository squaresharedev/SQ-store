"use client";

import { FilePenLine, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HeroMark } from "@/components/ui/HeroMark";
import { Modal, ModalActions } from "@/components/ui/modal";

/**
 * "You have unsaved changes": the one dialog a leave guard shows, wherever the
 * guard is (the product form, the storefront designer), so leaving work behind
 * always looks and weighs the same.
 *
 * Three ways on, weighted so the safe one leads. Save is the primary. Discard
 * is quiet and only turns red under the pointer: it is a choice, not the
 * thing to press. Staying is the quiet button at the far end, and also the X
 * and Escape. The two that leave carry a glyph each, so they can be told from
 * staying without reading. The words are the caller's, since each place asks
 * in its own.
 */
export function UnsavedChangesDialog({
  open,
  title,
  description,
  saveLabel,
  savingLabel,
  discardLabel,
  stayLabel,
  saving = false,
  onSave,
  onDiscard,
  onStay,
}: {
  open: boolean;
  title: string;
  description: string;
  saveLabel: string;
  /** Save's words while it runs. */
  savingLabel: string;
  discardLabel: string;
  /** The way back to the work ("Cancel", "Keep editing"). */
  stayLabel: string;
  saving?: boolean;
  onSave: () => void;
  onDiscard: () => void;
  onStay: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onStay}
      visual={<HeroMark icon={FilePenLine} />}
      title={title}
      description={description}
      // Three labelled buttons side by side need the room.
      size="lg"
    >
      {/* A label never breaks onto a second line: in a language where the
          three do not fit one row, the ROW wraps instead. */}
      <ModalActions className="sm:flex-wrap">
        {/* Pushed to the far end from the two ways of leaving, so it is not
            taken for one of them. */}
        <Button
          variant="ghost"
          onClick={onStay}
          disabled={saving}
          className="whitespace-nowrap sm:mr-auto"
        >
          {stayLabel}
        </Button>
        <Button
          variant="ghost-danger"
          onClick={onDiscard}
          disabled={saving}
          className="whitespace-nowrap"
        >
          <Trash2 className="size-4" strokeWidth={2} aria-hidden="true" />
          {discardLabel}
        </Button>
        <Button onClick={onSave} disabled={saving} className="whitespace-nowrap">
          {saving ? (
            savingLabel
          ) : (
            <>
              <Save className="size-4" strokeWidth={2} aria-hidden="true" />
              {saveLabel}
            </>
          )}
        </Button>
      </ModalActions>
    </Modal>
  );
}
