// SERVER ONLY, DEVELOPMENT ONLY. The last few messages this app would have
// sent, by email or by text.
//
// WHY IT EXISTS. Proving a contact address is a loop that only closes when a
// code that went OUT comes back IN, and on a laptop nothing is actually sent.
// Printing the message to the terminal (lib/email/send.ts, lib/sms/send.ts)
// makes the code reachable by a human; this keeps the same messages readable by
// a BROWSER, which is what lets the e2e suite drive the whole round trip (save
// an address, read the code, type it, see the gate lift) instead of stopping
// at "we would have sent something".
//
// WHY IT IS SAFE. Two independent locks, because a mailbox of live
// verification codes is exactly the thing that must not exist in production:
//
//   1. Every function here no-ops unless NODE_ENV === "development".
//   2. The route that reads it (app/dev/outbox) 404s outside development too,
//      and lives under /dev, which is already dev-only.
//
// It is in-memory and bounded, so it disappears with the process and cannot
// grow. Nothing else should read it: a feature that needs to know what went
// out needs a real audit trail, not this.

export type OutboundChannel = "email" | "sms";

export type DevMessage = {
  channel: OutboundChannel;
  to: string;
  from: string;
  /** Email only: a text message has no subject. */
  subject?: string;
  /** Email only: set when replies should reach someone other than us. */
  replyTo?: string;
  /** Email only: the display name, when it is not the platform's own. */
  fromName?: string;
  text: string;
  at: string;
};

/** Enough to debug a flow, few enough that a long session cannot bloat. */
const CAPACITY = 40;

function isDev(): boolean {
  return process.env.NODE_ENV === "development";
}

/**
 * Module state does not survive a dev-server recompile, so the buffer hangs
 * off globalThis. Without this a save and the fetch that follows it can land
 * either side of a hot reload and see two different outboxes.
 */
const KEY = Symbol.for("squareshare.dev-outbox");

function outbox(): DevMessage[] {
  const store = globalThis as unknown as Record<symbol, DevMessage[] | undefined>;
  return (store[KEY] ??= []);
}

export function recordDevMessage(message: DevMessage): void {
  if (!isDev()) return;
  const box = outbox();
  box.push(message);
  if (box.length > CAPACITY) box.splice(0, box.length - CAPACITY);
}

/** Newest first, optionally narrowed to one channel and one recipient. */
export function readDevMessages(
  filter: { channel?: OutboundChannel; to?: string } = {},
): DevMessage[] {
  if (!isDev()) return [];
  return [...outbox()]
    .reverse()
    .filter(
      (message) =>
        (!filter.channel || message.channel === filter.channel) &&
        (!filter.to || message.to === filter.to),
    );
}

/** Print a message the way a developer reads it in the terminal. */
export function printDevMessage(message: DevMessage): void {
  console.info(
    [
      "",
      `──────── outbound ${message.channel} (dev: not actually sent) ────────`,
      `from:    ${message.fromName ? `${message.fromName} <${message.from}>` : message.from}`,
      `to:      ${message.to}`,
      ...(message.replyTo ? [`reply-to: ${message.replyTo}`] : []),
      ...(message.subject ? [`subject: ${message.subject}`] : []),
      "",
      message.text,
      "──────────────────────────────────────────────────────────",
      "",
    ].join("\n"),
  );
}
