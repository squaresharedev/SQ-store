// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// The two order emails, as the recipient reads them. sendEmail is replaced so
// the message itself can be read; everything that builds it is real.

const sendEmailMock = vi.fn();
vi.mock("@/lib/email/send", () => ({
  sendEmail: (...args: unknown[]) => sendEmailMock(...args),
}));

import { sendNewOrderEmail, sendShippedEmail } from "@/lib/orders/emails";
import type { OutboundEmail } from "@/lib/email/send";

const ORDER_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const ADDRESS = {
  name: "Aoife Byrne",
  line1: "12 Harbour Road",
  city: "Dublin",
  postalCode: "D02 X285",
  country: "IE",
  phone: "+353 87 123 4567",
};

function sent(): OutboundEmail {
  return sendEmailMock.mock.calls.at(-1)![0] as OutboundEmail;
}

beforeEach(() => {
  sendEmailMock.mockReset();
  sendEmailMock.mockResolvedValue({ sent: true });
  process.env.NEXT_PUBLIC_APP_URL = "https://store.example";
});

describe("the seller's new-order email", () => {
  const order = {
    orderId: ORDER_ID,
    productTitle: "Blue mug",
    quantity: 2,
    selection: [{ label: "Size", value: "Large" }],
    ships: true,
    shipTo: ADDRESS,
    amountCents: 4200,
    currency: "EUR",
    buyerEmail: "aoife.byrne@example.test",
  };

  it("says what to pack and where it goes, without opening the dashboard", async () => {
    const result = await sendNewOrderEmail("seller@example.test", "en", order);
    expect(result).toEqual({ sent: true });
    const mail = sent();
    expect(mail.to).toBe("seller@example.test");
    expect(mail.subject).toBe("New order: ship 2 × Blue mug to Dublin");
    expect(mail.text).toContain("2 × Blue mug\nSize: Large");
    expect(mail.text).toContain("Aoife Byrne\n12 Harbour Road\nDublin\nD02 X285\nIreland");
    expect(mail.text).toContain("Phone: +353 87 123 4567");
    expect(mail.text).toContain("Buyer: aoife.byrne@example.test");
    expect(mail.text).toContain("€42.00");
    expect(mail.text).toContain(`https://store.example/orders?order=${ORDER_ID}`);
    // Mail to the seller is ours, not sent on anyone's behalf.
    expect(mail.replyTo).toBeUndefined();
  });

  it("says so when the address is missing, instead of printing half a label", async () => {
    await sendNewOrderEmail("seller@example.test", "en", { ...order, shipTo: null });
    expect(sent().subject).toBe("New order: Blue mug");
    expect(sent().text).toContain("There's no delivery address on this order.");
  });

  it("tells a download's seller there is nothing to ship", async () => {
    await sendNewOrderEmail("seller@example.test", "en", {
      ...order,
      ships: false,
      shipTo: null,
      selection: [],
    });
    expect(sent().subject).toBe("New order: Blue mug");
    expect(sent().text).toContain("It's a download, so there's nothing to ship.");
    expect(sent().text).not.toContain("What to pack");
  });

  it("never throws when the mail cannot go", async () => {
    sendEmailMock.mockRejectedValueOnce(new Error("provider down"));
    await expect(sendNewOrderEmail("seller@example.test", "en", order)).resolves.toEqual({
      sent: false,
      reason: "failed",
    });
  });
});

describe("the buyer's shipped email", () => {
  const shipped = {
    kind: "shipped" as const,
    productTitle: "Blue mug",
    quantity: 1,
    selection: [],
    trackingNumber: "RR123456789IE",
    shipTo: ADDRESS,
    store: { name: "Harbour Pottery", contactEmail: "hello@harbour.example" },
  };

  it("comes from the store, and replies reach the seller", async () => {
    await sendShippedEmail("aoife.byrne@example.test", "en", shipped);
    const mail = sent();
    expect(mail.to).toBe("aoife.byrne@example.test");
    expect(mail.subject).toBe("Your order from Harbour Pottery is on its way");
    expect(mail.fromName).toBe("Harbour Pottery via Square Share");
    expect(mail.replyTo).toBe("hello@harbour.example");
    expect(mail.text).toContain("Tracking number: RR123456789IE");
    expect(mail.text).toContain("12 Harbour Road");
    expect(mail.text).toContain("Reply to this email to reach Harbour Pottery.");
  });

  it("announces a tracking number added later as exactly that", async () => {
    await sendShippedEmail("aoife.byrne@example.test", "en", { ...shipped, kind: "tracking" });
    expect(sent().subject).toBe("Tracking for your order from Harbour Pottery");
    expect(sent().text).toContain("Harbour Pottery has added a tracking number to your order.");
  });

  it("does not offer a reply the seller cannot receive", async () => {
    await sendShippedEmail("aoife.byrne@example.test", "en", {
      ...shipped,
      trackingNumber: null,
      store: { name: "Harbour Pottery", contactEmail: null },
    });
    expect(sent().replyTo).toBeUndefined();
    expect(sent().text).not.toContain("Reply to this email");
    expect(sent().text).not.toContain("Tracking number");
  });
});
