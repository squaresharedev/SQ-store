/**
 * The Terms of Service agreement outside the welcome flow: TermsSummary's
 * "read to the end" signal, and Settings › Legal, which records the same
 * agreement the same way (button shut until read, exactly the version shown).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { cleanup, fireEvent, render, screen, waitFor, within } from "../setup/render";
import { english } from "../setup/translate";
import { TERMS_LAST_UPDATED, TERMS_SUMMARY } from "@/lib/legal/terms-summary";
import { LEGAL_VERSION } from "@/lib/settings/constants";

const acceptLegalMock = vi.hoisted(() =>
  vi.fn(async () => ({ success: "You've agreed to the Terms of Service." })),
);
vi.mock("@/lib/settings/actions", () => ({ acceptLegal: acceptLegalMock }));

const { TermsSummary } = await import("@/components/legal/TermsSummary");
const { LegalSection } = await import("@/components/settings/LegalSection");

afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

const AGREE = "I have read and agree to the Terms";

/** jsdom lays nothing out, so the summary box is given its geometry. */
function layOut(box: HTMLElement, { client, content, top }: { client: number; content: number; top: number }) {
  Object.defineProperty(box, "clientHeight", { configurable: true, value: client });
  Object.defineProperty(box, "scrollHeight", { configurable: true, value: content });
  Object.defineProperty(box, "scrollTop", { configurable: true, value: top });
}

const summaryBox = () => document.querySelector<HTMLElement>("[data-terms-summary]")!;

describe("TermsSummary", () => {
  it("reports once, when the box is scrolled to its end", () => {
    const onReadToEnd = vi.fn();
    render(<TermsSummary onReadToEnd={onReadToEnd} />);

    layOut(summaryBox(), { client: 300, content: 900, top: 200 });
    fireEvent.scroll(summaryBox());
    expect(onReadToEnd).not.toHaveBeenCalled();

    layOut(summaryBox(), { client: 300, content: 900, top: 600 });
    fireEvent.scroll(summaryBox());
    fireEvent.scroll(summaryBox());
    expect(onReadToEnd).toHaveBeenCalledTimes(1);
  });

  it("never counts a box that has not laid out (zero height) as read", () => {
    const onReadToEnd = vi.fn();
    render(<TermsSummary onReadToEnd={onReadToEnd} />);
    // jsdom's own geometry: everything 0, which would otherwise read as "at the end".
    fireEvent.scroll(summaryBox());
    expect(onReadToEnd).not.toHaveBeenCalled();
  });

  it("is a keyboard-scrollable region with the full Terms and Privacy Policy linked", () => {
    render(<TermsSummary onReadToEnd={() => {}} />);
    const region = screen.getByRole("region", { name: "Terms of Service, short version" });
    expect(region).toHaveAttribute("tabindex", "0");
    const links = screen.getAllByRole("link").map((link) => link.getAttribute("href"));
    expect(links).toContain("https://squareshare.eu/terms/");
    expect(links).toContain("https://squareshare.eu/legal/privacy-policy/");
  });
});

/** The English summary, verbatim: legal text, so it must never drift. */
const ENGLISH_SUMMARY: readonly { heading: string; points: readonly string[] }[] = [
  {
    heading: "Who you're dealing with",
    points: [
      "Square Share is a platform that helps you sell. When a buyer orders from you, the sale is between you and that buyer: you are the seller and merchant of record, not us.",
      "You must be at least 18, or the age of majority where you live. If you sign up for a business, you confirm you can bind it to these Terms.",
    ],
  },
  {
    heading: "Your account",
    points: [
      "Keep your details accurate and your sign-in secure. You are responsible for what happens under your account, so tell us straight away if you think someone else got in.",
      "Before anything goes live, you give us your trader name, a postal address and a contact email that you confirm. Buyers see these on your product pages, because consumer law requires it.",
    ],
  },
  {
    heading: "Selling",
    points: [
      "List accurately, and only sell lawful things you have the right to sell.",
      "Honour your buyers' consumer rights, including the 14-day right of withdrawal and the legal guarantee, and handle your own delivery, support and refunds.",
      "Taxes and VAT on your sales are yours to handle, and you keep your own sales records for 10 years.",
    ],
  },
  {
    heading: "Payments",
    points: [
      "Payments run through Stripe, into your own Stripe account, under Stripe's own terms. We never hold your money.",
      "We take a platform fee on each sale, as shown in your dashboard. Chargebacks and disputes are between you, your buyer and Stripe.",
    ],
  },
  {
    heading: "What's not allowed",
    points: [
      "Illegal, counterfeit or infringing products, malware, hateful content and adult content.",
      "Fraud, dodging platform fees, scraping, using anyone's content to train AI models, or attacking the service.",
      "Hiding or changing what Square Share shows buyers, such as your seller details, prices or legal notices.",
    ],
  },
  {
    heading: "Your content",
    points: [
      "What you upload stays yours. You give us a licence to host and show it, only to run and promote Square Share.",
    ],
  },
  {
    heading: "Liability, changes and the law",
    points: [
      "Square Share is early and offered as is to business users. For them, our liability is capped at the fees paid to us in the last 12 months or EUR 100, whichever is greater, and business sellers cover us for claims caused by their products, sites or breaches. If you are a consumer, your legal rights are unaffected.",
      "We can suspend or close accounts that break these Terms. You can leave at any time and take your data with you.",
      "We may update these Terms, with advance notice of material changes. Czech law applies.",
      "Our Privacy Policy and Cookie Policy form part of these Terms.",
    ],
  },
];

describe("TermsSummary English copy", () => {
  it("resolves every section key to the English summary, in order", () => {
    expect(
      TERMS_SUMMARY.map((section) => ({
        heading: english(section.heading),
        points: section.points.map((point) => english(point)),
      })),
    ).toEqual(ENGLISH_SUMMARY);
  });

  it("renders each heading and point exactly", () => {
    render(<TermsSummary onReadToEnd={() => {}} />);
    const region = screen.getByRole("region", { name: "Terms of Service, short version" });
    const sections = region.querySelectorAll("section");
    expect(sections).toHaveLength(ENGLISH_SUMMARY.length);
    sections.forEach((section, index) => {
      expect(section.querySelector("h3")?.textContent).toBe(ENGLISH_SUMMARY[index].heading);
      expect([...section.querySelectorAll("li")].map((li) => li.textContent)).toEqual(
        ENGLISH_SUMMARY[index].points,
      );
    });
  });

  it("prints the last-updated line and the links around the summary", () => {
    render(<TermsSummary onReadToEnd={() => {}} />);
    const intro = document.querySelector("[data-terms-full-link]")!.closest("p")!;
    expect(intro.textContent).toBe(
      "The short version, in plain language. Last updated 9 September 2026. Read the full Terms of Service (opens in a new tab)",
    );
    expect(TERMS_LAST_UPDATED).toBe("2026-09-09");

    const region = screen.getByRole("region", { name: "Terms of Service, short version" });
    const footer = region.querySelector("p")!;
    expect(footer.textContent).toBe(
      "This summary is here to help you read them. What you agree to is the full Terms of Service and Privacy Policy.",
    );
    expect(within(footer).getByRole("link", { name: "Terms of Service" })).toHaveAttribute(
      "href",
      "https://squareshare.eu/terms/",
    );
    expect(within(footer).getByRole("link", { name: "Privacy Policy" })).toHaveAttribute(
      "href",
      "https://squareshare.eu/legal/privacy-policy/",
    );
  });
});

describe("LegalSection (Settings › Legal)", () => {
  it("asks for the agreement the same way as onboarding: shut until read, then the version shown", async () => {
    const user = userEvent.setup();
    render(<LegalSection acceptedAt={null} acceptedVersion={null} />);

    const agree = () => screen.getByRole("button", { name: AGREE });
    expect(agree()).toBeDisabled();

    layOut(summaryBox(), { client: 300, content: 900, top: 600 });
    fireEvent.scroll(summaryBox());
    expect(agree()).toBeEnabled();
    await user.click(agree());

    await waitFor(() => expect(acceptLegalMock).toHaveBeenCalledTimes(1));
    const formData = (acceptLegalMock.mock.calls[0] as unknown as [unknown, FormData])[1];
    expect([...formData.keys()]).toEqual(["version"]);
    expect(formData.get("version")).toBe(LEGAL_VERSION);
  });

  it("shows the agreement on file for the current version, with nothing to press", () => {
    render(
      <LegalSection acceptedAt="2026-09-24T10:00:00.000Z" acceptedVersion={LEGAL_VERSION} />,
    );
    expect(screen.getByText(/you agreed to version/i)).toHaveTextContent("24 September 2026");
    expect(screen.queryByRole("button", { name: AGREE })).toBeNull();
  });

  it("asks again when the Terms changed since the agreement on file", () => {
    render(<LegalSection acceptedAt="2026-09-01T10:00:00.000Z" acceptedVersion="2026-09-draft.2" />);
    expect(screen.getByText(/have changed since/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: AGREE })).toBeDisabled();
  });
});
