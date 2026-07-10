// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isOwnedObjectKey } from "@/lib/validation/product";

const getActiveAccount = vi.fn();
vi.mock("@/lib/team/account-context", () => ({
  getActiveAccount: () => getActiveAccount(),
}));

const hasR2Credentials = vi.fn(() => true);
const presignPutUrl = vi.fn(async (key: string, _ct?: string) => `https://r2.example/${key}?sig=x`);
vi.mock("@/lib/r2", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/r2")>();
  return {
    ...real,
    hasR2Credentials: () => hasR2Credentials(),
    presignPutUrl: (key: string, ct: string) => presignPutUrl(key, ct),
  };
});

import { POST } from "@/app/api/uploads/presign/route";

const OWNER_UUID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const EDITOR_UUID = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";

function ownerAccount() {
  return {
    accountId: OWNER_UUID,
    userId: OWNER_UUID,
    role: "owner" as const,
    isOwner: true,
  };
}

function request(body: unknown): Request {
  return new Request("http://localhost/api/uploads/presign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const VALID_BODY = {
  kind: "image",
  filename: "photo.png",
  contentType: "image/png",
  size: 1024,
};

beforeEach(() => {
  vi.clearAllMocks();
  hasR2Credentials.mockReturnValue(true);
});

describe("POST /api/uploads/presign", () => {
  it("401 when signed out", async () => {
    getActiveAccount.mockResolvedValue(null);
    const res = await POST(request(VALID_BODY));
    expect(res.status).toBe(401);
  });

  it("403 for a viewer (read-only roles cannot mint upload URLs)", async () => {
    getActiveAccount.mockResolvedValue({
      accountId: OWNER_UUID,
      userId: EDITOR_UUID,
      role: "viewer",
      isOwner: false,
    });
    const res = await POST(request(VALID_BODY));
    expect(res.status).toBe(403);
    expect(presignPutUrl).not.toHaveBeenCalled();
  });

  it("400 on non-JSON body", async () => {
    getActiveAccount.mockResolvedValue(ownerAccount());
    const res = await POST(request("{not json"));
    expect(res.status).toBe(400);
  });

  it("400 with a type-specific message for a disallowed content type", async () => {
    getActiveAccount.mockResolvedValue(ownerAccount());
    const res = await POST(
      request({ ...VALID_BODY, contentType: "image/svg+xml" }),
    );
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toMatch(/file type is not supported/i);
  });

  it("400 with a size message for an oversized image", async () => {
    getActiveAccount.mockResolvedValue(ownerAccount());
    const res = await POST(
      request({ ...VALID_BODY, size: 10 * 1024 * 1024 + 1 }),
    );
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toMatch(/too large/i);
  });

  it("503 when R2 is not configured (operator problem, honest status)", async () => {
    getActiveAccount.mockResolvedValue(ownerAccount());
    hasR2Credentials.mockReturnValue(false);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(request(VALID_BODY));
    expect(res.status).toBe(503);
    spy.mockRestore();
  });

  it("mints the key server-side under the UPLOADER's id — client never chooses it", async () => {
    getActiveAccount.mockResolvedValue({
      accountId: OWNER_UUID, // acting on the owner's store...
      userId: EDITOR_UUID, // ...as a team editor
      role: "editor",
      isOwner: false,
    });
    const res = await POST(request(VALID_BODY));
    expect(res.status).toBe(200);
    const { key, url } = (await res.json()) as { key: string; url: string };
    expect(key.startsWith(`images/${EDITOR_UUID}/`)).toBe(true);
    expect(isOwnedObjectKey(key, "image", EDITOR_UUID)).toBe(true);
    expect(url).toContain(key);
    expect(presignPutUrl).toHaveBeenCalledWith(key, "image/png");
  });

  it("a traversal filename cannot escape the uploader's prefix", async () => {
    getActiveAccount.mockResolvedValue(ownerAccount());
    const res = await POST(
      request({ ...VALID_BODY, filename: `../../${EDITOR_UUID}/steal.png` }),
    );
    expect(res.status).toBe(200);
    const { key } = (await res.json()) as { key: string };
    expect(key.startsWith(`images/${OWNER_UUID}/`)).toBe(true);
    expect(key).not.toContain("..");
  });

  it("500 (not a leak) when the signer throws", async () => {
    getActiveAccount.mockResolvedValue(ownerAccount());
    presignPutUrl.mockRejectedValueOnce(new Error("boom"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(request(VALID_BODY));
    expect(res.status).toBe(500);
    const json = (await res.json()) as { error: string };
    expect(json.error).not.toContain("boom");
    spy.mockRestore();
  });
});
