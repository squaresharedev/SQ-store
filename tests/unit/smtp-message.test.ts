// @vitest-environment node
import { describe, expect, it } from "vitest";
import { SOCKETS_MODULE, formatMessage, headerText, isSafeAddress, type Message } from "@/lib/email/smtp";

describe("the sockets module", () => {
  it("is the Workers one, hidden from bundlers behind atob", () => {
    expect(SOCKETS_MODULE).toBe("cloudflare:sockets");
  });
});

const NOW = new Date("2026-10-21T12:00:00Z");
const base: Message = {
  fromName: "Squareshare",
  fromAddress: "info@squareshare.eu",
  to: ["buyer@shop.eu"],
  subject: "Your order has shipped",
  text: "Hello\nWorld",
};
const render = (m: Message) => formatMessage(m, NOW, "abc123");
const headerLines = (raw: string) => raw.split("\r\n\r\n")[0].split("\r\n");
const decode = (b64: string) => Buffer.from(b64.replace(/\s+/g, ""), "base64").toString("utf8");

describe("the message on the wire", () => {
  it("is a plain base64 text message with CRLF line ends", () => {
    const raw = render(base);
    expect(headerLines(raw)).toEqual([
      "From: Squareshare <info@squareshare.eu>",
      "To: buyer@shop.eu",
      "Subject: Your order has shipped",
      "Date: Wed, 21 Oct 2026 12:00:00 GMT",
      "Message-ID: <abc123@squareshare.eu>",
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
    ]);
    expect(decode(raw.split("\r\n\r\n")[1])).toBe("Hello\r\nWorld");
    expect(raw).not.toMatch(/[^\r]\n/);
  });

  it("puts the text part before the HTML part, and a reply-to where a seller asked", () => {
    const raw = render({ ...base, html: "<p>Hi</p>", replyTo: "seller@shop.eu" });
    expect(raw).toContain("Reply-To: seller@shop.eu\r\n");
    expect(raw).toContain('Content-Type: multipart/alternative; boundary="sq-abc123"');
    expect(raw.indexOf("text/plain")).toBeLessThan(raw.indexOf("text/html"));
    expect(raw.endsWith("--sq-abc123--\r\n")).toBe(true);
    const [, plain, html] = raw.split(/--sq-abc123\r\nContent-Type: text\/(?:plain|html); charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n/);
    expect(decode(plain)).toBe("Hello\r\nWorld");
    expect(decode(html.split("--sq-abc123--")[0])).toBe("<p>Hi</p>");
  });
});

describe("header injection", () => {
  it("never lets a line break in a subject reach the wire raw", () => {
    const hostile = "Order\r\nBcc: attacker@evil.example\r\nX-Spam: yes";
    const raw = render({ ...base, subject: hostile });
    const lines = headerLines(raw);
    expect(lines.some((l) => /^Bcc:/i.test(l))).toBe(false);
    expect(lines.some((l) => /^X-Spam:/i.test(l))).toBe(false);
    // The text survives, encoded.
    const words = raw.match(/=\?UTF-8\?B\?([^?]+)\?=/g)!.map((w) => decode(w.slice(10, -2)));
    expect(words.join("")).toBe(hostile);
  });

  it("encodes a display name the same way", () => {
    const raw = render({ ...base, fromName: "Shop\r\nBcc: x@y.eu" });
    expect(headerLines(raw).some((l) => /^Bcc:/i.test(l))).toBe(false);
  });

  it.each<[string, Partial<Message>]>([
    ["a recipient with a line break", { to: ["a@b.eu\r\nBcc: x@y.eu"] }],
    ["a second recipient smuggled in", { to: ["a@b.eu, x@y.eu"] }],
    ["an angle-bracket address", { to: ["<a@b.eu>"] }],
    ["a reply-to with a line break", { replyTo: "a@b.eu\nBcc: x@y.eu" }],
    ["a sender with a space", { fromAddress: "info @squareshare.eu" }],
  ])("refuses %s before dialling anything", (_why, patch) => {
    expect(() => render({ ...base, ...patch })).toThrow(/plain email address/);
  });

  it("knows a plain address from a hostile one", () => {
    expect(isSafeAddress("anna.novak+shop@firma.cz")).toBe(true);
    expect(isSafeAddress("a@b")).toBe(false);
    expect(isSafeAddress(`${"a".repeat(250)}@b.eu`)).toBe(false);
  });
});

describe("encoded headers", () => {
  it("leaves plain ASCII alone", () => {
    expect(headerText("Order 1042 has shipped")).toBe("Order 1042 has shipped");
  });

  it("keeps every encoded word within the 75 characters RFC 2047 allows, and round-trips", () => {
    const subject = "Objednávka č. 1042 byla odeslána 📦 děkujeme, že nakupujete u nás";
    const encoded = headerText(subject);
    const words = encoded.split("\r\n ");
    for (const word of words) expect(word.length).toBeLessThanOrEqual(75);
    expect(words.map((w) => decode(w.slice(10, -2))).join("")).toBe(subject);
  });
});
