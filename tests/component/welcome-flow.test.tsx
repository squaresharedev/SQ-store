/**
 * WelcomeFlow: the dashboard's first-visit dialog.
 *
 * What these pin: the slides and their ways out (a welcome, the Terms, the
 * four-step path, then the seller details form); the Terms as a gate that
 * cannot be walked past (no skip, no close, no Esc until agreed) whose agree
 * button stays shut until the summary is read to its end, and which posts
 * exactly the version shown; every way FORWARD starting the guided tour and
 * "Skip onboarding" never doing so; the seller step posting EXACTLY the three
 * trader-identity fields (the save action writes only what it is sent, so a
 * stray fourth key here would blank a column the step never showed); and the
 * confirmation panel when a link is on its way.
 */

import type { ComponentProps } from "react";
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { render, screen, cleanup, fireEvent, waitFor, within } from "../setup/render";
import { english } from "../setup/translate";
import { msg } from "@/i18n/types";
import { LEGAL_LINKS } from "@/lib/legal/links";
import { LEGAL_VERSION } from "@/lib/settings/constants";

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
// flow only needs the references as defaults; every test injects its own.
vi.mock("@/lib/settings/actions", () => ({
  acceptLegal: vi.fn(),
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

const TERMS_DIALOG = "Our Terms of Service";
const AGREE = "I have read and agree to the Terms";

function renderFlow(overrides: Partial<Props> = {}) {
  const props: Props = {
    open: true,
    onClose: vi.fn(),
    onStartTour: vi.fn(),
    includeTermsStep: true,
    includeSellerStep: true,
    seller: { businessName: "", address: "", email: "" },
    emailVerified: false,
    verificationOn: false,
    acceptAction: vi.fn(async () => ({ success: msg("Settings.legal.success.termsAgreed") })),
    saveAction: vi.fn(async () => ({ success: msg("Settings.tax.success.sellerDetailsSaved") })),
    resendAction: vi.fn(async () => ({
      success: msg("Settings.tax.success.confirmationSent", { email: "shop@example.com" }),
    })),
    ...overrides,
  };
  render(<WelcomeFlow {...props} />);
  return props;
}

type User = ReturnType<typeof userEvent.setup>;

/**
 * Scroll the summary box to `position` (0 is the top, 1 the very end). jsdom
 * lays nothing out, so the box's geometry is given to it: 300px tall, holding
 * 900px of Terms.
 */
function scrollTerms(position: number) {
  const box = document.querySelector<HTMLElement>("[data-terms-summary]");
  expect(box, "the terms summary box").not.toBeNull();
  Object.defineProperty(box!, "clientHeight", { configurable: true, value: 300 });
  Object.defineProperty(box!, "scrollHeight", { configurable: true, value: 900 });
  Object.defineProperty(box!, "scrollTop", { configurable: true, value: 600 * position });
  fireEvent.scroll(box!);
}

/** From the welcome slide to the Terms. */
async function toTermsStep(user: User) {
  await user.click(screen.getByRole("button", { name: "Next" }));
  return screen.getByRole("dialog", { name: TERMS_DIALOG });
}

/** Read the Terms to the end and agree; lands on the path. */
async function agreeToTerms(user: User) {
  scrollTerms(1);
  await user.click(screen.getByRole("button", { name: AGREE }));
  return screen.findByRole("dialog", { name: "Four steps to your first page" });
}

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

/** Welcome, the Terms, the path, then the form. */
async function toSellerStep(user: User) {
  await toTermsStep(user);
  await agreeToTerms(user);
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
    expect(within(dialog).getByRole("progressbar", { name: "Step 1 of 4" })).toBeInTheDocument();
    expect(
      within(dialog).getByText("Give every product its own page, and share it anywhere."),
    ).toBeInTheDocument();
    // The picture's own words, hidden from assistive tech like the rest of it.
    expect(dialog).toHaveTextContent(/Buy now.*Live.*Link copied/);
    // The four steps have a slide of their own now.
    expect(within(dialog).queryByRole("list")).toBeNull();
    expect(within(dialog).queryByText("Add a product")).toBeNull();
  });

  it("lays the four steps out as a timeline once the Terms are agreed", async () => {
    const user = userEvent.setup();
    renderFlow();
    await toTermsStep(user);
    const dialog = await agreeToTerms(user);

    expect(within(dialog).getByRole("progressbar", { name: "Step 3 of 4" })).toBeInTheDocument();
    const steps = within(within(dialog).getByRole("list")).getAllByRole("listitem");
    expect(steps.map((step) => step.textContent)).toEqual(
      SETUP_PATH.map((step) => english(step.label)),
    );
    expect(steps.map((step) => step.textContent)).toEqual([
      "Add your details",
      "Add a product",
      "Design a storefront",
      "Share its page",
    ]);

    // Back to the Terms: already agreed, so it simply carries on.
    await user.click(within(dialog).getByRole("button", { name: "Back" }));
    const terms = screen.getByRole("dialog", { name: TERMS_DIALOG });
    expect(within(terms).queryByRole("button", { name: AGREE })).toBeNull();
    await user.click(within(terms).getByRole("button", { name: "Continue" }));
    expect(
      screen.getByRole("dialog", { name: "Four steps to your first page" }),
    ).toBeInTheDocument();
  });

  it("skips all of onboarding from the first slide once the Terms are on file", async () => {
    const user = userEvent.setup();
    const props = renderFlow({ includeTermsStep: false });
    await user.click(screen.getByRole("button", { name: "Skip onboarding" }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(props.onStartTour).not.toHaveBeenCalled();
  });

  it("offers Skip onboarding on every slide after the Terms", async () => {
    const user = userEvent.setup();
    const props = renderFlow();
    await toTermsStep(user);
    const path = await agreeToTerms(user);
    expect(within(path).getByRole("button", { name: "Skip onboarding" })).toBeInTheDocument();

    const seller = await pathToSellerStep(user);
    await user.click(within(seller).getByRole("button", { name: "Skip onboarding" }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(props.onStartTour).not.toHaveBeenCalled();
  });

  it("posts exactly the three trader-identity fields, then starts the tour", async () => {
    const user = userEvent.setup();
    const props = renderFlow();
    await toSellerStep(user);
    expect(screen.getByRole("progressbar", { name: "Step 4 of 4" })).toBeInTheDocument();

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
    expect(screen.getByRole("progressbar", { name: "Step 1 of 3" })).toBeInTheDocument();
    await toTermsStep(user);
    const dialog = await agreeToTerms(user);

    expect(within(dialog).queryByRole("button", { name: "Get started" })).toBeNull();
    await user.click(within(dialog).getByRole("button", { name: "Show me around" }));
    expect(props.onStartTour).toHaveBeenCalledTimes(1);
  });

  it("with the Terms already agreed, has no terms step at all", async () => {
    const user = userEvent.setup();
    renderFlow({ includeTermsStep: false });
    expect(screen.getByRole("progressbar", { name: "Step 1 of 3" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(
      screen.getByRole("dialog", { name: "Four steps to your first page" }),
    ).toBeInTheDocument();
  });
});

describe("WelcomeFlow: the Terms", () => {
  it("shows the short version with the full Terms one click away", async () => {
    const user = userEvent.setup();
    renderFlow();
    const dialog = await toTermsStep(user);
    expect(within(dialog).getByRole("progressbar", { name: "Step 2 of 4" })).toBeInTheDocument();

    const summary = within(dialog).getByRole("region", { name: "Terms of Service, short version" });
    expect(within(summary).getByRole("heading", { name: "Selling" })).toBeInTheDocument();

    const full = within(dialog).getByRole("link", { name: /read the full terms of service/i });
    expect(full).toHaveAttribute("href", LEGAL_LINKS.terms.href);
    expect(full).toHaveAttribute("target", "_blank");
    expect(full).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("keeps the agree button shut until the summary is read to its end", async () => {
    const user = userEvent.setup();
    const props = renderFlow();
    const dialog = await toTermsStep(user);
    const agree = () => within(dialog).getByRole("button", { name: AGREE });

    expect(agree()).toBeDisabled();
    expect(within(dialog).getByText("Scroll to the end of the summary to agree.")).toBeInTheDocument();

    // Halfway is not the end.
    scrollTerms(0.5);
    expect(agree()).toBeDisabled();

    scrollTerms(1);
    expect(agree()).toBeEnabled();
    expect(agree()).toHaveAccessibleDescription(/records the date and this version/i);
    expect(props.acceptAction).not.toHaveBeenCalled();
  });

  it("records the agreement with exactly the version shown, then moves on", async () => {
    const user = userEvent.setup();
    const props = renderFlow();
    await toTermsStep(user);
    await agreeToTerms(user);

    expect(props.acceptAction).toHaveBeenCalledTimes(1);
    const formData = vi.mocked(props.acceptAction!).mock.calls[0]![1];
    expect([...formData.keys()]).toEqual(["version"]);
    expect(formData.get("version")).toBe(LEGAL_VERSION);
    // Agreeing is not the end of onboarding, and not a way out of it.
    expect(props.onClose).not.toHaveBeenCalled();
    expect(props.onStartTour).not.toHaveBeenCalled();
  });

  it("cannot be walked past: no skip, no close button, and Esc does nothing", async () => {
    const user = userEvent.setup();
    const props = renderFlow();

    // Not from the welcome slide either: skipping there would skip the Terms.
    const welcome = screen.getByRole("dialog", { name: "Welcome to Square Share" });
    expect(within(welcome).queryByRole("button", { name: "Skip onboarding" })).toBeNull();
    expect(within(welcome).queryByRole("button", { name: "Close" })).toBeNull();
    await user.keyboard("{Escape}");

    const terms = await toTermsStep(user);
    expect(within(terms).queryByRole("button", { name: "Skip onboarding" })).toBeNull();
    expect(within(terms).queryByRole("button", { name: "Close" })).toBeNull();
    await user.keyboard("{Escape}");

    expect(props.onClose).not.toHaveBeenCalled();
    expect(props.onStartTour).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: TERMS_DIALOG })).toBeInTheDocument();
  });

  it("opens the ways out once agreed", async () => {
    const user = userEvent.setup();
    const props = renderFlow();
    await toTermsStep(user);
    const path = await agreeToTerms(user);

    expect(within(path).getByRole("button", { name: "Close" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("stays on the Terms, gate shut, when the agreement could not be recorded", async () => {
    const user = userEvent.setup();
    const props = renderFlow({
      acceptAction: vi.fn(async () => ({
        error: { code: "server_error" as const, message: msg("Errors.form.saveFailed") },
      })),
    });
    await toTermsStep(user);
    scrollTerms(1);
    await user.click(screen.getByRole("button", { name: AGREE }));

    await waitFor(() => expect(props.acceptAction).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("dialog", { name: TERMS_DIALOG })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Skip onboarding" })).toBeNull();
    await user.keyboard("{Escape}");
    expect(props.onClose).not.toHaveBeenCalled();
  });
});
