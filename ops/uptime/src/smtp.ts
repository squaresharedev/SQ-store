// A minimal SMTP client over Cloudflare's TCP sockets: STARTTLS on 587, AUTH
// LOGIN, one message. Enough for alert mail through Brevo's relay, which
// (unlike Brevo's REST API, locked to listed IPs on this account) accepts a
// login from anywhere, a Worker included.
import { connect } from "cloudflare:sockets";

export type SmtpConfig = { host: string; port: number; user: string; pass: string };
export type Message = { fromName: string; fromAddress: string; to: string[]; subject: string; text: string };

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Base64 of a string's UTF-8 bytes. */
function b64(value: string): string {
  let binary = "";
  for (const byte of encoder.encode(value)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** A header value, encoded only when it is not plain ASCII (RFC 2047). */
function headerText(value: string): string {
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${b64(value)}?=`;
}

/** The message as it goes after DATA: headers, a blank line, a base64 body. */
export function formatMessage(m: Message, now: Date, id: string): string {
  const body = b64(m.text.replace(/\r?\n/g, "\r\n")).replace(/.{1,76}/g, "$&\r\n");
  return [
    `From: ${headerText(m.fromName)} <${m.fromAddress}>`,
    `To: ${m.to.join(", ")}`,
    `Subject: ${headerText(m.subject)}`,
    `Date: ${now.toUTCString()}`,
    `Message-ID: <${id}@${m.fromAddress.split("@")[1]}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    body,
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
      if (!text.slice(done === 0 ? 0 : text.lastIndexOf("\n") + 1).startsWith(want)) {
        throw new Error(`SMTP expected ${want}, got: ${text.slice(0, 200)}`);
      }
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

/** Send one message. Throws with the server's words on any refusal. */
export async function sendMail(cfg: SmtpConfig, m: Message): Promise<void> {
  const plain = connect({ hostname: cfg.host, port: cfg.port }, { secureTransport: "starttls" });
  let c = open(plain);
  await reply(c, "220");
  await command(c, "EHLO squareshare-uptime", "250");
  await command(c, "STARTTLS", "220");
  c.reader.releaseLock();
  c.writer.releaseLock();
  const secure = plain.startTls();
  c = open(secure);
  try {
    await command(c, "EHLO squareshare-uptime", "250");
    await command(c, "AUTH LOGIN", "334");
    await command(c, b64(cfg.user), "334");
    await command(c, b64(cfg.pass), "235");
    await command(c, `MAIL FROM:<${m.fromAddress}>`, "250");
    for (const to of m.to) await command(c, `RCPT TO:<${to}>`, "25");
    await command(c, "DATA", "354");
    await c.writer.write(encoder.encode(`${formatMessage(m, new Date(), crypto.randomUUID())}\r\n.\r\n`));
    await reply(c, "250");
    await send(c, "QUIT").catch(() => {});
  } finally {
    await secure.close().catch(() => {});
  }
}
