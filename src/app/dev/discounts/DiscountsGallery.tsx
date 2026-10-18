"use client";

import { useMemo, useState, type ReactNode } from "react";
import { DiscountCodeField } from "@/components/checkout/DiscountCodeField";
import { DiscountCodeProvider } from "@/components/checkout/DiscountCodeContext";
import { DiscountExample } from "@/components/discounts/DiscountExample";
import { DiscountForm } from "@/components/discounts/DiscountForm";
import { DiscountRow } from "@/components/discounts/DiscountRow";
import { DiscountsSkeleton } from "@/components/discounts/DiscountsSkeleton";
import { ProductPageView } from "@/components/product-page/ProductPageView";
import { ProductPrice } from "@/components/product-page/ProductPrice";
import { readableOn, storefrontOverlayVars } from "@/components/product-page/product-page-maps";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { ToastProvider } from "@/components/ui/Toast";
import { secondaryButtonClass } from "@/components/ui/control-styles";
import { eyebrowClass } from "@/components/ui/surface-styles";
import { coveredProducts } from "@/lib/discounts/covered";
import { priceOfOne } from "@/lib/discounts/pricing";
import { summarizeDiscounts } from "@/lib/discounts/summary";
import { SALE_CHIP_SETTING_ID, settingHref } from "@/lib/storefront/setting-ref";
import { cn } from "@/lib/utils";
import type { CodeTerms, DiscountKind, DiscountValue } from "@/types/discount";
import type { ProductPageStorefront } from "@/types/product-page";
import {
  DEFAULT_PRODUCT_PAGE_CONFIG,
  PRODUCT_PAGE_SALE_STYLES,
  type ProductPageSaleStyle,
} from "@/types/storefront";
import {
  HARNESS_SELLER,
  HARNESS_SHIPPING,
  HARNESS_THEME,
  harnessProduct,
  type HarnessSale,
} from "../checkout/fixtures";
import type { DiscountFixtures } from "./fixtures";

/**
 * A DISCOUNT, EVERYWHERE IT IS DRAWN, on fixtures: the seller's list (one
 * ticket per state), then what a buyer sees of the same discount on the
 * product page and at checkout. The controls work on the fixtures (switch a
 * code off, end a sale, delete, open a product list) and never reach a server.
 */

/** The row's own width at each size: the list is as wide as the page column
 *  on a desktop, narrower beside the dashboard's rail on a laptop, and the
 *  whole screen less its gutters on a phone. */
const WIDTHS = {
  desktop: { label: "Desktop", className: "max-w-7xl" },
  laptop: { label: "Laptop", className: "max-w-4xl" },
  tablet: { label: "Tablet", className: "max-w-2xl" },
  phone: { label: "Phone", className: "max-w-sm" },
} as const;
type Width = keyof typeof WIDTHS;

const ROLES = { owner: "Owner", viewer: "Viewer" } as const;
type Role = keyof typeof ROLES;

/** The backdrops a buyer's page is judged on: the ticket is drawn in the
 *  page's ink, so it has to hold on a light page, a tinted one and a dark one. */
const SURFACES = [
  { key: "white", name: "White page", hex: "#ffffff" },
  { key: "cream", name: "Tinted page", hex: "#f6f1e7" },
  { key: "dark", name: "Dark page", hex: "#171717" },
] as const;

/** Every sale a product page can be asked to draw. The regular price is
 *  crossed out in each; the ticket says what that price is. */
const SALES: { key: HarnessSale; name: string; note: string }[] = [
  { key: "proven", name: "Sale, with an end", note: "The regular price was the lowest of the 30 days before: a percentage, and a date." },
  { key: "no-end", name: "Sale, no end date", note: "The same ticket without a date." },
  {
    key: "lower",
    name: "An earlier sale went lower",
    note: "The lowest price of the 30 days before is stated, and the percentage is measured against it.",
  },
  {
    key: "unproven",
    name: "Earlier prices not on record",
    note: "No percentage. The crossed-out price is called what it is: the regular price.",
  },
];

/** The two ways the page crosses the regular price out. */
const LOOKS: Record<ProductPageSaleStyle, string> = { strike: "Line", slash: "Slash" };

/** Every way the checkout's code field can stand. */
const CODES: { key: string; name: string; terms: CodeTerms | null; outdone: boolean }[] = [
  { key: "closed", name: "No code yet", terms: null, outdone: false },
  { key: "percent", name: "A percentage code", terms: { code: "SUMMER10", value: { type: "percent", percentOff: 10 } }, outdone: false },
  {
    key: "amount",
    name: "An amount code",
    terms: { code: "WELCOME5", value: { type: "amount", amountOffCents: 500, currency: "EUR" } },
    outdone: false,
  },
  {
    key: "outdone",
    name: "A code the sale already beats",
    terms: { code: "INSTA10", value: { type: "percent", percentOff: 10 } },
    outdone: true,
  },
];

/** The form's worked example, on the products that stretch it: a photo, a
 *  long name, no photo at all, and a price with little room to come down. */
const EXAMPLES: { key: string; name: string; product: number; kind: DiscountKind; value: DiscountValue }[] = [
  { key: "percent", name: "A percentage sale", product: 0, kind: "automatic", value: { type: "percent", percentOff: 10 } },
  { key: "amount", name: "An amount code", product: 2, kind: "code", value: { type: "amount", amountOffCents: 500, currency: "EUR" } },
  { key: "long", name: "A long name, a big price", product: 3, kind: "automatic", value: { type: "percent", percentOff: 25 } },
  { key: "no-photo", name: "No photo", product: 1, kind: "code", value: { type: "percent", percentOff: 40 } },
];

/** The form, as each seller meets it: a new discount, a code being edited,
 *  and a sale that has started (only its end can change). */
const FORMS = { new: "New discount", code: "Editing a code", started: "Editing a running sale" } as const;
type FormCase = keyof typeof FORMS;

const PAGE_WIDTHS = { phone: { label: "Phone", px: 390 }, desktop: { label: "Desktop", px: 1180 } } as const;
type PageWidth = keyof typeof PAGE_WIDTHS;

/** The pretend shop, as the product page reads it. */
const STOREFRONT: ProductPageStorefront = {
  id: "00000000-0000-4000-8000-000000000000",
  name: "Clay House",
  theme: HARNESS_THEME,
  header: { show: true, name: "Clay House", bio: "" },
  productPage: DEFAULT_PRODUCT_PAGE_CONFIG,
  shippingPolicy: HARNESS_SHIPPING,
  seller: HARNESS_SELLER,
  backgroundImageUrl: null,
  customFontUrl: null,
  checkout: true,
};

function Section({ id, title, note, children }: { id: string; title: string; note: string; children: ReactNode }) {
  return (
    <section id={id} data-gallery-section={id} className="flex scroll-mt-6 flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="font-inter text-sm text-muted-foreground">{note}</p>
      </div>
      {children}
    </section>
  );
}

/** A patch of a buyer's page: its backdrop, its ink, and the radius and
 *  overlay tokens the hosted pages set, so what is inside draws as it does
 *  there. */
function Surface({ hex, className, children }: { hex: string; className?: string; children: ReactNode }) {
  const ink = readableOn(hex);
  return (
    <div
      className={cn("border border-border p-4", className)}
      style={{ ...storefrontOverlayVars(ink, HARNESS_THEME.cornerRadius), backgroundColor: hex, color: ink }}
      data-surface={hex}
    >
      {children}
    </div>
  );
}

export function DiscountsGallery({ fixtures, now }: { fixtures: DiscountFixtures; now: string }) {
  const [discounts, setDiscounts] = useState(fixtures.discounts);
  const [width, setWidth] = useState<Width>("desktop");
  const [role, setRole] = useState<Role>("owner");
  const [pageWidth, setPageWidth] = useState<PageWidth>("phone");
  const [look, setLook] = useState<ProductPageSaleStyle>("strike");
  const [formCase, setFormCase] = useState<FormCase>("new");
  const formDiscount =
    formCase === "new"
      ? null
      : (fixtures.discounts.find((discount) =>
          formCase === "code"
            ? discount.kind === "code" && discount.usageLimit !== null
            : discount.kind === "automatic" && Date.parse(discount.startsAt) <= Date.parse(now),
        ) ?? null);

  const items = useMemo(() => {
    const performance = new Map(fixtures.performance.map((sold) => [sold.discountId, sold]));
    return summarizeDiscounts(discounts, performance, new Map(), new Date(now)).items;
  }, [discounts, fixtures.performance, now]);

  const patch = (id: string, change: Partial<(typeof discounts)[number]>) =>
    setDiscounts((all) => all.map((discount) => (discount.id === id ? { ...discount, ...change } : discount)));

  return (
    <main className="min-h-screen bg-background px-6 py-8 text-foreground">
      <div className="mx-auto flex max-w-7xl flex-col gap-12">
        <header className="flex flex-col gap-3">
          <h1 className="font-inter text-lg font-semibold">Discounts</h1>
          <nav aria-label="Sections" className="flex flex-wrap gap-x-4 gap-y-1 font-inter text-sm">
            <a href="#seller" className="underline underline-offset-4">
              The seller&apos;s list
            </a>
            <a href="#form" className="underline underline-offset-4">
              The form
            </a>
            <a href="#form-example" className="underline underline-offset-4">
              The form&apos;s example
            </a>
            <a href="#product-page" className="underline underline-offset-4">
              Buyers: product page
            </a>
            <a href="#checkout" className="underline underline-offset-4">
              Buyers: checkout
            </a>
          </nav>
        </header>

        <Section
          id="seller"
          title="The seller's list"
          note="One ticket per discount, in every state. The stub is ink while the discount is live. The products fact opens."
        >
          <div className="flex flex-wrap items-center gap-3">
            <SegmentedControl
              ariaLabel="Width"
              value={width}
              onChange={setWidth}
              options={(Object.keys(WIDTHS) as Width[]).map((value) => ({ value, label: WIDTHS[value].label }))}
            />
            <SegmentedControl
              ariaLabel="Role"
              value={role}
              onChange={setRole}
              options={(Object.keys(ROLES) as Role[]).map((value) => ({ value, label: ROLES[value] }))}
            />
            <button
              type="button"
              className={cn(secondaryButtonClass, "px-3 py-1.5 text-xs")}
              onClick={() => setDiscounts(fixtures.discounts)}
            >
              Reset
            </button>
          </div>
          <ul className={cn("flex w-full flex-col gap-3", WIDTHS[width].className)}>
            {items.map((item) => (
              <DiscountRow
                key={item.discount.id}
                item={item}
                products={coveredProducts(item.discount, fixtures.products)}
                canWrite={role === "owner"}
                busy={false}
                onToggle={(enabled) => patch(item.discount.id, { enabled })}
                onEnd={() => patch(item.discount.id, { endsAt: now })}
                onDelete={() => setDiscounts((all) => all.filter((discount) => discount.id !== item.discount.id))}
              />
            ))}
          </ul>
          <div className={cn("flex w-full flex-col gap-2", WIDTHS[width].className)} data-discounts-loading="">
            <h3 className={eyebrowClass}>While the list loads</h3>
            <DiscountsSkeleton />
          </div>
        </Section>

        <Section
          id="form"
          title="The form"
          note="The discount form on the fixtures' catalogue, at the dashboard's form width. Saving needs a signed-in seller, so it answers with an error here."
        >
          <SegmentedControl
            ariaLabel="Form"
            value={formCase}
            onChange={setFormCase}
            options={(Object.keys(FORMS) as FormCase[]).map((value) => ({ value, label: FORMS[value] }))}
          />
          <div className="w-full max-w-3xl" data-discount-form-case={formCase}>
            <ToastProvider>
              <DiscountForm
                key={formCase}
                discount={formDiscount}
                products={fixtures.products}
                chipHref={settingHref(SALE_CHIP_SETTING_ID)}
              />
            </ToastProvider>
          </div>
        </Section>

        <Section
          id="form-example"
          title="The form's example"
          note="What closes the discount form's summary: the discount worked on one product, its photo stamped with what comes off, the regular price struck through beside the new one."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            {EXAMPLES.map((example) => {
              const product = fixtures.products[example.product];
              return (
                <div key={example.key} className="flex flex-col gap-2" data-example-specimen={example.key}>
                  <h3 className={eyebrowClass}>{example.name}</h3>
                  <div className="border border-border bg-secondary/40 px-4 pb-4">
                    <DiscountExample
                      product={product}
                      value={example.value}
                      nowCents={priceOfOne(example.kind, example.value, product.priceCents, product.currency)}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </Section>

        <Section
          id="product-page"
          title="Buyers: on the product page"
          note="The regular price is crossed out beside the sale price, in one of two looks the seller picks. The ticket under it, in the page's own ink, says what the crossed-out price is."
        >
          <SegmentedControl
            ariaLabel="Sale look"
            value={look}
            onChange={setLook}
            options={PRODUCT_PAGE_SALE_STYLES.map((value) => ({ value, label: LOOKS[value] }))}
          />
          <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4" data-sale-look={look}>
            {SALES.map((sale) => (
              <div key={sale.key} className="flex flex-col gap-2" data-sale-specimen={sale.key}>
                <div className="flex flex-col gap-0.5">
                  <h3 className={eyebrowClass}>{sale.name}</h3>
                  <p className="font-inter text-xs text-muted-foreground">{sale.note}</p>
                </div>
                {SURFACES.map((surface) => {
                  const product = harnessProduct(false, sale.key);
                  return (
                    <Surface key={surface.key} hex={surface.hex}>
                      <ProductPrice
                        priceCents={product.priceCents}
                        currency={product.currency}
                        sale={product.sale}
                        saleStyle={look}
                        priceNote="incl-vat"
                        shippingNote="plus-shipping"
                        isDigital={false}
                        ink={readableOn(surface.hex)}
                        radius={HARNESS_THEME.cornerRadius}
                      />
                    </Surface>
                  );
                })}
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <h3 className={eyebrowClass}>The whole page</h3>
              <SegmentedControl
                ariaLabel="Page width"
                value={pageWidth}
                onChange={setPageWidth}
                options={(Object.keys(PAGE_WIDTHS) as PageWidth[]).map((value) => ({
                  value,
                  label: PAGE_WIDTHS[value].label,
                }))}
              />
            </div>
            {/* The real page in the editor's preview mode, at the chosen width
                (it lays out by its own container, so a narrow frame is a phone). */}
            <div
              className="max-w-full overflow-hidden border border-border"
              style={{ width: PAGE_WIDTHS[pageWidth].px }}
              data-product-page-frame={pageWidth}
            >
              <ProductPageView
                page={{
                  storefront: { ...STOREFRONT, productPage: { ...DEFAULT_PRODUCT_PAGE_CONFIG, saleStyle: look } },
                  product: harnessProduct(false, "proven"),
                  productUrl: "https://example.test/s/clay-house/p/stoneware-vase",
                }}
                mode="preview"
              />
            </div>
          </div>
        </Section>

        <Section
          id="checkout"
          title="Buyers: at checkout"
          note="An applied code becomes a ticket: what it takes off on the stub, the code and what became of it beside it. The stub greys when the running sale is already the better price."
        >
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {CODES.map((code) => (
              <div key={code.key} className="flex flex-col gap-2" data-code-specimen={code.key}>
                <h3 className={eyebrowClass}>{code.name}</h3>
                {SURFACES.map((surface) => (
                  <Surface key={surface.key} hex={surface.hex} className="flex flex-col">
                    <DiscountCodeProvider initialTerms={code.terms}>
                      <DiscountCodeField
                        storefrontId={STOREFRONT.id}
                        productId={harnessProduct(false).id}
                        preview
                        outdone={code.outdone}
                        ink={readableOn(surface.hex)}
                      />
                    </DiscountCodeProvider>
                  </Surface>
                ))}
              </div>
            ))}
          </div>
          <p className="font-inter text-sm text-muted-foreground">
            The whole checkout, with the product on sale:{" "}
            <a href="/dev/checkout?sale=1" className="text-foreground underline underline-offset-4">
              /dev/checkout?sale=1
            </a>{" "}
            (add <code>&amp;w=390</code> for a phone).
          </p>
        </Section>
      </div>
    </main>
  );
}
