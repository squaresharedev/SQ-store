import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "../setup/render";
import { TermsChangeNotice } from "@/components/legal/TermsChangeNotice";
import { TermsNoticeBanner } from "@/components/settings/TermsNoticeBanner";

afterEach(cleanup);

const OLD = "tos-2026-10-11";
const NEW = "tos-2026-10-31";
const DATED = { version: NEW, effectiveAt: "2026-12-02T03:23:00Z" };

describe("TermsNoticeBanner", () => {
  it("names the date to someone who agreed to the old Terms, and links to the details", () => {
    render(<TermsNoticeBanner upcoming={DATED} acceptedVersion={OLD} />);
    expect(screen.getByText("Our Terms change on 2 December 2026.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See what's changing" })).toHaveAttribute("href", "/settings/legal");
  });

  it("says soon while the notices are still going out", () => {
    render(<TermsNoticeBanner upcoming={{ version: NEW, effectiveAt: null }} acceptedVersion={OLD} />);
    expect(screen.getByText("Our Terms are changing soon.")).toBeInTheDocument();
  });

  it("goes away once they have agreed to the new Terms", () => {
    const { container } = render(<TermsNoticeBanner upcoming={DATED} acceptedVersion={NEW} />);
    expect(container.querySelector("[data-terms-notice-banner]")).toBeNull();
  });

  it("stays out of the way when nothing is coming, or when the welcome flow will ask", () => {
    const { container, rerender } = render(<TermsNoticeBanner upcoming={null} acceptedVersion={OLD} />);
    expect(container.querySelector("[data-terms-notice-banner]")).toBeNull();
    rerender(<TermsNoticeBanner upcoming={DATED} acceptedVersion={null} />);
    expect(container.querySelector("[data-terms-notice-banner]")).toBeNull();
  });
});

describe("TermsChangeNotice", () => {
  it("gives the date, both versions, what changes and the way out", () => {
    render(<TermsChangeNotice upcoming={DATED} />);
    expect(screen.getByRole("heading", { name: "Our Terms change on 2 December 2026." })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "current Terms" })).toHaveAttribute("href", "https://squareshare.eu/terms/");
    expect(screen.getByRole("link", { name: "new Terms" })).toHaveAttribute("href", `https://squareshare.eu/terms/v/${NEW}/`);
    expect(screen.getByText(/We now operate only in the EU, the USA and Canada/)).toBeInTheDocument();
    expect(screen.getByText(/close your account at no charge/)).toBeInTheDocument();
  });
});
