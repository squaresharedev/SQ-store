"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { TruckIcon, useIconHoverProps } from "@/components/ui/action-icons";
import { buttonClassName } from "@/components/ui/button";
import { ActionErrorNotice } from "@/components/ui/ActionErrorNotice";
import { helpTextClass, secondaryButtonClass } from "@/components/ui/control-styles";
import { Input } from "@/components/ui/input";
import {
  ShipConfirmButton,
  shipActionsClass,
  shipSideActionClass,
  useShipSequence,
  type ShipState,
} from "@/components/orders/ShipConfirmButton";
import { msg } from "@/i18n/types";
import { invalidInput } from "@/lib/errors";
import { cn } from "@/lib/utils";

/**
 * The mark-shipped moment on its own, with a pretend server. The real button
 * lives inside OrderShipping behind a paid order and a signed-in seller; this
 * runs the same states through the same component so the choreography can be
 * watched, replayed and measured without either.
 *
 * The driver below mirrors OrderShipping's submit: wheels turn for at least the
 * minimum rev and for as long as the server takes, the truck leaves only on a
 * yes, and a refusal parks it again.
 */

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** What the server really says when it will not ship an order (lib/orders/actions.ts NOT_SHIPPABLE). */
const REFUSAL = invalidInput(
  msg("Errors.orders.notShippable.message"),
  msg("Errors.orders.notShippable.fix"),
);

const SERVERS = [
  { key: "fast", label: "Server answers at once", ms: 50, ok: true },
  { key: "slow", label: "Server takes 2 seconds", ms: 2000, ok: true },
  { key: "refuses", label: "Server refuses", ms: 400, ok: false },
] as const;

type ServerKey = (typeof SERVERS)[number]["key"];

function Specimen({ dark, server }: { dark: boolean; server: ServerKey }) {
  const sequence = useShipSequence();
  const iconHover = useIconHoverProps();
  const [state, setState] = useState<ShipState>("idle");
  const [open, setOpen] = useState(false);
  const [refused, setRefused] = useState(false);
  const busy = state !== "idle";

  async function ship() {
    if (busy) return;
    setRefused(false);
    setState("working");
    const pretend = SERVERS.find((s) => s.key === server)!;
    await Promise.all([pause(pretend.ms), pause(sequence.revMs)]);
    if (!pretend.ok) {
      setState("idle");
      setRefused(true);
      return;
    }
    setState("delivered");
    await pause(sequence.rollMs + sequence.holdMs);
    // Where the real panel swaps to the shipped view; here the demo replays.
    setState("idle");
    setOpen(false);
  }

  return (
    <div
      data-specimen={dark ? "dark" : "light"}
      className={cn(
        "flex w-80 flex-col gap-3 border border-border bg-background p-4 text-foreground",
        dark && "dark",
      )}
    >
      {!open ? (
        <motion.button
          type="button"
          onClick={() => setOpen(true)}
          className={buttonClassName("primary", "w-full")}
          {...iconHover}
        >
          <TruckIcon />
          Mark as shipped
        </motion.button>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void ship();
          }}
          className="flex flex-col gap-3"
        >
          <Input placeholder="e.g. RR123456789IE" disabled={busy} invalid={refused} aria-label="Tracking number" />
          {refused && <ActionErrorNotice error={REFUSAL} variant="inline" />}
          <div className={shipActionsClass}>
            <ShipConfirmButton state={state} label="Mark shipped" deliveredLabel="Shipped" />
            <button
              type="button"
              className={cn(secondaryButtonClass, shipSideActionClass)}
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

export function ShipButtonGallery() {
  const [server, setServer] = useState<ServerKey>("fast");

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-lg font-semibold">Mark shipped</h1>
        <p className={helpTextClass}>
          Press &ldquo;Mark as shipped&rdquo;, then &ldquo;Mark shipped&rdquo;. The wheels turn while the pretend server
          works, the truck leaves only on a yes.
        </p>
      </header>
      <div role="radiogroup" aria-label="Pretend server" className="flex flex-wrap gap-2">
        {SERVERS.map((s) => (
          <button
            key={s.key}
            type="button"
            role="radio"
            aria-checked={server === s.key}
            onClick={() => setServer(s.key)}
            className={cn(secondaryButtonClass, server === s.key && "border-foreground")}
          >
            {s.label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-start gap-6">
        <Specimen dark={false} server={server} />
        <Specimen dark server={server} />
      </div>
    </main>
  );
}
