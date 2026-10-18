// A Server Action is addressed by an id the build generates, so a tab left open
// across a deploy holds ids the new server has never heard of. Its next save
// throws into an error boundary, and "Try again" there replays the same dead
// id for as long as the tab lives. Both boundaries must recognise that one
// error and offer the only thing that fixes it: loading the new build.

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { UnrecognizedActionError } from "next/dist/client/components/unrecognized-action-error";
import { cleanup, render, screen } from "../setup/render";
import ErrorBoundary from "@/app/error";
import BuyerErrorBoundary from "@/app/(public)/error";

// jsdom does not implement window.matchMedia; the dashboard's ErrorScreen
// reads it. Same stub as background-editor.test.tsx.
beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const BOUNDARIES = [
  ["the dashboard's", ErrorBoundary],
  ["the buyer's", BuyerErrorBoundary],
] as const;

describe.each(BOUNDARIES)("%s error boundary", (_name, Boundary) => {
  it("offers a reload, not a retry, to a page left open across a deploy", async () => {
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });
    const retry = vi.fn();
    render(
      <Boundary
        error={new UnrecognizedActionError("Server Action was not found on the server.")}
        unstable_retry={retry}
        reset={retry}
      />,
    );

    expect(screen.getByRole("heading", { name: "This page has been updated" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /try again/i })).not.toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole("button", { name: "Reload page" }));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(retry).not.toHaveBeenCalled();
  });

  it("still offers a retry for every other error", async () => {
    const retry = vi.fn();
    render(<Boundary error={new Error("boom")} unstable_retry={retry} reset={vi.fn()} />);

    expect(screen.queryByText("This page has been updated")).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: /try again/i }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});

describe("the buyer's error boundary", () => {
  it("says nothing about an account or a dashboard", () => {
    render(<BuyerErrorBoundary error={new Error("boom")} reset={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "This page couldn't be loaded" })).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/signed in|your account|dashboard/i);
  });
});
