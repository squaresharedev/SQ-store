// SERVER ONLY, DEVELOPMENT ONLY. The last few emails this app would have sent.
//
// WHY IT EXISTS. Confirming the seller's contact address is a loop that only
// closes when a link is CLICKED, and on a laptop there is no Cloudflare Email
// Service binding to send it with. Printing the message to the terminal (see
// lib/email/send.ts) makes the link reachable by a human; this keeps the same
// messages readable by a BROWSER, which is what lets the e2e suite drive the
// whole round trip — save an address, fetch the link, open it, see the gate
// lift — instead of stopping at "we would have sent something".
//
// WHY IT IS SAFE. Two independent locks, because a mailbox of live
// verification links is exactly the thing that must not exist in production:
//
//   1. Every function here no-ops unless NODE_ENV === "development".
//   2. The route that reads it (app/dev/emails) 404s outside development too,
//      and lives under /dev, which is already dev-only.
//
// It is in-memory and bounded, so it disappears with the process and cannot
// grow. Nothing else should read it — a feature that needs to know what mail
// went out needs a real audit trail, not this.

export type DevEmail = {
  to: string;
  from: string;
  subject: string;
  text: string;
  at: string;
};

/** Enough to debug a flow, few enough that a long session cannot bloat. */
const CAPACITY = 20;

function isDev(): boolean {
  return process.env.NODE_ENV === "development";
}

/**
 * Module state does not survive a dev-server recompile, so the buffer hangs
 * off globalThis. Without this a save and the fetch that follows it can land
 * either side of a hot reload and see two different mailboxes.
 */
const KEY = Symbol.for("squareshare.dev-outbox");

function outbox(): DevEmail[] {
  const store = globalThis as unknown as Record<symbol, DevEmail[] | undefined>;
  return (store[KEY] ??= []);
}

export function recordDevEmail(message: DevEmail): void {
  if (!isDev()) return;
  const box = outbox();
  box.push(message);
  if (box.length > CAPACITY) box.splice(0, box.length - CAPACITY);
}

/** Newest first, optionally narrowed to one recipient. */
export function readDevEmails(to?: string): DevEmail[] {
  if (!isDev()) return [];
  const box = outbox();
  const all = [...box].reverse();
  return to ? all.filter((message) => message.to === to) : all;
}
