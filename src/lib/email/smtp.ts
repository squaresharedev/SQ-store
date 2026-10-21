// SERVER ONLY (Workers). A minimal SMTP client over Cloudflare's TCP sockets:
// STARTTLS on 587, AUTH LOGIN, one message per connection. It is how this
// app's mail (lib/email/send.ts) and the uptime monitor (ops/uptime) reach
// Brevo's relay.
//
// WHY SMTP AND NOT BREVO'S REST API. The account has "Authorised IPs" on, so
// the REST API answers only listed addresses, and a Worker has none of its
// own. The relay takes a login from anywhere, and its key can only SEND, where
// the REST key could also read contacts and the account. So the powerful key
// stays locked and the one on the Worker is the weak one.
//
// HEADER INJECTION. Several values here are chosen by users (a product's title
// reaches a subject, a seller's contact address reaches Reply-To). A CR or LF in
// any of them would end the header and let the author add their own headers or
// recipients. So: addresses are validated against a strict shape, and text
// headers are RFC 2047 encoded whenever they are not plain printable ASCII,
// which keeps a line break from ever reaching the wire raw.
//
// `cloudflare:sockets` is imported at call time, from a specifier built out of
// a base64 constant. Next's build cannot resolve a `cloudflare:` module, and neither can
// OpenNext's own esbuild pass (it fails the build with "Could not resolve",
// whatever the ignore comments say); only the Workers runtime can. A specifier
// no bundler can read is one none of them tries to resolve.

export type SmtpConfig = { host: string; port: number; user: string; pass: string };
export type Message = {
  fromName: string;
  fromAddress: string;
  to: string[];
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
};

/** The relay this app sends through. */
export const BREVO_SMTP_HOST = "smtp-relay.brevo.com";
export const BREVO_SMTP_PORT = 587;

/** One whole send, connection to QUIT, before it counts as failed. */
const SEND_TIMEOUT_MS = 15_000;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** An address with nothing that could end a header or add a recipient. */
const ADDRESS = /^[^\s<>"(),;:\\@]+@[^\s<>"(),;:\\@]+\.[^\s<>"(),;:\\@]+$/;

export function isSafeAddress(value: string): boolean {
  return value.length <= 254 && ADDRESS.test(value);
}

/** Base64 of a string's UTF-8 bytes. */
function b64(value: string): string {
  let binary = "";
  for (const byte of encoder.encode(value)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Longest run of code points per RFC 2047 word (a word may not pass 75 characters). */
const WORD_CODE_POINTS = 10;

/**
 * A header value that is safe to put on one line: plain printable ASCII as it
 * is, anything else (non-ASCII, and above all CR or LF) as folded
 * `=?UTF-8?B?...?=` words.
 */
export function headerText(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  const points = Array.from(value);
  const words: string[] = [];
  for (let at = 0; at < points.length; at += WORD_CODE_POINTS) {
    words.push(`=?UTF-8?B?${b64(points.slice(at, at + WORD_CODE_POINTS).join(""))}?=`);
  }
  return words.join("\r\n ");
}

/** Base64 body, wrapped at 76 characters, CRLF line ends. */
function base64Body(text: string): string {
  return b64(text.replace(/\r?\n/g, "\r\n")).replace(/.{1,76}/g, "$&\r\n");
}

/** The message as it goes after DATA: headers, a blank line, the body. */
export function formatMessage(m: Message, now: Date, id: string): string {
  for (const address of [m.fromAddress, ...m.to, ...(m.replyTo ? [m.replyTo] : [])]) {
    if (!isSafeAddress(address)) throw new Error("refusing to send: an address is not a plain email address");
  }
  const headers = [
    `From: ${headerText(m.fromName)} <${m.fromAddress}>`,
    `To: ${m.to.join(", ")}`,
    ...(m.replyTo ? [`Reply-To: ${m.replyTo}`] : []),
    `Subject: ${headerText(m.subject)}`,
    `Date: ${now.toUTCString()}`,
    `Message-ID: <${id}@${m.fromAddress.split("@")[1]}>`,
    "MIME-Version: 1.0",
  ];
  if (!m.html) {
    return [
      ...headers,
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      base64Body(m.text),
    ].join("\r\n");
  }
  // Plain text first, HTML second: a client that cannot show HTML shows the text.
  const boundary = `sq-${id}`;
  const part = (type: string, body: string) =>
    [`--${boundary}`, `Content-Type: ${type}; charset=UTF-8`, "Content-Transfer-Encoding: base64", "", base64Body(body)].join("\r\n");
  return [
    ...headers,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    part("text/plain", m.text),
    part("text/html", m.html),
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

type Conn = {
  reader: ReadableStreamDefaultReader<Uint8Array>;
  writer: WritableStreamDefaultWriter<Uint8Array>;
  buffer: string;
};

function open(socket: { readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array> }): Conn {
  return { reader: socket.readable.getReader(), writer: socket.writable.getWriter(), buffer: "" };
}

/** One full reply (multi-line replies end at "NNN "), failing unless its code starts with `want`. */
async function reply(c: Conn, want: string): Promise<string> {
  for (;;) {
    const lines = c.buffer.split("\r\n");
    const done = lines.findIndex((l) => /^\d{3} /.test(l));
    if (done >= 0) {
      const text = lines.slice(0, done + 1).join("\n");
      c.buffer = lines.slice(done + 1).join("\r\n");
      if (!lines[done].startsWith(want)) throw new Error(`SMTP expected ${want}, got: ${text.slice(0, 200)}`);
      return text;
    }
    const { value, done: ended } = await c.reader.read();
    if (ended) throw new Error("SMTP connection closed");
    c.buffer += decoder.decode(value, { stream: true });
  }
}

async function send(c: Conn, line: string): Promise<void> {
  await c.writer.write(encoder.encode(`${line}\r\n`));
}

async function command(c: Conn, line: string, want: string): Promise<string> {
  await send(c, line);
  return reply(c, want);
}

/**
 * "cloudflare:sockets", base64. NOT a join of two strings: Turbopack's minifier
 * folds that back into the literal (tried: the OpenNext build failed on it),
 * and nothing folds a call to atob. tests/unit/smtp-message.test.ts pins it.
 */
export const SOCKETS_MODULE = atob("Y2xvdWRmbGFyZTpzb2NrZXRz");

/** Connect, upgrade to TLS, log in, run `work`, say QUIT and close. */
async function withSession<T>(cfg: SmtpConfig, work: (c: Conn) => Promise<T>): Promise<T> {
  const { connect } = (await import(
    /* webpackIgnore: true */ /* turbopackIgnore: true */ SOCKETS_MODULE
  )) as typeof import("cloudflare:sockets");
  const plain = connect({ hostname: cfg.host, port: cfg.port }, { secureTransport: "starttls" });
  let c = open(plain);
  await reply(c, "220");
  await command(c, "EHLO squareshare", "250");
  await command(c, "STARTTLS", "220");
  c.reader.releaseLock();
  c.writer.releaseLock();
  const secure = plain.startTls();
  c = open(secure);
  try {
    await command(c, "EHLO squareshare", "250");
    await command(c, "AUTH LOGIN", "334");
    await command(c, b64(cfg.user), "334");
    await command(c, b64(cfg.pass), "235");
    const result = await work(c);
    await send(c, "QUIT").catch(() => {});
    return result;
  } finally {
    await secure.close().catch(() => {});
  }
}

async function deliver(cfg: SmtpConfig, m: Message): Promise<string> {
  // Checked before anything is dialled: a refusal costs no connection.
  const data = formatMessage(m, new Date(), crypto.randomUUID());
  return withSession(cfg, async (c) => {
    await command(c, `MAIL FROM:<${m.fromAddress}>`, "250");
    for (const to of m.to) await command(c, `RCPT TO:<${to}>`, "25");
    await command(c, "DATA", "354");
    await c.writer.write(encoder.encode(`${data}\r\n.\r\n`));
    return reply(c, "250");
  });
}

/** Run `work` under the send timeout, whatever it was waiting for. */
async function withTimeout<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`SMTP timed out after ${SEND_TIMEOUT_MS / 1000} s`)), SEND_TIMEOUT_MS);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Prove the relay is reachable and the login is accepted, sending nothing. The
 * deploy's smoke check runs it (api/ops/mail-test), so a build whose SMTP
 * client cannot run on Workers, or whose secrets are wrong, never goes live.
 */
export async function checkRelay(cfg: SmtpConfig): Promise<void> {
  await withTimeout(withSession(cfg, async () => undefined));
}

/**
 * Send one message. Resolves with the server's acceptance line (it carries the
 * queue id); throws with the server's own words on any refusal, and after
 * SEND_TIMEOUT_MS whatever it was waiting for.
 */
export async function sendMail(cfg: SmtpConfig, m: Message): Promise<string> {
  return withTimeout(deliver(cfg, m));
}
