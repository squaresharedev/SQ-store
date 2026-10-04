import * as React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { Trash2, Ticket } from "lucide-react";
import { renderWithoutToasts, screen, cleanup, within } from "../setup/render";
import { ChoiceCards } from "@/components/ui/ChoiceCards";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Disclosure } from "@/components/ui/Disclosure";
import { HeroMark } from "@/components/ui/HeroMark";
import { Modal, ModalActions } from "@/components/ui/modal";

afterEach(cleanup);

/**
 * The parts every dialog is assembled from (styles.md §8.14). The Modal's
 * focus contract has its own file (modal.test.tsx), which these additions must
 * leave passing untouched.
 */

describe("Modal: visual, size and actions", () => {
  it("shows the visual inside the dialog, above its title", () => {
    renderWithoutToasts(
      <Modal open onClose={vi.fn()} title="Delete it?" visual={<span data-testid="visual" />}>
        <button>Action</button>
      </Modal>,
    );
    const dialog = screen.getByRole("dialog");
    const visual = within(dialog).getByTestId("visual");
    const title = within(dialog).getByRole("heading", { name: "Delete it?" });
    expect(visual.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("with a visual, focus still lands on the first real control and Close still closes", async () => {
    const onClose = vi.fn();
    renderWithoutToasts(
      <Modal open onClose={onClose} title="T" visual={<HeroMark icon={Ticket} />}>
        <button>Action</button>
      </Modal>,
    );
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Action" }));
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("is the default width unless a size is given", () => {
    const { rerender } = renderWithoutToasts(
      <Modal open onClose={vi.fn()} title="T">
        <p>Body</p>
      </Modal>,
    );
    expect(screen.getByRole("dialog").className).toContain("sm:max-w-md");
    rerender(
      <Modal open onClose={vi.fn()} title="T" size="xl">
        <p>Body</p>
      </Modal>,
    );
    expect(screen.getByRole("dialog").className).toContain("sm:max-w-xl");
    expect(screen.getByRole("dialog").className).not.toContain("sm:max-w-md");
  });

  it("ModalActions keeps the primary action last in the markup", () => {
    renderWithoutToasts(
      <Modal open onClose={vi.fn()} title="T">
        <ModalActions>
          <button>Cancel</button>
          <button>Save</button>
        </ModalActions>
      </Modal>,
    );
    const [first, second] = within(screen.getByRole("dialog"))
      .getAllByRole("button")
      .filter((button) => button.getAttribute("aria-label") !== "Close");
    expect(first).toHaveTextContent("Cancel");
    expect(second).toHaveTextContent("Save");
  });
});

describe("HeroMark", () => {
  it("is decorative, and carries its tone", () => {
    const { container } = renderWithoutToasts(<HeroMark icon={Ticket} tone="danger" badge={Trash2} />);
    const mark = container.querySelector("[data-hero-mark]") as HTMLElement;
    expect(mark).toHaveAttribute("aria-hidden", "true");
    expect(mark).toHaveAttribute("data-hero-mark", "danger");
    // The glyph and the corner badge's glyph.
    expect(mark.querySelectorAll("svg")).toHaveLength(2);
  });

  it("shows children as they are when there is no icon", () => {
    const { container } = renderWithoutToasts(
      <HeroMark>
        <span data-testid="the-thing-itself" />
      </HeroMark>,
    );
    const mark = container.querySelector("[data-hero-mark]") as HTMLElement;
    expect(mark.querySelector('[data-testid="the-thing-itself"]')).toBeTruthy();
    expect(mark.className).not.toContain("rounded-full");
  });
});

describe("ConfirmDialog", () => {
  function renderConfirm(props: Partial<React.ComponentProps<typeof ConfirmDialog>> = {}) {
    const onClose = vi.fn();
    const onConfirm = vi.fn();
    renderWithoutToasts(
      <ConfirmDialog
        open
        onClose={onClose}
        onConfirm={onConfirm}
        visual={<HeroMark icon={Ticket} />}
        title="Delete this discount?"
        description="It stops applying straight away."
        confirmLabel="Delete discount"
        {...props}
      />,
    );
    return { onClose, onConfirm };
  }

  it("asks its question, with the one sentence as the dialog's description", () => {
    renderConfirm();
    const dialog = screen.getByRole("dialog", { name: "Delete this discount?" });
    expect(dialog).toHaveAccessibleDescription("It stops applying straight away.");
  });

  it("confirms and cancels", async () => {
    const { onClose, onConfirm } = renderConfirm();
    await userEvent.click(screen.getByRole("button", { name: "Delete discount" }));
    expect(onConfirm).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("danger: the destructive button, and focus on the inert panel so a stray Enter does nothing", async () => {
    const { onClose, onConfirm } = renderConfirm({ tone: "danger" });
    expect(document.activeElement).toBe(screen.getByRole("dialog"));
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard(" ");
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("while it runs, neither button can be pressed and the action says so", () => {
    renderConfirm({ pending: true, pendingLabel: "Deleting…" });
    expect(screen.getByRole("button", { name: "Deleting…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });

  it("with an action, the body is that form and the button submits it with its fields", async () => {
    const action = vi.fn();
    renderConfirm({
      action,
      onConfirm: undefined,
      children: <input type="hidden" name="factor_id" value="abc" />,
    });
    const submit = screen.getByRole("button", { name: "Delete discount" });
    expect(submit).toHaveAttribute("type", "submit");
    expect(submit.closest("form")?.querySelector('input[name="factor_id"]')).toBeTruthy();
  });
});

describe("ChoiceCards: tiles", () => {
  function Tiles({ detached = false }: { detached?: boolean }) {
    const [value, setValue] = React.useState<"a" | "b" | null>(null);
    return (
      <form>
        <ChoiceCards
          name="choice"
          legend="Pick one"
          legendHidden
          variant="tiles"
          columns={2}
          detached={detached}
          optionDataAttribute="data-choice"
          options={[
            { value: "a", label: "First", icon: <svg data-testid="icon-a" /> },
            { value: "b", label: "Second", icon: <svg data-testid="icon-b" /> },
          ]}
          value={value}
          onChange={setValue}
        />
      </form>
    );
  }

  it("is still a radio group, named by its hidden legend", () => {
    renderWithoutToasts(<Tiles />);
    expect(screen.getByRole("group", { name: "Pick one" })).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(2);
    expect(screen.getByTestId("icon-a")).toBeInTheDocument();
  });

  it("choosing a tile checks its radio, found by its data attribute", async () => {
    const { container } = renderWithoutToasts(<Tiles />);
    await userEvent.click(container.querySelector('[data-choice="b"]') as HTMLElement);
    expect(screen.getByRole("radio", { name: "Second" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "First" })).not.toBeChecked();
  });

  it("detached radios are not fields of the form around them", () => {
    const { container, rerender } = renderWithoutToasts(<Tiles />);
    const form = container.querySelector("form") as HTMLFormElement;
    expect(form.elements).toHaveLength(3); // the fieldset and its two radios
    rerender(<Tiles detached />);
    expect(Array.from(form.elements).filter((el) => el instanceof HTMLInputElement)).toHaveLength(0);
  });

  it("cards (the default) keep the visible radio and the visible legend", () => {
    renderWithoutToasts(
      <ChoiceCards
        name="choice"
        legend="Why?"
        options={[{ value: "a", label: "First", hint: "A hint" }]}
        value={null}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText("Why?")).not.toHaveClass("sr-only");
    expect(screen.getByRole("radio", { name: /First/ })).not.toHaveClass("sr-only");
    expect(screen.getByText("A hint")).toBeInTheDocument();
  });
});

describe("Disclosure", () => {
  it("is a native details: the gist shows, the rest is folded until opened", async () => {
    const { container } = renderWithoutToasts(
      <Disclosure summary="Can't scan it?">
        <p>Enter this key instead.</p>
      </Disclosure>,
    );
    const details = container.querySelector("details") as HTMLDetailsElement;
    expect(details.open).toBe(false);
    await userEvent.click(screen.getByText("Can't scan it?"));
    expect(details.open).toBe(true);
  });

  it("can be opened from outside, and keeps a folded field in its form", () => {
    const { container } = renderWithoutToasts(
      <form>
        <Disclosure summary="Name" open>
          <input name="name" defaultValue="Passkey" />
        </Disclosure>
      </form>,
    );
    expect((container.querySelector("details") as HTMLDetailsElement).open).toBe(true);
    const form = container.querySelector("form") as HTMLFormElement;
    expect(new FormData(form).get("name")).toBe("Passkey");
  });
});
