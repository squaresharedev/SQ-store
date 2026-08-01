import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

afterEach(cleanup);

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
    expect(screen.getByText(/give your product a title/i)).toBeInTheDocument();
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

  // --- Price validation ---

  it("empty price shows 'Set a price' error", async () => {
    const user = userEvent.setup();
    render(<ProductForm />);

    const titleInput = screen.getByPlaceholderText(/ambient loops/i);
    await user.type(titleInput, "My Product");
    // Leave price empty and submit.
    await user.click(screen.getByRole("button", { name: /save product/i }));

    expect(screen.getByText(/set a price/i)).toBeInTheDocument();
  });

  it("price of 0 shows 'must be greater than zero' error", async () => {
    const user = userEvent.setup();
    render(<ProductForm />);

    const titleInput = screen.getByPlaceholderText(/ambient loops/i);
    await user.type(titleInput, "My Product");

    const priceInput = screen.getByLabelText(/price/i);
    await user.type(priceInput, "0");

    await user.click(screen.getByRole("button", { name: /save product/i }));
    expect(screen.getByText(/greater than zero/i)).toBeInTheDocument();
  });

  it("negative price shows error", async () => {
    const user = userEvent.setup();
    render(<ProductForm />);

    const titleInput = screen.getByPlaceholderText(/ambient loops/i);
    await user.type(titleInput, "My Product");

    const priceInput = screen.getByLabelText(/price/i);
    await user.type(priceInput, "-5");

    await user.click(screen.getByRole("button", { name: /save product/i }));
    expect(screen.getByText(/greater than zero/i)).toBeInTheDocument();
  });

  // --- Stock quantity validation ---

  it("trackStock checked without quantity shows stockQuantity error", async () => {
    const user = userEvent.setup();
    render(<ProductForm />);

    await fillRequiredFields(user);

    // Enable track stock.
    const trackSwitch = screen.getByRole("switch", { name: /track stock/i });
    await user.click(trackSwitch);

    // Leave stock quantity empty and submit.
    await user.click(screen.getByRole("button", { name: /save product/i }));
    expect(screen.getByText(/how many are in stock/i)).toBeInTheDocument();
  });

  it("trackStock with valid quantity has no stockQuantity error", async () => {
    const user = userEvent.setup();
    render(<ProductForm />);

    await fillRequiredFields(user);

    const trackSwitch = screen.getByRole("switch", { name: /track stock/i });
    await user.click(trackSwitch);

    const qtyInput = screen.getByPlaceholderText("0");
    await user.type(qtyInput, "50");

    await user.click(screen.getByRole("button", { name: /save product/i }));
    expect(screen.queryByText(/how many are in stock/i)).not.toBeInTheDocument();
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

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/products");
    });
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

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Your Viewer role can't add products in this store.");
    expect(alert).toHaveTextContent("Ask the store owner to change your role.");
  });

  // --- Summary alert for multiple validation errors ---

  it("shows a summary alert when there are multiple validation errors", async () => {
    const user = userEvent.setup();
    render(<ProductForm />);
    // Submit with nothing filled in.
    await user.click(screen.getByRole("button", { name: /save product/i }));
    const alerts = screen.getAllByRole("alert");
    // Should include the summary "please fix" alert.
    const summary = alerts.find((a) =>
      /please fix/i.test(a.textContent ?? ""),
    );
    expect(summary).toBeDefined();
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
    await user.click(await screen.findByRole("button", { name: /keep editing/i }));

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
    await user.click(await screen.findByRole("button", { name: /discard changes/i }));

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

  it("does not prompt on the redirect that follows a successful save", async () => {
    const user = userEvent.setup();
    render(<ProductForm />);

    await user.type(screen.getByPlaceholderText(/ambient loops/i), "Product");
    await user.type(screen.getByLabelText(/price/i), "5.00");
    await user.click(screen.getByRole("button", { name: /save product/i }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/products"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
