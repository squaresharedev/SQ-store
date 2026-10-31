// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseClientMetadata } from "@/lib/agent/oauth/clients";
import { isPkceChallenge, isPkceVerifier, pkceChallenge, randomCredential, sha256Hex } from "@/lib/agent/oauth/crypto";
import { isPublicHttpsUrl } from "@/lib/agent/oauth/public-url";
import { isAllowedRedirectUri, redirectDisplayHost, redirectUriMatches, redirectWith } from "@/lib/agent/oauth/redirects";
import { AGENT_SCOPES, AGENT_SCOPE_IDS, initialScopes, knownScopes, parseScopeParam } from "@/lib/agent/scopes";

describe("redirect URIs an app may register", () => {
  it("takes HTTPS and a local listener", () => {
    expect(isAllowedRedirectUri("https://claude.ai/api/mcp/auth_callback", "web")).toBe(true);
    expect(isAllowedRedirectUri("http://localhost:6274/callback", "web")).toBe(true);
    expect(isAllowedRedirectUri("http://127.0.0.1:1234/cb", "web")).toBe(true);
    expect(isAllowedRedirectUri("http://[::1]:1234/cb", "web")).toBe(true);
  });

  it("refuses plain HTTP to anywhere else: the code would cross the network in clear", () => {
    expect(isAllowedRedirectUri("http://evil.example/cb", "web")).toBe(false);
    expect(isAllowedRedirectUri("http://localhost.evil.example/cb", "web")).toBe(false);
  });

  it("takes an app's own scheme only for a native app", () => {
    expect(isAllowedRedirectUri("cursor://anysphere.cursor/cb", "native")).toBe(true);
    expect(isAllowedRedirectUri("cursor://anysphere.cursor/cb", "web")).toBe(false);
  });

  it("never takes a scheme that runs or reads something in the browser", () => {
    for (const uri of ["javascript:alert(1)", "data:text/html,x", "file:///etc/passwd", "vbscript:x"]) {
      expect(isAllowedRedirectUri(uri, "native"), uri).toBe(false);
    }
  });

  it("refuses a fragment and credentials in the URL", () => {
    expect(isAllowedRedirectUri("https://app.example/cb#frag", "web")).toBe(false);
    expect(isAllowedRedirectUri("https://user:pw@app.example/cb", "web")).toBe(false);
  });
});

describe("matching a redirect URI against what was registered", () => {
  it("is exact", () => {
    const registered = ["https://app.example/cb"];
    expect(redirectUriMatches("https://app.example/cb", registered)).toBe(true);
    expect(redirectUriMatches("https://app.example/cb/", registered)).toBe(false);
    expect(redirectUriMatches("https://app.example/cb?x=1", registered)).toBe(false);
    expect(redirectUriMatches("https://evil.example/cb", registered)).toBe(false);
  });

  it("lets a loopback listener pick its port (RFC 8252), and nothing else about it", () => {
    const registered = ["http://localhost:1/cb"];
    expect(redirectUriMatches("http://localhost:6274/cb", registered)).toBe(true);
    expect(redirectUriMatches("http://localhost:6274/other", registered)).toBe(false);
    expect(redirectUriMatches("http://127.0.0.1:6274/cb", registered)).toBe(false);
  });

  it("does not extend that to a non-loopback port", () => {
    expect(redirectUriMatches("https://app.example:8443/cb", ["https://app.example/cb"])).toBe(false);
  });
});

describe("what the consent page and the app's redirect are told", () => {
  it("names the host", () => {
    expect(redirectDisplayHost("https://claude.ai/api/mcp/auth_callback")).toBe("claude.ai");
  });

  it("adds response parameters and leaves undefined ones out", () => {
    const url = new URL(redirectWith("https://app.example/cb?keep=1", { code: "abc", state: undefined }));
    expect(url.searchParams.get("keep")).toBe("1");
    expect(url.searchParams.get("code")).toBe("abc");
    expect(url.searchParams.has("state")).toBe(false);
  });
});

describe("app registration", () => {
  it("takes what Claude sends: no application_type and an HTTPS callback", () => {
    const parsed = parseClientMetadata({
      client_name: "Claude",
      redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    });
    expect(parsed).toMatchObject({ ok: true, name: "Claude", applicationType: "web" });
  });

  it("treats an app-scheme redirect as native when it does not say", () => {
    const parsed = parseClientMetadata({ redirect_uris: ["cursor://x/cb"] });
    expect(parsed).toMatchObject({ ok: true, applicationType: "native", name: "Unnamed app" });
  });

  it("takes a client that asked for a secret, and issues it none", () => {
    const parsed = parseClientMetadata({
      redirect_uris: ["https://app.example/cb"],
      token_endpoint_auth_method: "client_secret_basic",
    });
    expect(parsed).toMatchObject({ ok: true });
  });

  it("refuses a bad redirect and no redirect at all", () => {
    expect(parseClientMetadata({ redirect_uris: ["http://evil.example/cb"] })).toMatchObject({
      ok: false,
      error: "invalid_redirect_uri",
    });
    expect(parseClientMetadata({ redirect_uris: [] })).toMatchObject({ ok: false });
    expect(parseClientMetadata({})).toMatchObject({ ok: false });
  });

  it("refuses a redirect list an app could use to fill the table", () => {
    const uris = Array.from({ length: 11 }, (_, index) => `https://app.example/${index}`);
    expect(parseClientMetadata({ redirect_uris: uris })).toMatchObject({ ok: false });
  });
});

describe("URLs this server may fetch for an outsider", () => {
  it("takes a public HTTPS name", () => {
    expect(isPublicHttpsUrl("https://images.example.com/a.jpg")).toBe(true);
  });

  it("refuses what would reach inward", () => {
    for (const url of [
      "http://images.example.com/a.jpg",
      "https://localhost/x",
      "https://foo.localhost/x",
      "https://metadata.internal/x",
      "https://printer.local/x",
      "https://127.0.0.1/x",
      "https://169.254.169.254/latest/meta-data",
      "https://[::1]/x",
      "https://user:pw@example.com/x",
      "not a url",
    ]) {
      expect(isPublicHttpsUrl(url), url).toBe(false);
    }
  });
});

describe("credentials", () => {
  it("are long, prefixed and different every time", () => {
    const first = randomCredential("sqa_");
    expect(first.startsWith("sqa_")).toBe(true);
    expect(first.length).toBeGreaterThan(40);
    expect(randomCredential("sqa_")).not.toBe(first);
  });

  it("hash deterministically, and to something else", async () => {
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("compute PKCE as RFC 7636 says, using its own test vector", async () => {
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    expect(isPkceVerifier(verifier)).toBe(true);
    const challenge = await pkceChallenge(verifier);
    expect(challenge).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    expect(isPkceChallenge(challenge)).toBe(true);
  });

  it("refuse a PKCE value of the wrong shape", () => {
    expect(isPkceVerifier("short")).toBe(false);
    expect(isPkceChallenge("short")).toBe(false);
    expect(isPkceChallenge("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-c!")).toBe(false);
  });
});

describe("scopes", () => {
  it("starts with everything but the opt-in ones when an app names none", () => {
    const picked = initialScopes([]);
    expect(picked).toContain("store:read");
    expect(picked).toContain("products:write");
    expect(picked).not.toContain("orders:refund");
    expect(picked).not.toContain("destructive");
  });

  it("gives an app what it named, plus the required one, and never more", () => {
    expect(initialScopes(["orders:read"]).sort()).toEqual(["orders:read", "store:read"]);
  });

  it("never starts an opt-in scope on, even when the app names it: clients echo the advertised list", () => {
    const picked = initialScopes(AGENT_SCOPE_IDS);
    expect(picked).not.toContain("orders:refund");
    expect(picked).not.toContain("destructive");
    expect(picked).toContain("products:write");
    expect(initialScopes(["destructive"])).toEqual(["store:read"]);
  });

  it("ignores names it does not know, including prototype keys", () => {
    expect(knownScopes(["store:read", "root", "constructor", "__proto__"])).toEqual(["store:read"]);
    expect(initialScopes(["root"])).toContain("products:write");
  });

  it("splits an OAuth scope parameter", () => {
    expect(parseScopeParam("a  b")).toEqual(["a", "b"]);
    expect(parseScopeParam(null)).toEqual([]);
  });

  it("marks exactly the money-moving and unrecoverable scopes as opt-in", () => {
    const optIn = AGENT_SCOPE_IDS.filter((id) => "optIn" in AGENT_SCOPES[id]);
    expect(optIn.sort()).toEqual(["destructive", "orders:refund"]);
  });
});
