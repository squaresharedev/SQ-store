/**
 * WelcomeFlow: the dashboard's first-visit dialog.
 *
 * What these pin: the slides and their ways out (a welcome, the four-step path,
 * then the seller details form); every way FORWARD starting the guided tour and
 * "Skip onboarding" (on every slide) never doing so; the seller step posting
 * EXACTLY the three trader-identity fields (the save action writes only what it
 * is sent, so a stray fourth key here would blank a column the step never
 * showed); and the confirmation panel when a link is on its way.
 */

import type { ComponentProps } from "react";
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { render, screen, cleanup, waitFor, within } from "../setup/render";

afterEach(cleanup);

// jsdom does not implement window.matchMedia; motion's reduced-motion hook reads it.
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

const mockRefresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: mockRefresh }),
  usePathname: () => "/dashboard",
  useSearchParams: () => new URLSearchParams(),
}));

// The real module is a "use server" file over the Supabase server client. The
// flow only needs the two references as defaults; every test injects its own.
vi.mock("@/lib/settings/actions", () => ({
  saveTaxInfo: vi.fn(),
  resendSellerEmailVerification: vi.fn(),
}));

// Steps swap instantly under reduced motion, so no test waits on an exit
// animation that jsdom never finishes.
vi.mock("motion/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("motion/react")>()),
  useReducedMotion: () => true,
}));

const { WelcomeFlow } = await import("@/components/onboarding/WelcomeFlow");
const { SETUP_PATH } = await import("@/components/onboarding/WelcomeVisuals");

type Props = ComponentProps<typeof WelcomeFlow>;

function renderFlow(overrides: Partial<Props> = {}) {
  const props: Props = {
    open: true,
    onClose: vi.fn(),
    onStartTour: vi.fn(),
    includeSellerStep: true,
    seller: { businessName: "", address: "", email: "" },
    emailVerified: false,
    verificationOn: false,
    saveAction: vi.fn(async () => ({ success: "Business & seller details saved." })),
    resendAction: vi.fn(async () => ({ success: "Sent." })),
    ...overrides,
  };
  render(<WelcomeFlow {...props} />);
  return props;
}

type User = ReturnType<typeof userEvent.setup>;

/** From the path slide on to the form. */
async function pathToSellerStep(user: User) {
  await user.click(
    within(screen.getByRole("dialog", { name: "Four steps to your first page" })).getByRole(
      "button",
      { name: "Get started" },
    ),
  );
  return screen.getByRole("dialog", { name: "Add your seller details" });
}

/** Welcome, then the path, then the form. */
async function toSellerStep(user: User) {
  await user.click(screen.getByRole("button", { name: "Next" }));
  return pathToSellerStep(user);
}

async function fillSellerDetails(user: User) {
  const dialog = screen.getByRole("dialog", { name: "Add your seller details" });
  await user.type(within(dialog).getByLabelText("Trader name"), "Welcome Studio");
  await user.type(within(dialog).getByLabelText("Business address"), "12 Market Street");
  await user.type(within(dialog).getByLabelText("Contact email"), "hello@studio.eu");
}

describe("WelcomeFlow", () => {
  it("opens on a welcome slide that is a picture and one line, not a list", () => {
    renderFlow();
    const dialog = screen.getByRole("dialog", { name: "Welcome to Square Share" });
    expect(within(dialog).getByRole("progressbar", { name: "Step 1 of 3" })).toBeInTheDocument();
    expect(
      within(dialog).getByText("Give every product its own page, and share it anywhere."),
    ).toBeInTheDocument();
    // The four steps have a slide of their own now.
    expect(within(dialog).queryByRole("list")).toBeNull();
    expect(within(dialog).queryByText("Add a product")).toBeNull();
  });

  it("lays the four steps out as a timeline on the next slide", async () => {
    const user = userEvent.setup();
    renderFlow();
    await user.click(screen.getByRole("button", { name: "Next" }));

    const dialog = screen.getByRole("dialog", { name: "Four steps to your first page" });
    expect(within(dialog).getByRole("progressbar", { name: "Step 2 of 3" })).toBeInTheDocument();
    const steps = within(within(dialog).getByRole("list")).getAllByRole("listitem");
    expect(steps.map((step) => step.textContent)).toEqual(SETUP_PATH.map((step) => step.label));

    await user.click(within(dialog).getByRole("button", { name: "Back" }));
    expect(screen.getByRole("dialog", { name: "Welcome to Square Share" })).toBeInTheDocument();
  });

  it("skips all of onboarding from the first slide, without starting the tour", async () => {
    const user = userEvent.setup();
    const props = renderFlow();
    await user.click(screen.getByRole("button", { name: "Skip onboarding" }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(props.onStartTour).not.toHaveBeenCalled();
  });

  it("offers Skip onboarding on every slide", async () => {
    const user = userEvent.setup();
    const props = renderFlow();
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(
      within(screen.getByRole("dialog", { name: "Four steps to your first page" })).getByRole(
        "button",
        { name: "Skip onboarding" },
      ),
    ).toBeInTheDocument();

    const seller = await pathToSellerStep(user);
    await user.click(within(seller).getByRole("button", { name: "Skip onboarding" }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(props.onStartTour).not.toHaveBeenCalled();
  });

  it("posts exactly the three trader-identity fields, then starts the tour", async () => {
    const user = userEvent.setup();
    const props = renderFlow();
    await toSellerStep(user);
    expect(screen.getByRole("progressbar", { name: "Step 3 of 3" })).toBeInTheDocument();

    const save = () => screen.getByRole("button", { name: "Save and continue" });
    expect(save()).toBeDisabled();
    await fillSellerDetails(user);
    expect(save()).toBeEnabled();
    await user.click(save());

    await waitFor(() => expect(props.onStartTour).toHaveBeenCalledTimes(1));
    const formData = vi.mocked(props.saveAction!).mock.calls[0]![1];
    expect([...formData.keys()].sort()).toEqual([
      "seller_address",
      "seller_email",
      "tax_business_name",
    ]);
    expect(formData.get("tax_business_name")).toBe("Welcome Studio");
    expect(props.onClose).not.toHaveBeenCalled();
    // Overview renders the checklist and the gate on the server.
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it("says where the confirmation link went, with a resend, before the tour", async () => {
    const user = userEvent.setup();
    const props = renderFlow({ verificationOn: true });
    await toSellerStep(user);
    await fillSellerDetails(user);
    await user.click(screen.getByRole("button", { name: "Save and continue" }));

    const dialog = screen.getByRole("dialog", { name: "Add your seller details" });
    expect(
      await within(dialog).findByText("Check hello@studio.eu for a confirmation link."),
    ).toBeInTheDocument();
    // Waiting on the link is not the end of the dialog.
    expect(props.onStartTour).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Send a new link" }));
    await waitFor(() => expect(props.resendAction).toHaveBeenCalledTimes(1));

    await user.click(within(dialog).getByRole("button", { name: "Continue" }));
    expect(props.onStartTour).toHaveBeenCalledTimes(1);
  });

  it("lets a seller skip just the details and still get the tour", async () => {
    const user = userEvent.setup();
    const props = renderFlow();
    await toSellerStep(user);
    await user.click(screen.getByRole("button", { name: "Skip for now" }));
    expect(props.onStartTour).toHaveBeenCalledTimes(1);
    expect(props.onClose).not.toHaveBeenCalled();
    expect(props.saveAction).not.toHaveBeenCalled();
  });

  it("with details already on file, goes from the path straight to the tour", async () => {
    const user = userEvent.setup();
    const props = renderFlow({ includeSellerStep: false });
    expect(screen.getByRole("progressbar", { name: "Step 1 of 2" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next" }));

    const dialog = screen.getByRole("dialog", { name: "Four steps to your first page" });
    expect(within(dialog).queryByRole("button", { name: "Get started" })).toBeNull();
    await user.click(within(dialog).getByRole("button", { name: "Show me around" }));
    expect(props.onStartTour).toHaveBeenCalledTimes(1);
  });
});
