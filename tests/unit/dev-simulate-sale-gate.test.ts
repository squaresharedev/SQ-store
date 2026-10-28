import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// /dev/simulate-sale is how a seller tries the buyer's side (the thank-you
// page, the review ask) without paying. It writes orders nobody paid for and
// deletes reviews, so outside development it must be a plain 404, before it
// so much as looks for a session.

const simulated = vi.hoisted(() => ({
  simulateSale: vi.fn(),
  simulatableProducts: vi.fn(async () => []),
  buyerStorefrontFor: vi.fn(),
  deleteSimulatedReviews: vi.fn(),
}));
const account = vi.hoisted(() => ({ getActiveAccount: vi.fn() }));

vi.mock("@/lib/dev/simulated-sale", () => ({ SIMULATE_SALE_PATH: "/dev/simulate-sale", ...simulated }));
vi.mock("@/lib/team/account-context", () => account);

import { GET, POST } from "@/app/dev/simulate-sale/route";

const URL_ = "http://localhost:3000/dev/simulate-sale";

function form(fields: Record<string, string>): Request {
  return new Request(URL_, { method: "POST", body: new URLSearchParams(fields) });
}

describe("/dev/simulate-sale outside development", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    account.getActiveAccount.mockResolvedValue({ accountId: "seller", role: "owner" });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("answers 404 to every way in, and never reaches a session or a write", async () => {
    const requests = [
      () => GET(new Request(URL_)),
      () => POST(form({ productId: "p", view: "buyer" })),
      () => POST(form({ action: "clear-reviews" })),
      () =>
        POST(
          new Request(URL_, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ view: "buyer" }),
          }),
        ),
    ];
    for (const request of requests) {
      expect((await request()).status).toBe(404);
    }
    expect(account.getActiveAccount).not.toHaveBeenCalled();
    expect(simulated.simulateSale).not.toHaveBeenCalled();
    expect(simulated.deleteSimulatedReviews).not.toHaveBeenCalled();
  });
});

describe("/dev/simulate-sale in development", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "development");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("still needs a seller who may write products", async () => {
    account.getActiveAccount.mockResolvedValue(null);
    expect((await POST(form({ action: "clear-reviews" }))).status).toBe(401);
    account.getActiveAccount.mockResolvedValue({ accountId: "seller", role: "viewer" });
    expect((await POST(form({ productId: "p", view: "buyer" }))).status).toBe(401);
    expect(simulated.simulateSale).not.toHaveBeenCalled();
    expect(simulated.deleteSimulatedReviews).not.toHaveBeenCalled();
  });

  it("deletes only the signed-in store's pretend reviews", async () => {
    account.getActiveAccount.mockResolvedValue({ accountId: "seller", role: "owner" });
    simulated.deleteSimulatedReviews.mockResolvedValue(2);
    const response = await POST(form({ action: "clear-reviews" }));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/dev/simulate-sale?cleared=2");
    expect(simulated.deleteSimulatedReviews).toHaveBeenCalledWith("seller");
  });
});
