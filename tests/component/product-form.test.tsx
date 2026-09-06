import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render as rtlRender, screen, waitFor, cleanup, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { ToastProvider } from "@/components/ui/Toast";
import { NavigationBlockerProvider } from "@/lib/hooks/useNavigationBlocker";
import userEvent from "@testing-library/user-event";

afterEach(cleanup);

// jsdom implements neither scrollIntoView nor a real layout, and the toast's
// click-to-fix handler calls it on the field it jumps to.
Element.prototype.scrollIntoView = vi.fn();

// ---------------------------------------------------------------------------
// Mocks (must be declared before any imports that use them)
// ---------------------------------------------------------------------------

const mockPush = vi.hoisted(() => vi.fn());
const mockRefresh = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn(), refresh: mockRefresh }),
  usePathname: () => "/products/new",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

const mockCreateProduct = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ ok: true, id: "prod-123" }),
);
const mockUpdateProduct = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ ok: true, id: "prod-123" }),
);

vi.mock("@/lib/products/actions", () => ({
  createProduct: mockCreateProduct,
  updateProduct: mockUpdateProduct,
}));

vi.mock("@/lib/products/upload", () => ({
  uploadToR2: vi.fn().mockResolvedValue("key/image.jpg"),
}));

vi.mock("@/lib/stock/actions", () => ({}));

const { ProductForm } = await import("@/components/products/ProductForm");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fillRequiredFields(
  user: ReturnType<typeof userEvent.setup>,
  overrides: { title?: string; price?: string } = {},
) {
  const titleInput = screen.getByPlaceholderText(/ambient loops/i);
  await user.click(titleInput);
  await user.type(titleInput, overrides.title ?? "My Product");

  const priceInput = screen.getByLabelText(/price/i);
  await user.click(priceInput);
  await user.type(priceInput, overrides.price ?? "14.00");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

/** The form raises toasts and registers with the navigation blocker; both
 *  contexts must be present. Render through both providers. */
function render(ui: ReactElement) {
  return rtlRender(
    <ToastProvider>
      <NavigationBlockerProvider>{ui}</NavigationBlockerProvider>
    </ToastProvider>,
  );
}

/** The inline, field-level messages. */
const inForm = () => within(document.querySelector("form") as HTMLElement);

describe("ProductForm", () => {
  beforeEach(() => {
    mockCreateProduct.mockClear();
    mockCreateProduct.mockResolvedValue({ ok: true, id: "prod-123" });
    mockPush.mockClear();
    mockRefresh.mockClear();
  });

  // --- Title validation ---

  it("submit with empty title shows inline error with aria-invalid", async () => {
    const user = userEvent.setup();
    render(<ProductForm />);

    // Fill price so only title is empty.
    const priceInput = screen.getByLabelText(/price/i);
    await user.click(priceInput);
    await user.type(priceInput, "10.00");

    await user.click(screen.getByRole("button", { name: /save product/i }));

    const titleInput = screen.getByPlaceholderText(/ambient loops/i);
    expect(titleInput).toHaveAttribute("aria-invalid", "true");
    expect(inForm().getByText(/give your product a title/i)).toBeInTheDocument();
  });

  it("title error is wired to aria-describedby", async () => {
    const user = userEvent.setup();
    render(<ProductForm />);

    const priceInput = screen.getByLabelText(/price/i);
    await user.click(priceInput);
    await user.type(priceInput, "10.00");
    await user.click(screen.getByRole("button", { name: /save product/i }));

    const titleInput = screen.getByPlaceholderText(/ambient loops/i);
    const errorId = titleInput.getAttribute("aria-describedby");
    expect(errorId).toBeTruthy();
    expect(document.getElementById(errorId!)).toHaveTextContent(
      /give your product a title/i,
    );
  });

  it("error clears when title is fixed after first submit attempt", async () => {
    const user = userEvent.setup();
    render(<ProductForm />);

    // Submit to trigger errors.
    await user.click(screen.getByRole("button", { name: /save product/i }));
    const titleInput = screen.getByPlaceholderText(/ambient loops/i);
    expect(titleInput).toHaveAttribute("aria-invalid", "true");

    // Fix title.
    await user.type(titleInput, "Fixed Title");
    expect(titleInput).not.toHaveAttribute("aria-invalid");
  });

  it("clicking 'Jump to first' in the action bar scrolls to the first invalid field", async () => {
    const user = userEvent.setup();
    render(<ProductForm />);

    // Title and price are both empty — title comes first in the form, so
    // "Jump to first" should scroll to that input.
    await user.click(screen.getByRole("button", { name: /save product/i }));

    // The "Jump to first" button lives in the sticky action bar inside the form.
    const jumpBtn = await screen.findByRole("button", { name: /jump to first/i });
    await user.click(jumpBtn);

    const titleInput = screen.getByPlaceholderText(/ambient loops/i);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    await waitFor(() => expect(titleInput).toHaveFocus());
  });

  // --- Price validation ---

  it("empty price shows 'Set a price' error", async () => {
    const user = userEvent.setup();
    render(<ProductForm />);

    const titleInput = screen.getByPlaceholderText(/ambient loops/i);
    await user.type(titleInput, "My Product");
    // Leave price empty and submit.
    await user.click(screen.getByRole("button", { name: /save product/i }));

    expect(inForm().getByText(/set a price/i)).toBeInTheDocument();
  });

  it("price of 0 shows 'must be greater than zero' error", async () => {
    const user = userEvent.setup();
    render(<ProductForm />);

    const titleInput = screen.getByPlaceholderText(/ambient loops/i);
    await user.type(titleInput, "My Product");

    const priceInput = screen.getByLabelText(/price/i);
    await user.type(priceInput, "0");

    await user.click(screen.getByRole("button", { name: /save product/i }));
    expect(inForm().getByText(/greater than zero/i)).toBeInTheDocument();
  });

  it("negative price shows error", async () => {
    const user = userEvent.setup();
    render(<ProductForm />);

    const titleInput = screen.getByPlaceholderText(/ambient loops/i);
    await user.type(titleInput, "My Product");

    const priceInput = screen.getByLabelText(/price/i);
    await user.type(priceInput, "-5");

    await user.click(screen.getByRole("button", { name: /save product/i }));
    expect(inForm().getByText(/greater than zero/i)).toBeInTheDocument();
  });

  // --- Stock quantity validation ---

  it("trackStock checked then cleared shows stockQuantity error", async () => {
    // Toggling on seeds the quantity field to "1" so a new tracking-on state
    // does not immediately fail validation. The seller has to clear the field
    // to reproduce the "Enter how many units" error.
    const user = userEvent.setup();
    render(<ProductForm />);

    await fillRequiredFields(user);

    const trackSwitch = screen.getByRole("switch", { name: /track stock/i });
    await user.click(trackSwitch);

    // The toggle seeds "1" — clear it to get the empty-quantity error.
    const qtyInput = screen.getByLabelText(/^in stock/i);
    await user.clear(qtyInput);

    await user.click(screen.getByRole("button", { name: /save product/i }));
    expect(inForm().getByText(/how many units are in stock/i)).toBeInTheDocument();
  });

  it("trackStock toggle seeds quantity so there is no stockQuantity error on submit", async () => {
    // Toggling on seeds quantity to "1", so the seller does not immediately hit
    // a validation error for a field they just revealed.
    const user = userEvent.setup();
    render(<ProductForm />);

    await fillRequiredFields(user);

    const trackSwitch = screen.getByRole("switch", { name: /track stock/i });
    await user.click(trackSwitch);

    // No manual entry needed: the seeded "1" is already a valid stock level.
    await user.click(screen.getByRole("button", { name: /save product/i }));
    expect(inForm().queryByText(/how many units are in stock/i)).not.toBeInTheDocument();
  });

  // --- Successful submit — priceCents mapping ---

  it("valid submit calls createProduct with priceCents as integer cents", async () => {
    const user = userEvent.setup();
    render(<ProductForm />);

    const titleInput = screen.getByPlaceholderText(/ambient loops/i);
    await user.type(titleInput, "Test Product");

    const priceInput = screen.getByLabelText(/price/i);
    await user.type(priceInput, "14.00");

    await user.click(screen.getByRole("button", { name: /save product/i }));

    await waitFor(() => {
      expect(mockCreateProduct).toHaveBeenCalledWith(
        expect.objectContaining({
          priceCents: 1400,
          title: "Test Product",
        }),
      );
    });
  });

  it("priceCents rounds correctly for decimal prices (9.99 -> 999)", async () => {
    const user = userEvent.setup();
    render(<ProductForm />);

    await user.type(screen.getByPlaceholderText(/ambient loops/i), "Product");
    await user.type(screen.getByLabelText(/price/i), "9.99");
    await user.click(screen.getByRole("button", { name: /save product/i }));

    await waitFor(() => {
      expect(mockCreateProduct).toHaveBeenCalledWith(
        expect.objectContaining({ priceCents: 999 }),
      );
    });
  });

  it("after successful create, navigates to /products", async () => {
    const user = userEvent.setup();
    render(<ProductForm />);

    await user.type(screen.getByPlaceholderText(/ambient loops/i), "Product");
    await user.type(screen.getByLabelText(/price/i), "5.00");
    await user.click(screen.getByRole("button", { name: /save product/i }));

    // The redirect is deliberately held back so the button can show "Saved"
    // first (SAVED_HOLD_MS in ProductForm), hence the longer window here.
    await waitFor(
      () => {
        expect(mockPush).toHaveBeenCalledWith("/products");
      },
      { timeout: 15000 },
    );
  });

  it("server error is displayed in role=alert, with its fix", async () => {
    // Actions return a structured ActionError; ActionErrorNotice renders the
    // message AND the fix, so the user is never told what broke without also
    // being told what to do about it.
    mockCreateProduct.mockResolvedValue({
      ok: false,
      error: {
        code: "permission_denied",
        message: "Your Viewer role can't add products in this store.",
        fix: "Ask the store owner to change your role.",
      },
    });
    const user = userEvent.setup();
    render(<ProductForm />);

    await user.type(screen.getByPlaceholderText(/ambient loops/i), "Product");
    await user.type(screen.getByLabelText(/price/i), "5.00");
    await user.click(screen.getByRole("button", { name: /save product/i }));

    // In the page, beside the Save button, where it persists…
    await waitFor(() => {
      const notice = inForm().getByRole("alert");
      expect(notice).toHaveTextContent("Your Viewer role can't add products in this store.");
      expect(notice).toHaveTextContent("Ask the store owner to change your role.");
    });

    // …and as a toast, so it is seen even if the notice is off-screen.
    const alerts = await screen.findAllByRole("alert");
    expect(
      alerts.some((el) =>
        el.textContent?.includes("Your Viewer role can't add products in this store."),
      ),
    ).toBe(true);
  });

  it("shows the problem count in the sticky action bar when a save is blocked", async () => {
    // The inline bar replaces the validation toast: it lives where the seller's
    // eyes already are when Save is pressed and stays visible as they fix fields.
    const user = userEvent.setup();
    render(<ProductForm />);

    await user.click(screen.getByRole("button", { name: /save product/i }));

    // Count shown in the sticky bar (inside the form).
    await waitFor(() => {
      expect(inForm().getByText(/2 things to fix before saving/i)).toBeInTheDocument();
    });
    // Field-level messages are also visible (inline under each field).
    expect(inForm().getByText(/give your product a title/i)).toBeInTheDocument();
    expect(inForm().getByText(/set a price before saving/i)).toBeInTheDocument();
    // createProduct is never reached — this is a client-side block.
    expect(mockCreateProduct).not.toHaveBeenCalled();
  });

});

// ---------------------------------------------------------------------------
// Unsaved-changes guard
// ---------------------------------------------------------------------------

describe("ProductForm - unsaved changes", () => {
  beforeEach(() => {
    mockPush.mockClear();
    mockRefresh.mockClear();
    mockCreateProduct.mockClear();
    mockCreateProduct.mockResolvedValue({ ok: true, id: "prod-123" });
  });

  it("leaves immediately when nothing has been typed", async () => {
    const user = userEvent.setup();
    render(<ProductForm />);

    await user.click(screen.getByRole("button", { name: /^cancel$/i }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mockPush).toHaveBeenCalledWith("/products");
  });

  it("asks before discarding typed work", async () => {
    const user = userEvent.setup();
    render(<ProductForm />);

    await user.type(screen.getByPlaceholderText(/ambient loops/i), "Half typed");
    await user.click(screen.getByRole("button", { name: /^cancel$/i }));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    // Still on the form: nothing navigated.
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("keeps editing when the prompt is dismissed", async () => {
    const user = userEvent.setup();
    render(<ProductForm />);

    await user.type(screen.getByPlaceholderText(/ambient loops/i), "Half typed");
    await user.click(screen.getByRole("button", { name: /^cancel$/i }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /^cancel$/i }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(mockPush).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText(/ambient loops/i)).toHaveValue("Half typed");
  });

  it("navigates once the discard is confirmed", async () => {
    const user = userEvent.setup();
    render(<ProductForm />);

    await user.type(screen.getByPlaceholderText(/ambient loops/i), "Half typed");
    await user.click(screen.getByRole("button", { name: /^cancel$/i }));
    await user.click(await screen.findByRole("button", { name: /^discard$/i }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/products"));
  });

  it("treats a typed-then-undone edit as clean", async () => {
    // Compared against the pristine values, not a mutation flag, so undoing an
    // edit really does leave the form clean.
    const user = userEvent.setup();
    render(<ProductForm />);

    const title = screen.getByPlaceholderText(/ambient loops/i);
    await user.type(title, "abc");
    await user.clear(title);
    await user.click(screen.getByRole("button", { name: /^cancel$/i }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mockPush).toHaveBeenCalledWith("/products");
  });

  it("confirms on the button BEFORE redirecting, so a save is visibly a save", async () => {
    const user = userEvent.setup();
    render(<ProductForm />);

    await user.type(screen.getByPlaceholderText(/ambient loops/i), "Product");
    await user.type(screen.getByLabelText(/price/i), "5.00");
    await user.click(screen.getByRole("button", { name: /save product/i }));

    // The whole point of the hold: redirecting in the same tick left the
    // seller with no evidence the save had happened at all.
    expect(await screen.findByRole("button", { name: /saved/i })).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("then redirects, without the unsaved-work prompt", async () => {
    const user = userEvent.setup();
    render(<ProductForm />);

    await user.type(screen.getByPlaceholderText(/ambient loops/i), "Product");
    await user.type(screen.getByLabelText(/price/i), "5.00");
    await user.click(screen.getByRole("button", { name: /save product/i }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/products"), {
      timeout: 15000,
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Price field: locale flexibility and strict form validation
// ---------------------------------------------------------------------------

describe("ProductForm - price field validation", () => {
  beforeEach(() => {
    mockCreateProduct.mockClear();
    mockCreateProduct.mockResolvedValue({ ok: true, id: "prod-123" });
    mockPush.mockClear();
  });

  it("accepts comma-decimal prices (European locale)", async () => {
    const user = userEvent.setup();
    render(<ProductForm />);

    await user.type(screen.getByPlaceholderText(/ambient loops/i), "Product");
    await user.type(screen.getByLabelText(/price/i), "1,50");
    await user.click(screen.getByRole("button", { name: /save product/i }));

    await waitFor(() => {
      expect(mockCreateProduct).toHaveBeenCalledWith(
        expect.objectContaining({ priceCents: 150 }),
      );
    });
  });

  it("rejects 3+ fractional digits with a specific error", async () => {
    const user = userEvent.setup();
    render(<ProductForm />);

    await user.type(screen.getByPlaceholderText(/ambient loops/i), "Product");
    await user.type(screen.getByLabelText(/price/i), "9.999");
    await user.click(screen.getByRole("button", { name: /save product/i }));

    expect(inForm().getByText(/at most two decimal places/i)).toBeInTheDocument();
    expect(mockCreateProduct).not.toHaveBeenCalled();
  });

  it("rejects scientific notation", async () => {
    const user = userEvent.setup();
    render(<ProductForm />);

    await user.type(screen.getByPlaceholderText(/ambient loops/i), "Product");
    await user.type(screen.getByLabelText(/price/i), "1e5");
    await user.click(screen.getByRole("button", { name: /save product/i }));

    // Scientific notation is not a valid price format; any price error is shown.
    expect(
      inForm().queryByText(/at most two decimal places|greater than zero|set a price/i),
    ).toBeInTheDocument();
    expect(mockCreateProduct).not.toHaveBeenCalled();
  });

  it("normalises price to two decimals on blur", async () => {
    const user = userEvent.setup();
    render(<ProductForm />);

    const priceInput = screen.getByLabelText(/price/i);
    await user.click(priceInput);
    await user.type(priceInput, "129");
    // Blur the field (click somewhere else).
    await user.click(screen.getByPlaceholderText(/ambient loops/i));

    expect(priceInput).toHaveValue("129.00");
  });
});

// ---------------------------------------------------------------------------
// Navigation blocker: in-app anchor clicks while dirty
// ---------------------------------------------------------------------------

describe("ProductForm - navigation blocker", () => {
  beforeEach(() => {
    mockPush.mockClear();
    mockCreateProduct.mockClear();
    mockCreateProduct.mockResolvedValue({ ok: true, id: "prod-123" });
  });

  it("intercepts an internal anchor click while the form is dirty", async () => {
    const user = userEvent.setup();
    // Render a same-page internal link alongside the form; the capture-phase
    // listener from NavigationBlockerProvider (included in `render`) intercepts
    // clicks on it when the form has unsaved edits.
    rtlRender(
      <ToastProvider>
        <NavigationBlockerProvider>
          <a href="/products">Back to Products</a>
          <ProductForm />
        </NavigationBlockerProvider>
      </ToastProvider>,
    );

    // Make the form dirty.
    await user.type(screen.getByPlaceholderText(/ambient loops/i), "Draft title");

    // Click the internal link — the blocker should intercept it.
    await user.click(screen.getByRole("link", { name: /back to products/i }));

    // The unsaved-changes modal should have appeared.
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    // The router was NOT called directly.
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("does NOT intercept the anchor while the form is clean", async () => {
    const user = userEvent.setup();
    rtlRender(
      <ToastProvider>
        <NavigationBlockerProvider>
          <a href="/products">Back to Products</a>
          <ProductForm />
        </NavigationBlockerProvider>
      </ToastProvider>,
    );

    // Form is clean — click should go straight through (no modal).
    await user.click(screen.getByRole("link", { name: /back to products/i }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
