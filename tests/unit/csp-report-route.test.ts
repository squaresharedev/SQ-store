// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/csp-report/route";
import { logSafe } from "@/lib/security/log-safe";

/**
 * The CSP report sink is open to anyone, and what it is sent ends up in the
 * logs. It must stay one bounded line per report, in words the sender cannot
 * turn into a line or an alert of their own.
 */

const post = (body: unknown, type = "application/reports+json") =>
  POST(
    new Request("http://localhost/api/csp-report", {
      method: "POST",
      headers: { "content-type": type },
      body: JSON.stringify(body),
    }),
  );

const report = (blockedURL: string) => ({
  type: "csp-violation",
  body: { effectiveDirective: "img-src", blockedURL, documentURL: "https://dashboard.squareshare.eu/" },
});

afterEach(() => vi.restoreAllMocks());

describe("logSafe", () => {
  it("leaves an ordinary URL as it is", () => {
    expect(logSafe("https://cdn.example.com/a.png?x=1")).toBe("https://cdn.example.com/a.png?x=1");
  });

  it("cannot start a line or borrow an alert prefix", () => {
    const forged = logSafe("x\n[ops alert] money taken\r[server error]\u2028y");
    expect(forged).not.toMatch(/[\r\n\u2028]/);
    expect(forged).not.toContain("[ops alert]");
    expect(forged).not.toContain("[server error]");
    expect(forged).toBe("x%0A%5Bops alert%5D money taken%0D%5Bserver error%5D%E2%80%A8y");
  });

  it("cuts to the length it is given", () => {
    expect(logSafe("a".repeat(1000))).toHaveLength(300);
  });

  it("never leaves half an emoji behind where it cuts", () => {
    // 299 letters, then an emoji whose two halves straddle the 300 cut.
    const cut = logSafe("a".repeat(299) + "\uD83D\uDE00");
    expect(cut.endsWith("\uFFFD")).toBe(true);
    expect(() => encodeURIComponent(cut)).not.toThrow();
    expect(logSafe("ok \uD83D\uDE00")).toBe("ok \uD83D\uDE00");
  });
});

describe("POST /api/csp-report", () => {
  it("logs one line per report, and no more than 20 from one request", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // 200 reports: well inside the 64 KB body cap, ten times the line cap.
    const res = await post(Array.from({ length: 200 }, () => report("https://x.example/a")));
    expect(res.status).toBe(204);
    expect(warn).toHaveBeenCalledTimes(20);
  });

  it("writes what it was sent only in log-safe form", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await post([report("https://x.example/\n[ops alert] fake")]);
    const line = String(warn.mock.calls[0][0]);
    expect(line.startsWith("[csp] img-src blocked ")).toBe(true);
    expect(line).not.toContain("\n");
    expect(line).not.toContain("[ops alert]");
  });
});
