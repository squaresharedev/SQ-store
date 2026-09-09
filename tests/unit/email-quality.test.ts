import { describe, expect, it, vi, afterEach } from "vitest";
import {
  emailQualityProblem,
  isPlaceholderEmail,
} from "@/lib/validation/email-quality";
import { hasMailExchanger } from "@/lib/validation/email-domain";

// "Is this an address a buyer could actually reach the seller at?" These
// filters are what stands between a required contact field and a seller
// typing anything to get past it.

describe("isPlaceholderEmail", () => {
  it("catches the reserved TLDs, where no mail can ever be delivered", () => {
    for (const address of [
      "hi@studio.example",
      "hi@studio.test",
      "hi@studio.invalid",
      "hi@studio.localhost",
      "hi@studio.local",
    ]) {
      expect(isPlaceholderEmail(address), address).toBe(true);
    }
  });

  it("catches the documentation and stand-in domains", () => {
    for (const address of [
      "hello@example.com",
      "hello@example.org",
      "hello@mail.example.com",
      "hello@test.com",
      "hello@yourdomain.com",
      "hello@fake.com",
    ]) {
      expect(isPlaceholderEmail(address), address).toBe(true);
    }
  });

  it("catches local parts that mean 'I am not telling you'", () => {
    for (const address of [
      "test@studio-builderboy.at",
      "asdf@studio-builderboy.at",
      "noreply@studio-builderboy.at",
      "no-reply@studio-builderboy.at",
      "placeholder@studio-builderboy.at",
    ]) {
      expect(isPlaceholderEmail(address), address).toBe(true);
    }
  });

  it("catches a keyboard mash with no domain at all", () => {
    expect(isPlaceholderEmail("asdf@asdf")).toBe(true);
    expect(isPlaceholderEmail("a@b.co")).toBe(true);
  });

  it("leaves real addresses alone", () => {
    for (const address of [
      "hello@studio-builderboy.at",
      "orders@rootlabs.io",
      "testudo@rootlabs.io", // "test" as a SUBSTRING is somebody's name
      "anna.example@gmail.com", // "example" in the local part is fine
      "shop@example-prints.de", // a real registry, not example.com
      "hi@squareshare.eu",
    ]) {
      expect(isPlaceholderEmail(address), address).toBe(false);
    }
  });
});

describe("emailQualityProblem", () => {
  it("names the field it is speaking about", () => {
    expect(emailQualityProblem("hello@example.com", "Your contact email")).toContain(
      "Your contact email",
    );
  });

  it("distinguishes a placeholder from a throwaway provider", () => {
    expect(emailQualityProblem("hello@example.com", "That email")).toContain(
      "placeholder",
    );
    expect(emailQualityProblem("someone@mailinator.com", "That email")).toContain(
      "temporary-mail",
    );
  });

  it("accepts a real address", () => {
    expect(emailQualityProblem("hello@studio-builderboy.at", "That email")).toBeNull();
  });
});

describe("hasMailExchanger", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  /** One canned DoH answer per query, in the order the module asks. */
  function mockDoh(...responses: (object | "network-error")[]) {
    let call = 0;
    globalThis.fetch = vi.fn(async () => {
      const next = responses[Math.min(call, responses.length - 1)];
      call += 1;
      if (next === "network-error") throw new Error("offline");
      return { ok: true, json: async () => next } as Response;
    }) as typeof fetch;
  }

  it("says yes when the domain has an MX record", async () => {
    mockDoh({ Status: 0, Answer: [{ type: 15, data: "10 mx.studio.at." }] });
    expect(await hasMailExchanger("hi@studio-builderboy.at")).toBe("yes");
  });

  it("says no for a domain that does not exist", async () => {
    mockDoh({ Status: 3 });
    expect(await hasMailExchanger("hi@gmial-typo-nowhere.at")).toBe("no");
  });

  it("falls back to an address record when there is no MX", async () => {
    // RFC 5321 §5.1: a domain with an A record and no MX is still a valid
    // mail destination, and plenty of small domains are set up that way.
    mockDoh(
      { Status: 0, Answer: [] },
      { Status: 0, Answer: [{ type: 1, data: "203.0.113.10" }] },
      { Status: 0, Answer: [] },
    );
    expect(await hasMailExchanger("hi@studio-builderboy.at")).toBe("yes");
  });

  it("says no when the domain resolves but offers nowhere to deliver", async () => {
    mockDoh({ Status: 0, Answer: [] }, { Status: 0, Answer: [] }, { Status: 0, Answer: [] });
    expect(await hasMailExchanger("hi@studio-builderboy.at")).toBe("no");
  });

  it("says unknown — never no — when the resolver cannot be reached", async () => {
    // The one fail-open in the publish gate: a seller's real address must not
    // be refused because a third party timed out.
    mockDoh("network-error");
    expect(await hasMailExchanger("hi@studio-builderboy.at")).toBe("unknown");
  });

  it("says unknown for a SERVFAIL rather than treating it as a refusal", async () => {
    mockDoh({ Status: 2 });
    expect(await hasMailExchanger("hi@studio-builderboy.at")).toBe("unknown");
  });

  it("asks nothing about a string with no domain", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    expect(await hasMailExchanger("not-an-email")).toBe("unknown");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sends only the domain to the resolver, never the address", async () => {
    mockDoh({ Status: 0, Answer: [{ type: 15, data: "10 mx.studio.at." }] });
    await hasMailExchanger("private.person@studio-builderboy.at");
    const url = String((globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(url).toContain("studio-builderboy.at");
    expect(url).not.toContain("private.person");
  });
});
