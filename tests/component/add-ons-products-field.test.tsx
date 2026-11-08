import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { failure, serverError } from "@/lib/errors";
import messages from "../../messages/en";
import type { AddOnPicker } from "@/lib/products/add-on-actions";
import type { AddOnChoice } from "@/lib/products/add-on-choices";
import { NO_ADD_ON_HABITS } from "@/lib/predictions";
import type { AddOnCard, Product } from "@/types/product";

const getAddOnPicker = vi.fn();
const setProductAddOns = vi.fn();
vi.mock("@/lib/products/add-on-actions", () => ({
  getAddOnPicker: (...args: unknown[]) => getAddOnPicker(...args),
  setProductAddOns: (...args: unknown[]) => setProductAddOns(...args),
}));
const toastError = vi.fn();
vi.mock("@/components/ui/Toast", () => ({ useToast: () => ({ error: toastError, success: vi.fn() }) }));

const { AddOnsProductsField } = await import("@/components/storefront/AddOnsProductsField");
const { ProductAddOnsEditorProvider, useProductAddOnsEditor } = await import(
  "@/components/storefront/ProductAddOnsEditor"
);
const { SampleModeProvider } = await import("@/lib/storefront/sample-mode");
const { SettingTargetProvider } = await import("@/lib/storefront/setting-context");

const LAMP = "00000000-0000-4000-8000-000000000001";
const SHADE = "00000000-0000-4000-8000-000000000002";
const BULB = "00000000-0000-4000-8000-000000000003";

function product(id: string, title: string): Product {
  return {
    id,
    title,
    description: "",
    price: 10,
    currency: "EUR",
    status: "active",
    imageUrl: null,
    digitalFileName: null,
    trackStock: false,
    stockQuantity: null,
    lowStockThreshold: 5,
    maxPerOrder: 10,
  } as Product;
}

function choice(id: string, title: string, extra?: Partial<AddOnChoice>): AddOnChoice {
  return {
    id,
    title,
    priceCents: 1000,
    sale: null,
    currency: "EUR",
    imageUrl: null,
    status: "active",
    isDigital: false,
    soldOut: false,
    takenDown: false,
    ...extra,
  };
}

const CATALOG = [product(LAMP, "Oak lamp"), product(SHADE, "Linen shade"), product(BULB, "Warm bulb")];
const CHOICES = [choice(LAMP, "Oak lamp"), choice(SHADE, "Linen shade"), choice(BULB, "Warm bulb")];

function picker(extra?: Partial<AddOnPicker>): { ok: true; picker: AddOnPicker } {
  return {
    ok: true,
    picker: { choices: CHOICES, addOnIds: [], isDigital: false, currency: "EUR", ownBuyLink: false, habits: NO_ADD_ON_HABITS, ...extra },
  };
}

function card(id: string, title: string): AddOnCard {
  return {
    id,
    title,
    description: "",
    priceCents: 1000,
    currency: "EUR",
    sale: null,
    images: [],
    optionGroups: [],
    isDigital: false,
    digitalFormat: null,
    shippingProfileId: null,
    pagePath: null,
    rating: null,
  };
}

/** What the artboard reads, drawn as text: the cards, and the faded ones with why. */
function Artboard({ productId }: { productId: string }) {
  const editor = useProductAddOnsEditor();
  const edit = editor?.edits[productId];
  return (
    <>
      <p data-testid={`board-${productId}`}>{edit ? edit.cards.map((one) => one.title).join(",") : "unchanged"}</p>
      <p data-testid={`faded-${productId}`}>
        {edit ? edit.hidden.map((one) => `${one.title}:${one.reason}`).join(",") : "unchanged"}
      </p>
    </>
  );
}

function Aim({ productId }: { productId: string }) {
  const editor = useProductAddOnsEditor();
  return <button onClick={() => editor?.aim(productId)}>aim {productId}</button>;
}

function renderField(openPages: string[] = [LAMP], sample = false) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <SampleModeProvider value={sample}>
        <ProductAddOnsEditorProvider catalog={CATALOG} openPages={openPages}>
          <AddOnsProductsField />
          <Artboard productId={LAMP} />
          <Aim productId={SHADE} />
        </ProductAddOnsEditorProvider>
      </SampleModeProvider>
    </NextIntlClientProvider>,
  );
}

const row = (id: string) => document.querySelector(`[data-product-add-on='${id}']`) as HTMLElement;
const press = (id: string) => within(row(id)).getByRole("button");

describe("the storefront editor's add-on picker", () => {
  beforeEach(() => {
    getAddOnPicker.mockReset().mockResolvedValue(picker());
    setProductAddOns.mockReset();
    toastError.mockReset();
  });
  afterEach(cleanup);

  it("lists the store's other products for the page out on the canvas", async () => {
    renderField();
    await waitFor(() => expect(row(SHADE)).not.toBeNull());
    expect(getAddOnPicker).toHaveBeenCalledWith(LAMP);
    // Whose list it is, in one line with how full it is.
    expect(document.querySelector(`[data-add-ons-products-for='${LAMP}']`)).toHaveTextContent("Oak lamp");
    expect(screen.getByRole("list", { name: "Offered with Oak lamp" })).toBeInTheDocument();
    expect(document.querySelector("[data-product-add-ons-count]")).toHaveTextContent("0/4");
    // Never itself.
    expect(row(LAMP)).toBeNull();
  });

  it("shows a press on the page at once, saves it, then shows what the server answered", async () => {
    let answer!: (value: unknown) => void;
    setProductAddOns.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    renderField();
    await waitFor(() => expect(row(SHADE)).not.toBeNull());
    await userEvent.click(press(SHADE));

    expect(setProductAddOns).toHaveBeenCalledWith(LAMP, [SHADE]);
    expect(row(SHADE)).toHaveAttribute("data-product-add-on-state", "added");
    expect(screen.getByTestId(`board-${LAMP}`)).toHaveTextContent("Linen shade");

    await act(async () => answer({ ok: true, addOnIds: [SHADE], addOns: [card(SHADE, "Linen shade, as stored")], hidden: [] }));
    expect(screen.getByTestId(`board-${LAMP}`)).toHaveTextContent("Linen shade, as stored");
  });

  it("previews a draft faded, with why, because a buyer would not be offered it", async () => {
    setProductAddOns.mockReturnValue(new Promise(() => {}));
    getAddOnPicker.mockResolvedValue(picker({ choices: [choice(LAMP, "Oak lamp"), choice(SHADE, "Linen shade", { status: "draft" })] }));
    renderField();
    await waitFor(() => expect(row(SHADE)).not.toBeNull());
    await userEvent.click(press(SHADE));
    expect(row(SHADE)).toHaveAttribute("data-product-add-on-state", "added");
    expect(screen.getByTestId(`board-${LAMP}`).textContent).toBe("");
    expect(screen.getByTestId(`faded-${LAMP}`)).toHaveTextContent("Linen shade:draft");
    // The row says the same, with the struck-through eye.
    expect(within(row(SHADE)).getByText("Draft")).toHaveAttribute("title", "Buyers see it once it is active.");
  });

  it("offers what buyers bought together in one tap, saved like a press, and the arrow takes it back", async () => {
    setProductAddOns.mockImplementation(async (_id: string, ids: string[]) => ({
      ok: true,
      // A new array, as the server answers: the arrow must survive it.
      addOnIds: [...ids],
      addOns: ids.map((id) => card(id, id === SHADE ? "Linen shade" : "Warm bulb")),
      hidden: [],
    }));
    getAddOnPicker.mockResolvedValue(picker({ habits: { boughtWith: { [SHADE]: 3, [BULB]: 2 }, offeredWith: {} } }));
    renderField();
    const chip = await screen.findByRole("button", { name: "Often bought together: Linen shade and Warm bulb" });
    await userEvent.click(chip);
    await waitFor(() => expect(setProductAddOns).toHaveBeenLastCalledWith(LAMP, [SHADE, BULB]));
    expect(row(BULB)).toHaveAttribute("data-product-add-on-state", "added");
    await waitFor(() => expect(screen.getByTestId(`board-${LAMP}`)).toHaveTextContent("Linen shade,Warm bulb"));

    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(setProductAddOns).toHaveBeenLastCalledWith(LAMP, []));
    expect(row(SHADE)).toHaveAttribute("data-product-add-on-state", "offered");
  });

  it("counts what is chosen against the most there can be, and takes no more once full", async () => {
    const more = ["04", "05", "06", "07"].map((end) => `00000000-0000-4000-8000-0000000000${end}`);
    getAddOnPicker.mockResolvedValue(
      picker({ choices: [...CHOICES, ...more.map((id, at) => choice(id, `Extra ${at}`))], addOnIds: [SHADE, BULB, more[0]!] }),
    );
    setProductAddOns.mockReturnValue(new Promise(() => {}));
    renderField();
    await waitFor(() => expect(row(SHADE)).not.toBeNull());
    expect(document.querySelector("[data-product-add-ons-count]")).toHaveTextContent("3/4");
    await userEvent.click(press(more[1]!));
    expect(document.querySelector("[data-product-add-ons-count]")).toHaveTextContent("4/4");
    expect(screen.getByText("4 of 4 chosen")).toBeInTheDocument();
    expect(press(more[2]!)).toBeDisabled();
    // A chosen one still comes off.
    expect(press(SHADE)).toBeEnabled();
  });

  it("stores the last press when presses outrun the network, without one save each", async () => {
    const answers: ((value: unknown) => void)[] = [];
    setProductAddOns.mockImplementation(() => new Promise((resolve) => answers.push(resolve)));
    renderField();
    await waitFor(() => expect(row(SHADE)).not.toBeNull());
    await userEvent.click(press(SHADE));
    await userEvent.click(press(BULB));
    await userEvent.click(press(SHADE));
    expect(setProductAddOns).toHaveBeenCalledTimes(1);

    await act(async () => answers[0]!({ ok: true, addOnIds: [SHADE], addOns: [card(SHADE, "Linen shade")], hidden: [] }));
    expect(setProductAddOns).toHaveBeenCalledTimes(2);
    expect(setProductAddOns).toHaveBeenLastCalledWith(LAMP, [BULB]);
    // An answer that is already out of date does not undo the later presses.
    expect(row(SHADE)).toHaveAttribute("data-product-add-on-state", "offered");
    expect(row(BULB)).toHaveAttribute("data-product-add-on-state", "added");

    await act(async () => answers[1]!({ ok: true, addOnIds: [BULB], addOns: [card(BULB, "Warm bulb")], hidden: [] }));
    expect(setProductAddOns).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId(`board-${LAMP}`)).toHaveTextContent("Warm bulb");
  });

  it("goes back to what is stored when a save is refused, and says why", async () => {
    getAddOnPicker.mockResolvedValue(picker({ addOnIds: [BULB] }));
    setProductAddOns.mockResolvedValue(failure(serverError("saveProduct")));
    renderField();
    await waitFor(() => expect(row(SHADE)).not.toBeNull());
    await userEvent.click(press(SHADE));
    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    expect(row(SHADE)).toHaveAttribute("data-product-add-on-state", "offered");
    expect(row(BULB)).toHaveAttribute("data-product-add-on-state", "added");
    expect(screen.getByTestId(`board-${LAMP}`)).toHaveTextContent("unchanged");
  });

  it("treats a save that never answered as refused too", async () => {
    setProductAddOns.mockRejectedValue(new Error("offline"));
    renderField();
    await waitFor(() => expect(row(SHADE)).not.toBeNull());
    await userEvent.click(press(SHADE));
    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    expect(row(SHADE)).toHaveAttribute("data-product-add-on-state", "offered");
  });

  it("offers a choice of page when several are out, starting with the newest", async () => {
    getAddOnPicker.mockImplementation(async () => picker());
    renderField([LAMP, SHADE]);
    await waitFor(() => expect(getAddOnPicker).toHaveBeenCalledWith(SHADE));
    await waitFor(() => expect(row(LAMP)).not.toBeNull());
    expect(row(SHADE)).toBeNull();
    expect(screen.getByRole("combobox", { name: "Offered with" })).toHaveTextContent("Linen shade");
  });

  it("follows the page a seller clicked on", async () => {
    renderField([SHADE, LAMP]);
    await waitFor(() => expect(row(SHADE)).not.toBeNull());
    await userEvent.click(screen.getByRole("button", { name: `aim ${SHADE}` }));
    await waitFor(() => expect(getAddOnPicker).toHaveBeenLastCalledWith(SHADE));
    await waitFor(() => expect(row(LAMP)).not.toBeNull());
  });

  it("asks for a page when none is out", () => {
    renderField([]);
    expect(document.querySelector("[data-add-ons-products='no-page']")).toHaveTextContent(
      "Open a product's page on the canvas to choose what it offers.",
    );
    expect(getAddOnPicker).not.toHaveBeenCalled();
  });

  function renderInDesigner(canOpenPage: boolean, open = vi.fn()) {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <SettingTargetProvider value={{ activeRef: null, open, close: vi.fn() }}>
          <ProductAddOnsEditorProvider catalog={CATALOG} openPages={[]} canOpenPage={canOpenPage}>
            <AddOnsProductsField />
          </ProductAddOnsEditorProvider>
        </SettingTargetProvider>
      </NextIntlClientProvider>,
    );
    return open;
  }

  it("puts a page out itself when none is, keeping this section open", async () => {
    const open = renderInDesigner(true);
    await userEvent.click(screen.getByRole("button", { name: "Open product page" }));
    expect(open).toHaveBeenCalledWith({ kind: "productPage", section: "addOns" });
  });

  it("offers no button when the board has no product whose page could open", () => {
    renderInDesigner(false);
    expect(screen.queryByRole("button", { name: "Open product page" })).toBeNull();
  });

  it("says when the list could not be read, and tries again on request", async () => {
    getAddOnPicker.mockResolvedValueOnce(failure(serverError("loadProductPagePreview")));
    renderField();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Your products could not be loaded."));
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(row(SHADE)).not.toBeNull());
  });

  it("says when Buy now goes to the seller's own link, where the section does not show", async () => {
    getAddOnPicker.mockResolvedValue(picker({ ownBuyLink: true }));
    renderField();
    await waitFor(() => expect(document.querySelector("[data-add-ons-products-own-link]")).not.toBeNull());
    // One short line; the whole of it is the line's tooltip.
    expect(document.querySelector("[data-add-ons-products-own-link]")).toHaveTextContent(
      "Hidden: Buy now goes to your own link.",
    );
  });

  it("changes only the browser on the sample storefront", async () => {
    renderField([LAMP], true);
    await userEvent.click(press(SHADE));
    expect(row(SHADE)).toHaveAttribute("data-product-add-on-state", "added");
    expect(screen.getByTestId(`board-${LAMP}`)).toHaveTextContent("Linen shade");
    expect(getAddOnPicker).not.toHaveBeenCalled();
    expect(setProductAddOns).not.toHaveBeenCalled();
  });

  it("renders nothing outside the designer", () => {
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <AddOnsProductsField />
      </NextIntlClientProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
