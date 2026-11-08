import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import userEvent from "@testing-library/user-event";
import { act, cleanup, render, screen } from "../setup/render";
import { DescriptionAiChip, type SuggestDescription } from "@/components/products/DescriptionAiChip";
import { failure } from "@/lib/errors";
import { msg } from "@/i18n/types";
import type { ListingFact } from "@/lib/suggestions/describe";

// The server action is never reached: every test hands the chip its own.
vi.mock("@/lib/products/describe-actions", () => ({ suggestProductDescription: vi.fn() }));

afterEach(cleanup);

const FACTS: ListingFact[] = [{ label: "Capacity", value: "350 ml" }];

/** The chip under a real description field, as the product form puts it. */
function Field({
  suggest,
  facts = FACTS,
  title = "Ceramic mug",
  creditUsed = false,
}: {
  suggest: SuggestDescription;
  facts?: ListingFact[];
  title?: string;
  creditUsed?: boolean;
}) {
  const [description, setDescription] = useState("");
  return (
    <>
      <textarea aria-label="Description" value={description} onChange={(event) => setDescription(event.target.value)} />
      <DescriptionAiChip
        title={title}
        description={description}
        facts={facts}
        creditUsed={creditUsed}
        onChange={setDescription}
        suggest={suggest}
      />
    </>
  );
}

/** A suggest that answers when the test says so. */
function deferred() {
  let answer: (value: Awaited<ReturnType<SuggestDescription>>) => void = () => {};
  const suggest = vi.fn<SuggestDescription>(() => new Promise((resolve) => (answer = resolve)));
  return { suggest, answer: (value: Awaited<ReturnType<SuggestDescription>>) => act(async () => answer(value)) };
}

const field = () => screen.getByRole("textbox", { name: "Description" });

describe("DescriptionAiChip", () => {
  it("shows nothing before there is a title", () => {
    render(<Field suggest={vi.fn()} title="  " />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("is shown, dimmed, until there is something to write from, and says why", async () => {
    const user = userEvent.setup();
    const suggest = vi.fn<SuggestDescription>();
    render(<Field suggest={suggest} facts={[]} />);
    const chip = screen.getByRole("button", { name: "Write with AI" });
    expect(chip).toHaveAttribute("aria-disabled", "true");
    expect(chip).toHaveAccessibleDescription(/not enough to write from yet/);
    await user.click(chip);
    expect(suggest).not.toHaveBeenCalled();
    expect(field()).toHaveValue("");

    // A first line to improve is something to work from.
    await user.type(field(), "nice mug");
    expect(screen.getByRole("button", { name: "Improve with AI" })).not.toHaveAttribute("aria-disabled");
  });

  it("says the month's credit is spent before a tap, not after one", async () => {
    const user = userEvent.setup();
    const suggest = vi.fn<SuggestDescription>();
    render(<Field suggest={suggest} creditUsed />);
    const chip = screen.getByRole("button", { name: "Write with AI" });
    expect(chip).toHaveAttribute("aria-disabled", "true");
    expect(chip).toHaveAccessibleDescription(/AI credit is used up/);
    await user.click(chip);
    expect(suggest).not.toHaveBeenCalled();
  });

  it("writes into the field, and the arrow takes it back", async () => {
    const user = userEvent.setup();
    const { suggest, answer } = deferred();
    render(<Field suggest={suggest} />);
    const chip = screen.getByRole("button", { name: "Write with AI" });
    expect(chip).toHaveAccessibleDescription(/adds nothing of its own/);

    await user.click(chip);
    expect(suggest).toHaveBeenCalledWith({ mode: "write", title: "Ceramic mug", text: "", facts: FACTS, language: "en" });
    expect(screen.getByRole("button", { name: "Writing…" })).toHaveAttribute("aria-busy", "true");
    await user.click(screen.getByRole("button", { name: "Writing…" }));
    expect(suggest).toHaveBeenCalledTimes(1);

    await answer({ ok: true, text: "A ceramic mug that holds 350 ml." });
    expect(field()).toHaveValue("A ceramic mug that holds 350 ml.");
    expect(screen.getByText("Written by AI")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(field()).toHaveValue("");
    expect(screen.getByRole("button", { name: "Write with AI" })).toBeInTheDocument();
  });

  it("improves what is there, and an edit since ends the undo", async () => {
    const user = userEvent.setup();
    const suggest = vi.fn<SuggestDescription>(async () => ({ ok: true, text: "A nice mug. Holds 350 ml." }));
    render(<Field suggest={suggest} facts={[]} />);
    await user.type(field(), "nice mug holds 350ml");
    await user.click(screen.getByRole("button", { name: "Improve with AI" }));
    expect(suggest.mock.calls[0]![0]).toMatchObject({ mode: "improve", text: "nice mug holds 350ml" });
    expect(screen.getByText("Improved by AI")).toBeInTheDocument();

    await user.type(field(), "!");
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
    expect(screen.getByRole("button", { name: "Improve with AI" })).toBeInTheDocument();
  });

  it("never writes over what the seller typed while it was asking", async () => {
    const user = userEvent.setup();
    const { suggest, answer } = deferred();
    render(<Field suggest={suggest} />);
    await user.click(screen.getByRole("button", { name: "Write with AI" }));
    await user.type(field(), "My own words");
    await answer({ ok: true, text: "A ceramic mug." });
    expect(field()).toHaveValue("My own words");
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it("says why when there is no draft, and can be asked again", async () => {
    const user = userEvent.setup();
    const suggest = vi.fn<SuggestDescription>(async () =>
      failure({ code: "server_error", message: msg("Errors.ai.unavailable.message"), fix: msg("Errors.ai.unavailable.fix") }),
    );
    render(<Field suggest={suggest} />);
    await user.click(screen.getByRole("button", { name: "Write with AI" }));
    expect(await screen.findByText("AI writing help isn't available right now.")).toBeInTheDocument();
    expect(field()).toHaveValue("");
    expect(screen.getByRole("button", { name: "Write with AI" })).toBeInTheDocument();
  });

  it("hands a keyboard user the arrow once the draft is in", async () => {
    const user = userEvent.setup();
    const { suggest, answer } = deferred();
    render(<Field suggest={suggest} />);
    screen.getByRole("button", { name: "Write with AI" }).focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("button", { name: "Writing…" })).toHaveFocus();
    await answer({ ok: true, text: "A ceramic mug." });
    expect(screen.getByRole("button", { name: "Undo" })).toHaveFocus();
  });
});
