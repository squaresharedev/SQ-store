import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render as rtlRender, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import userEvent from "@testing-library/user-event";
import { ToastProvider } from "@/components/ui/Toast";

// Same mocks as product-form.test.tsx: the form is a client component that
// reaches for the router and the server actions, neither of which exists in
// jsdom. Declared before the import that uses them.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/products/new",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/products/actions", () => ({
  createProduct: vi.fn().mockResolvedValue({ ok: true, id: "prod-123" }),
  updateProduct: vi.fn().mockResolvedValue({ ok: true, id: "prod-123" }),
}));
vi.mock("@/lib/products/upload", () => ({
  uploadToR2: vi.fn().mockResolvedValue("key/image.jpg"),
}));

import {
  PRODUCT_FORM_SECTIONS,
  PRODUCT_FORM_SNAPSHOT_ID,
  buildProductFormSnapshot,
  type ProductFormSnapshot,
} from "@/lib/products/form-datapoints";
import { initialDetailsValues } from "@/components/products/form-values";
import type { Product } from "@/types/product";

const { ProductForm } = await import("@/components/products/ProductForm");

/** The form raises toasts, and useToast refuses to no-op outside a provider. */
function render(ui: ReactElement) {
  return rtlRender(<ToastProvider>{ui}</ToastProvider>);
}

afterEach(cleanup);

const PRODUCT: Product = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  title: "Oak lamp",
  description: "Warm light.",
  price: 129,
  currency: "EUR",
  status: "active",
  imageUrl: "https://cdn.test/lamp.jpg",
  digitalFileName: null,
  trackStock: true,
  stockQuantity: 4,
  lowStockThreshold: 5,
  maxPerOrder: 10,
};

function snapshot(): ProductFormSnapshot {
  const raw = document.getElementById(PRODUCT_FORM_SNAPSHOT_ID)?.textContent ?? "";
  return JSON.parse(raw) as ProductFormSnapshot;
}

const fields = () =>
  [...document.querySelectorAll("[data-product-field]")].map(
    (node) => node.getAttribute("data-product-field")!,
  );

describe("product form — the machine-readable contract", () => {
  it("publishes a snapshot that matches what is on the screen", async () => {
    render(<ProductForm product={PRODUCT} />);
    const published = snapshot();

    expect(published.version).toBe(1);
    expect(published.mode).toBe("edit");
    expect(published.productId).toBe(PRODUCT.id);
    expect(published.title).toBe("Oak lamp");
    expect(published.status).toBe("active");
    expect(published.trackStock).toBe(true);
    expect(published.stockQuantity).toBe(4);
    expect(published.hasCoverImage).toBe(true);
    expect(published.dirty).toBe(false);
  });

  it("emits money as INTEGER CENTS and never as the typed decimal", async () => {
    // agent-surface B3: the form holds "129" because that is what a person
    // types; every machine-readable copy is the integer the database stores.
    render(<ProductForm product={PRODUCT} />);
    expect(snapshot().priceCents).toBe(12900);

    const price = document.querySelector('[data-product-field="price"]')!;
    expect(price.getAttribute("data-product-value")).toBe("12900");
    expect(price.getAttribute("data-product-unit")).toBe("currency_cents");
    expect(price.getAttribute("data-product-currency")).toBe("EUR");

    const user = userEvent.setup();
    const input = screen.getByLabelText("Price");
    await user.clear(input);
    await user.type(input, "7.50");
    expect(snapshot().priceCents).toBe(750);
  });

  it("carries NO object key anywhere in the snapshot", () => {
    // agent-surface B6. The cover image, gallery photos, documents and above
    // all the paid download are R2 keys; `digital_file_key` IS the paywall.
    // The snapshot is built field by field so a field added later cannot leak
    // by default, and this is the test that says so out loud.
    render(<ProductForm product={{ ...PRODUCT, digitalFileName: "album.zip" }} />);
    const json = JSON.stringify(snapshot());
    for (const forbidden of ["images/", "files/", "documents/", "image_key", "digital_file", "cdn.test"]) {
      expect(json, forbidden).not.toContain(forbidden);
    }
    // What it says instead: the FACT, not the address.
    expect(snapshot().hasDigitalFile).toBe(true);
    expect(snapshot().hasCoverImage).toBe(true);
  });

  it("gives every section an addressable anchor, id and state", () => {
    render(<ProductForm product={PRODUCT} />);
    // A physical product shows all nine; safety is dropped for a download.
    for (const section of PRODUCT_FORM_SECTIONS) {
      const node = document.querySelector(`[data-product-section="${section.id}"]`);
      expect(node, section.id).not.toBeNull();
      expect(node!.getAttribute("data-product-section-state")).toMatch(
        /^(empty|filled|invalid)$/,
      );
      expect(document.getElementById(`product-section-${section.id}`), section.id).not.toBeNull();
    }
  });

  it("hides the safety section for a download, in the DOM and in the snapshot", () => {
    render(<ProductForm product={{ ...PRODUCT, digitalFileName: "album.zip" }} />);
    expect(document.querySelector('[data-product-section="safety"]')).toBeNull();
    expect(snapshot().sections.map((section) => section.id)).not.toContain("safety");
    expect(snapshot().isDigital).toBe(true);
  });

  it("names what is missing before the product can be saved", async () => {
    const user = userEvent.setup();
    render(<ProductForm />);
    // A blank create form: title and price are what stand between the seller
    // and a saved product, and an assistant should be able to say so without
    // submitting anything.
    expect(snapshot().requiredMissing).toEqual(["title", "price"]);

    await user.type(screen.getByLabelText("Title"), "Desk lamp");
    expect(snapshot().requiredMissing).toEqual(["price"]);
  });

  it("keeps the section summaries and the index rail in step", async () => {
    const user = userEvent.setup();
    render(<ProductForm product={PRODUCT} />);

    // Empty before, filled after — the same string in the header and the rail,
    // because both read the one snapshot.
    const optionsNav = document.querySelector('[data-product-form-nav-item="options"]')!;
    expect(optionsNav.getAttribute("data-product-section-state")).toBe("empty");

    await user.click(screen.getByRole("button", { name: /^Size$/ }));
    const filled = snapshot().sections.find((section) => section.id === "options")!;
    expect(filled.state).toBe("filled");
    expect(filled.summary).toBe("1 group, 6 options");
    expect(
      document
        .querySelector('[data-product-section="options"]')!
        .querySelector("[data-product-section-summary]")!.textContent,
    ).toBe(filled.summary);
    expect(
      document
        .querySelector('[data-product-form-nav-item="options"]')!
        .getAttribute("data-product-section-state"),
    ).toBe("filled");
  });

  it("reports a section as invalid, and says where, once a save is blocked", async () => {
    const user = userEvent.setup();
    render(<ProductForm product={PRODUCT} />);
    await user.clear(screen.getByLabelText("Title"));
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    const basics = snapshot().sections.find((section) => section.id === "basics")!;
    expect(basics.state).toBe("invalid");
    expect(
      document
        .querySelector('[data-product-section="basics"]')!
        .getAttribute("data-product-section-state"),
    ).toBe("invalid");
  });

  it("addresses every field a seller can edit", () => {
    render(<ProductForm product={PRODUCT} />);
    // The contract, spelled out. A field losing its datapoint is a silent
    // regression for anything reading the form, so the list is asserted rather
    // than sampled.
    for (const field of [
      "title",
      "description",
      "price",
      "currency",
      "trackStock",
      "stockQuantity",
      "lowStockThreshold",
      "coverImage",
      "digitalFile",
      "purchaseUrl",
      "optionGroups",
      "gallery",
      "length",
      "width",
      "height",
      "dimensionUnit",
      "weight",
      "weightUnit",
      "materials",
      "origin",
      "care",
      "included",
      "documents",
      "status",
      "safety.manufacturerName",
      "safety.manufacturerEmail",
      "safety.manufacturerAddress",
      "safety.warnings",
    ]) {
      expect(fields(), field).toContain(field);
    }
  });

  it("is a pure function of the form's state", () => {
    // Same state in, same snapshot out — the property the whole design rests
    // on, since the screen and the JSON are two renders of one object.
    const input = {
      mode: "create" as const,
      productId: null,
      values: {
        title: "A",
        description: "",
        price: "1.00",
        currency: "EUR" as const,
        status: "draft" as const,
        trackStock: false,
        stockQuantity: "",
        lowStockThreshold: "5",
        maxPerOrder: "10",
      },
      optionGroups: [],
      gallery: [],
      documents: [],
      details: initialDetailsValues(),
      optionDetails: {},
      purchaseUrl: "",
      shippingProfileId: null,
      shippingProfileName: null,
      hasCoverImage: false,
      hasDigitalFile: false,
      isDigital: false,
      dirty: false,
      invalidSections: [],
    };
    const a = buildProductFormSnapshot(input);
    const b = buildProductFormSnapshot(input);
    expect({ ...a, generatedAt: "" }).toEqual({ ...b, generatedAt: "" });
  });
});
