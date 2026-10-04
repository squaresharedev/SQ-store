"use client";

import { useState } from "react";
import {
  ArrowRightLeft,
  CalendarClock,
  CircleDollarSign,
  Ellipsis,
  Hourglass,
  Puzzle,
  Send,
  Smartphone,
  Ticket,
  Trash2,
} from "lucide-react";
import { AnimatedFingerprint } from "@/components/auth/AnimatedFingerprint";
import { Button } from "@/components/ui/button";
import { ChoiceCards } from "@/components/ui/ChoiceCards";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { helpTextClass } from "@/components/ui/control-styles";
import { Disclosure } from "@/components/ui/Disclosure";
import { HeroMark } from "@/components/ui/HeroMark";
import { Label } from "@/components/ui/label";
import { Modal, ModalActions } from "@/components/ui/modal";
import { ProductThumb } from "@/components/ui/ProductThumb";
import { inkBadgeClass } from "@/components/ui/surface-styles";
import { Textarea } from "@/components/ui/textarea";
import { SAMPLE_PHOTO, type Specimen } from "./types";

const REASONS = [
  { value: "price", label: "Too expensive", icon: CircleDollarSign },
  { value: "unused", label: "Not using it", icon: Hourglass },
  { value: "missing", label: "Missing a feature", icon: Puzzle },
  { value: "switched", label: "Switching service", icon: ArrowRightLeft },
  { value: "temporary", label: "Only needed it briefly", icon: CalendarClock },
  { value: "other", label: "Something else", icon: Ellipsis },
] as const;

function ReasonTiles({ onClose }: { onClose: () => void }) {
  const [reason, setReason] = useState<(typeof REASONS)[number]["value"] | null>(null);
  return (
    <Modal
      open
      onClose={onClose}
      visual={<HeroMark icon={Send} />}
      title="Why are you leaving?"
      initialFocus="dialog"
      size="lg"
    >
      <div className="flex flex-col gap-4">
        <ChoiceCards
          name="dev-reason"
          legend="Why are you leaving?"
          legendHidden
          variant="tiles"
          columns={3}
          options={REASONS.map(({ value, label, icon: Icon }) => ({
            value,
            label,
            icon: <Icon className="size-5" strokeWidth={1.75} aria-hidden />,
          }))}
          value={reason}
          onChange={setReason}
        />
        {/* The follow-up only once the choice is made. */}
        {reason && (
          <div className="flex flex-col gap-2">
            <Label htmlFor="dev-reason-note">Anything to add?</Label>
            <Textarea id="dev-reason-note" rows={2} />
          </div>
        )}
        <ModalActions>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onClose}>Send</Button>
        </ModalActions>
      </div>
    </Modal>
  );
}

function MethodTiles({ onClose }: { onClose: () => void }) {
  const [method, setMethod] = useState<"passkey" | "app">("passkey");
  return (
    <Modal open onClose={onClose} title="Add a way to sign in">
      <div className="flex flex-col gap-4">
        <ChoiceCards
          name="dev-method"
          legend="How do you want to confirm it's you?"
          legendHidden
          variant="tiles"
          columns={2}
          detached
          options={[
            {
              value: "passkey",
              label: "Passkey",
              icon: (
                <AnimatedFingerprint
                  state={method === "passkey" ? "success" : "idle"}
                  className="size-9"
                />
              ),
              badge: <span className={inkBadgeClass}>Recommended</span>,
            },
            {
              value: "app",
              label: "Authenticator app",
              icon: <Smartphone className="size-9" strokeWidth={1.5} aria-hidden />,
            },
          ]}
          value={method}
          onChange={setMethod}
        />
        <Disclosure
          summary={`Name: ${method === "passkey" ? "Passkey" : "Authenticator app"}`}
          className={helpTextClass}
        >
          <p>A folded field would sit here, and still be sent with the form.</p>
        </Disclosure>
        <ModalActions>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onClose}>Continue</Button>
        </ModalActions>
      </div>
    </Modal>
  );
}

/** The building blocks every real dialog is made of. */
export const ANATOMY: readonly Specimen[] = [
  {
    id: "anatomy-plain",
    group: "Anatomy",
    label: "No visual (before)",
    kind: "dialog",
    render: ({ onClose }) => (
      <Modal
        open
        onClose={onClose}
        title="Delete this product?"
        description="“Field camera” and its uploaded image and file will be permanently removed. Existing orders keep their record of the sale."
      >
        <ModalActions>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onClose}>
            Delete product
          </Button>
        </ModalActions>
      </Modal>
    ),
  },
  {
    id: "anatomy-visual",
    group: "Anatomy",
    label: "With a visual (after)",
    kind: "dialog",
    render: ({ onClose }) => (
      <ConfirmDialog
        open
        onClose={onClose}
        tone="danger"
        visual={
          <HeroMark tone="danger" badge={Trash2} size="lg">
            <ProductThumb src={SAMPLE_PHOTO} className="size-full" />
          </HeroMark>
        }
        title="Delete “Field camera”?"
        description="Orders keep their record of the sale."
        confirmLabel="Delete product"
        onConfirm={onClose}
      />
    ),
  },
  {
    id: "confirm-default",
    group: "Confirm",
    label: "Default tone",
    kind: "dialog",
    render: ({ onClose }) => (
      <ConfirmDialog
        open
        onClose={onClose}
        visual={<HeroMark icon={Send} />}
        title="Send it back for review?"
        description="A person will look at it."
        confirmLabel="Send for review"
        cancelLabel="Keep editing"
        onConfirm={onClose}
      />
    ),
  },
  {
    id: "confirm-danger",
    group: "Confirm",
    label: "Danger tone",
    kind: "dialog",
    render: ({ onClose }) => (
      <ConfirmDialog
        open
        onClose={onClose}
        tone="danger"
        visual={<HeroMark icon={Ticket} tone="danger" badge={Trash2} />}
        title="Delete this discount?"
        description="It stops applying straight away."
        confirmLabel="Delete discount"
        onConfirm={onClose}
      />
    ),
  },
  {
    id: "confirm-pending",
    group: "Confirm",
    label: "While it runs",
    kind: "dialog",
    render: ({ onClose }) => (
      <ConfirmDialog
        open
        onClose={onClose}
        tone="danger"
        visual={<HeroMark icon={Ticket} tone="danger" badge={Trash2} />}
        title="Delete this discount?"
        description="It stops applying straight away."
        confirmLabel="Delete discount"
        pendingLabel="Deleting…"
        pending
        onConfirm={onClose}
      />
    ),
  },
  {
    id: "choice-reasons",
    group: "Choices",
    label: "Six reasons as tiles",
    kind: "dialog",
    render: ({ onClose }) => <ReasonTiles onClose={onClose} />,
  },
  {
    id: "choice-methods",
    group: "Choices",
    label: "Two picture tiles + a folded field",
    kind: "dialog",
    render: ({ onClose }) => <MethodTiles onClose={onClose} />,
  },
];
