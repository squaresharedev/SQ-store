// @vitest-environment node
import { describe, expect, it } from "vitest";
import { clientLimitKey } from "@/lib/security/client-ip";
import { clientKey } from "@/lib/rate-limit";

/**
 * One client, as the anonymous rate limits count it. An IPv6 client holds a
 * whole /64, so a limit keyed on the full address would be one fresh address
 * away from resetting; every address in a /64 must be the same key.
 */

describe("clientLimitKey", () => {
  it("keeps IPv4 as it is", () => {
    expect(clientLimitKey("203.0.113.9")).toBe("203.0.113.9");
    expect(clientLimitKey("unknown-client")).toBe("unknown-client");
  });

  it("counts every address of one /64 as one client", () => {
    const one = [
      "2001:db8:1234:5678::1",
      "2001:db8:1234:5678:ffff:ffff:ffff:ffff",
      "2001:0DB8:1234:5678:aaaa:bbbb:cccc:dddd",
      "2001:db8:1234:5678:0:0:0:42%eth0",
    ].map(clientLimitKey);
    expect(new Set(one)).toEqual(new Set(["2001:db8:1234:5678::/64"]));
  });

  it("keeps neighbouring /64s apart", () => {
    expect(clientLimitKey("2001:db8:1234:5678::1")).not.toBe(clientLimitKey("2001:db8:1234:5679::1"));
  });

  it("reads compressed forms, wherever the gap is", () => {
    expect(clientLimitKey("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(clientLimitKey("::1")).toBe("0:0:0:0::/64");
    expect(clientLimitKey("fe80::")).toBe("fe80:0:0:0::/64");
    expect(clientLimitKey("2001:db8:1:2:3::")).toBe("2001:db8:1:2::/64");
  });

  it("counts IPv4 written as IPv6 as that IPv4 client", () => {
    expect(clientLimitKey("::ffff:203.0.113.9")).toBe("203.0.113.9");
    expect(clientLimitKey("::ffff:cb00:7109")).toBe("203.0.113.9");
  });

  it("reads a trailing dotted quad in other addresses too", () => {
    expect(clientLimitKey("64:ff9b::203.0.113.9")).toBe("64:ff9b:0:0::/64");
    expect(clientLimitKey("2001:db8:1:2:3:4:203.0.113.9")).toBe("2001:db8:1:2::/64");
  });

  it("returns what it cannot parse as it came, so it is still a key", () => {
    for (const odd of ["1::2::3", "2001:db8:zz::1", "1:2:3:4:5:6:7:8:9", "::ffff:300.1.1.1"]) {
      expect(clientLimitKey(odd)).toBe(odd);
    }
  });
});

describe("clientKey", () => {
  it("keys an IPv6 edge address by its /64", async () => {
    const headers = new Headers({ "cf-connecting-ip": "2001:db8:aaaa:bbbb:1111:2222:3333:4444" });
    expect(await clientKey(headers)).toBe("2001:db8:aaaa:bbbb::/64");
  });

  it("still prefers the edge header and falls back to the first forwarded address", async () => {
    expect(await clientKey(new Headers({ "cf-connecting-ip": "198.51.100.7", "x-forwarded-for": "1.1.1.1" }))).toBe(
      "198.51.100.7",
    );
    expect(await clientKey(new Headers({ "x-forwarded-for": "192.0.2.1, 10.0.0.1" }))).toBe("192.0.2.1");
    expect(await clientKey(new Headers())).toBe("unknown-client");
  });
});
