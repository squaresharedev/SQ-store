/**
 * BioForm — the account's public bio, edited in Settings › Account next to
 * the username rather than in Business & seller details. Same SET-01
 * retention shape as TaxSection/UsernameForm: a failed save must not revert
 * what was typed.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "../setup/render";
import userEvent from "@testing-library/user-event";
import { failed, invalidInput } from "@/lib/errors";
import { msg } from "@/i18n/types";

afterEach(cleanup);

const mockUpdateBio = vi.hoisted(() => vi.fn().mockResolvedValue({}));
vi.mock("@/lib/settings/actions", () => ({
  updateBio: mockUpdateBio,
}));

const { BioForm } = await import("@/components/settings/BioForm");

beforeEach(() => {
  vi.clearAllMocks();
  mockUpdateBio.mockResolvedValue({});
});

describe("BioForm — initial state", () => {
  it("seeds the field from the saved prop and counts down from 100", () => {
    render(<BioForm bio="Hand-thrown stoneware" />);
    expect(screen.getByLabelText("Bio")).toHaveValue("Hand-thrown stoneware");
    expect(screen.getByText(`${100 - "Hand-thrown stoneware".length} characters left`)).toBeInTheDocument();
  });

  it("an unset bio starts blank with the full 100 available", () => {
    render(<BioForm bio="" />);
    expect(screen.getByLabelText("Bio")).toHaveValue("");
    expect(screen.getByText("100 characters left")).toBeInTheDocument();
  });

  it("is a 2-row textarea with a thinner-than-default border", () => {
    render(<BioForm bio="" />);
    const field = screen.getByLabelText("Bio");
    expect(field.tagName).toBe("TEXTAREA");
    expect(field).toHaveAttribute("rows", "2");
    // Inline, not a class: guaranteed to win over the shared Textarea's own
    // border-2, regardless of Tailwind's own class-order.
    expect(field).toHaveStyle({ borderWidth: "1px" });
  });

  it("marks itself optional with grey text beside the label, not a sentence", () => {
    render(<BioForm bio="" />);
    const mark = screen.getByText("(Optional)");
    expect(mark).toHaveClass("text-muted-foreground");
    // Not folded into the card's own description paragraph.
    expect(screen.queryByText(/publish without it/i)).not.toBeInTheDocument();
  });

  it("has no em dash anywhere in its copy", () => {
    render(<BioForm bio="" />);
    expect(document.body.textContent).not.toMatch(/—/);
  });
});

describe("BioForm — SET-01: field retention after a failed save", () => {
  it("keeps what the user typed after the server rejects", async () => {
    mockUpdateBio.mockResolvedValue(
      failed(invalidInput(msg("Validation.text.bio.tooLong", { maximum: 100 }))),
    );
    const user = userEvent.setup();
    render(<BioForm bio="Old bio" />);

    const field = screen.getByLabelText("Bio");
    await user.clear(field);
    await user.type(field, "SHOULD SURVIVE");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(field).toHaveValue("SHOULD SURVIVE");
  });
});

describe("BioForm — is never part of the trader identity", () => {
  it("posts through updateBio, not saveTaxInfo", async () => {
    const user = userEvent.setup();
    render(<BioForm bio="" />);
    await user.type(screen.getByLabelText("Bio"), "New bio");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(mockUpdateBio).toHaveBeenCalled();
  });
});
