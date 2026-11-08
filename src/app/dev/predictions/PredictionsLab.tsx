"use client";

import { useState, type ReactNode } from "react";
import { Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { AppLink } from "@/components/ui/AppLink";
import { AddOnsPicker } from "@/components/products/AddOnsPicker";
import { OptionsField } from "@/components/products/OptionsField";
import { StarterSuggestions, type Starter } from "@/components/products/StarterSuggestions";
import { initialDetailsValues } from "@/components/products/form-values";
import type { ExtraSectionId } from "@/components/products/FormExtrasPicker";
import {
  chipButtonClass,
  fieldBaseClass,
  helpTextClass,
  iconButtonClass,
  infoTextClass,
  inlineLinkClass,
  labelClass,
} from "@/components/ui/control-styles";
import { cardClass, eyebrowClass, pageShellClass, pageSubtitleClass, pageTitleClass } from "@/components/ui/surface-styles";
import { carrierName } from "@/lib/orders/carriers";
import {
  addOnHabits,
  carrierFor,
  carrierHabits,
  embedDomainsElsewhere,
  firstPlaceable,
  forecastRestocks,
  predictDiscountDefaults,
  predictProductDefaults,
  predictShippingDefaults,
  rankProductsToPlace,
  type RecentProduct,
} from "@/lib/predictions";
import type { AddOnChoice } from "@/lib/products/add-on-choices";
import { guessSizes, nextOptionValues } from "@/lib/products/option-guesses";
import { splitOptionInput } from "@/lib/products/option-presets";
import { cn } from "@/lib/utils";
import type { DiscountView } from "@/types/discount";
import { CARRIER_IDS, type CarrierId } from "@/types/order-view";
import type { Product, ProductOptionGroup } from "@/types/product";
import {
  SCENARIOS,
  type LabDiscount,
  type LabOffer,
  type LabOrder,
  type LabPlaceable,
  type LabProduct,
  type LabShipment,
  type LabStock,
  type Scenario,
} from "./scenarios";

/**
 * THE PREDICTIONS LAB: every suggestion lib/predictions.ts and
 * lib/products/option-guesses.ts make, worked out live from a made-up store
 * that can be edited row by row. The new-product card at the top is the real
 * head start (StarterSuggestions) and the real options editor, so "Same as",
 * the size guess, the next-option chips and the undo arrow can be clicked as a
 * seller would. Nothing here reaches a server.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const COUNTRIES = ["IE", "FR", "DE", "PT", "ES", "IT", "NL", "PL", "CZ", "SK", "US", "CA"] as const;
const PROFILES = ["bulky"];

/** Titles to try the size guess on, in the languages sellers write in. */
const SAMPLE_TITLES = [
  "Organic cotton T-shirt",
  "Oversized hoodie",
  "Linen summer dress",
  "Kapuzenpullover",
  "Camiseta de algodón",
  "Bavlněné tričko",
  "Kids T-shirt",
  "Leather boots",
  "T-shirt sewing pattern",
  "Coat hanger",
  "Christmas tree skirt",
  "Ceramic mug",
].join("\n");

const MAKER = {
  manufacturerName: "Kiln and Co",
  manufacturerAddress: "1 Clay Road, Porto",
  manufacturerEmail: "hello@kiln.example",
  responsibleName: "EU Contact Ltd",
};

/** "Size: S, M | Colour: Sand" as option groups. */
function parseOptions(text: string, product: string): ProductOptionGroup[] {
  return text
    .split("|")
    .map((part) => part.split(":"))
    .filter(([name, values]) => name?.trim() && values?.trim())
    .map(([name, values], group) => ({
      id: `${product}-${group}`,
      name: name!.trim(),
      display: "chip" as const,
      options: splitOptionInput(values!).map((option, index) => ({
        id: `${product}-${group}-${index}`,
        name: option,
        available: true,
      })),
    }));
}

function toRecent(product: LabProduct): RecentProduct {
  return {
    title: product.title,
    currency: product.currency,
    shippingProfileId: product.profile || null,
    optionGroups: parseOptions(product.options, product.title),
    lowStockThreshold: product.lowStock,
    maxPerOrder: product.maxPerOrder,
    details: {
      dimensions: { length: 10, width: 10, height: 10, unit: product.unit },
      ...(product.materials ? { materials: product.materials } : {}),
      ...(product.origin ? { origin: product.origin } : {}),
      ...(product.maker ? { safety: MAKER } : {}),
      badges: splitOptionInput(product.badges).map((label) => ({ icon: "hand-heart", label })),
    },
  };
}

/** Every product the add-on history names, as the picker lists it, by title. */
function addOnChoices(orders: readonly LabOrder[], offers: readonly LabOffer[]): AddOnChoice[] {
  const titles = new Set([
    ...offers.flatMap((offer) => [offer.title, ...splitOptionInput(offer.addOns)]),
    ...orders.flatMap((order) => splitOptionInput(order.products)),
  ]);
  return [...titles]
    .filter((title) => title.trim())
    .map((title) => ({
      id: title,
      title,
      priceCents: 1200,
      sale: null,
      currency: "EUR",
      imageUrl: null,
      status: "active",
      isDigital: false,
      soldOut: false,
      takenDown: false,
    }));
}

/** Counts by product, as "Wool scarf (2)". */
const counted = (counts: Readonly<Record<string, number>>) =>
  Object.entries(counts)
    .map(([id, count]) => `${id} (${count})`)
    .join(", ");

function toDiscount({ percent, days, channel }: LabDiscount): DiscountView {
  const startsAt = "2026-10-01T10:00:00.000Z";
  return {
    value: { type: "percent", percentOff: percent },
    startsAt,
    endsAt: days > 0 ? new Date(Date.parse(startsAt) + days * DAY_MS).toISOString() : null,
    shareChannel: channel || null,
  } as DiscountView;
}

/** A field in a row editor. */
type Column<T> = {
  key: keyof T & string;
  label: string;
  kind: "text" | "number" | "check" | "select";
  options?: readonly string[];
  width?: string;
};

/** A table of made-up records, each cell editable, rows added and removed. */
function Rows<T extends Record<string, unknown>>({
  rows,
  columns,
  blank,
  onChange,
  name,
}: {
  rows: T[];
  columns: Column<T>[];
  blank: T;
  onChange: (rows: T[]) => void;
  name: string;
}) {
  const set = (index: number, key: keyof T, value: unknown) =>
    onChange(rows.map((row, at) => (at === index ? { ...row, [key]: value } : row)));
  return (
    <div className="space-y-2">
      {/* relative: the hidden "Remove" header would otherwise escape the
          scrolling box and widen the page on a phone. */}
      <div className="relative overflow-x-auto">
        <table className="w-full border-collapse font-inter text-xs">
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.key} className="px-1 py-1 text-left font-medium text-muted-foreground">
                  {column.label}
                </th>
              ))}
              <th className="sr-only">Remove</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index} className="border-t border-border">
                {columns.map((column) => (
                  <td key={column.key} className={cn("px-1 py-1 align-middle", column.width)}>
                    {column.kind === "check" ? (
                      <input
                        type="checkbox"
                        checked={Boolean(row[column.key])}
                        aria-label={`${name} ${index + 1} ${column.label}`}
                        onChange={(event) => set(index, column.key, event.target.checked)}
                      />
                    ) : column.kind === "select" ? (
                      <select
                        value={String(row[column.key])}
                        aria-label={`${name} ${index + 1} ${column.label}`}
                        onChange={(event) => set(index, column.key, event.target.value)}
                        className={cn(fieldBaseClass, "px-1 py-1 text-xs")}
                      >
                        {column.options!.map((option) => (
                          <option key={option} value={option}>
                            {option || "store terms"}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type={column.kind}
                        value={String(row[column.key])}
                        aria-label={`${name} ${index + 1} ${column.label}`}
                        onChange={(event) =>
                          set(index, column.key, column.kind === "number" ? Number(event.target.value) : event.target.value)
                        }
                        className={cn(fieldBaseClass, "min-w-16 px-1.5 py-1 text-xs")}
                      />
                    )}
                  </td>
                ))}
                <td className="px-1 py-1">
                  <button
                    type="button"
                    aria-label={`Remove ${name} ${index + 1}`}
                    onClick={() => onChange(rows.filter((_, at) => at !== index))}
                    className={cn(iconButtonClass, "size-7")}
                  >
                    <X className="size-3.5" strokeWidth={2} aria-hidden="true" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button type="button" className={chipButtonClass} onClick={() => onChange([blank, ...rows])}>
        <Plus className="size-3.5" strokeWidth={2} aria-hidden="true" />
        Add a newer {name}
      </button>
    </div>
  );
}

function Card({ title, about, children, wide = false }: { title: string; about: string; children: ReactNode; wide?: boolean }) {
  return (
    // min-w-0: a grid item otherwise grows to its widest table and widens the page.
    <section className={cn(cardClass, "min-w-0 space-y-4 p-5", wide && "lg:col-span-2")}>
      <div>
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        <p className={helpTextClass}>{about}</p>
      </div>
      {children}
    </section>
  );
}

/** One prediction, said as the screen would act on it. */
function Said({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 border-t border-border py-1.5 font-inter text-sm" data-lab-said={label}>
      <span className="w-44 shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 text-foreground">{children}</span>
    </div>
  );
}

const none = <span className="text-muted-foreground">nothing (the usual default)</span>;

export function PredictionsLab() {
  const [scenario, setScenario] = useState<Scenario>(SCENARIOS[1]!);
  const [products, setProducts] = useState(scenario.products);
  const [discounts, setDiscounts] = useState(scenario.discounts);
  const [shipments, setShipments] = useState(scenario.shipments);
  const [stock, setStock] = useState(scenario.stock);
  const [catalogue, setCatalogue] = useState(scenario.catalogue);
  const [businessCountry, setBusinessCountry] = useState(scenario.businessCountry);
  const [domains, setDomains] = useState(scenario.domains);
  const [orders, setOrders] = useState(scenario.orders);
  const [offers, setOffers] = useState(scenario.offers);
  // The product whose "Add to your order" is being chosen; "" is a new one.
  const [offering, setOffering] = useState(scenario.offers[0]?.title ?? "");
  const [offered, setOffered] = useState<string[]>([]);
  // The new product being tried in the real head start and options editor.
  const [title, setTitle] = useState("");
  const [form, setForm] = useState<Starter>({ optionGroups: [], details: initialDetailsValues() });
  const [opened, setOpened] = useState<ExtraSectionId[]>([]);
  const [titles, setTitles] = useState(SAMPLE_TITLES);
  const [optionsSoFar, setOptionsSoFar] = useState("Small");
  const [destination, setDestination] = useState("FR");
  const tRestock = useTranslations("Dashboard.attention.restock");

  function load(next: Scenario) {
    setScenario(next);
    setProducts(next.products);
    setDiscounts(next.discounts);
    setShipments(next.shipments);
    setStock(next.stock);
    setCatalogue(next.catalogue);
    setBusinessCountry(next.businessCountry);
    setDomains(next.domains);
    setOrders(next.orders);
    setOffers(next.offers);
    setOffering(next.offers[0]?.title ?? "");
    setOffered([]);
    setTitle("");
    setForm({ optionGroups: [], details: initialDetailsValues() });
    setOpened([]);
  }

  const now = new Date();
  const recent = products.map(toRecent);
  const suggested = predictProductDefaults(recent, PROFILES, businessCountry || undefined);
  const discountsSaid = predictDiscountDefaults(discounts.map(toDiscount));
  const habits = carrierHabits(shipments);
  const restocks = forecastRestocks(
    stock.map((row) => ({ id: row.title, title: row.title, stockQuantity: row.stock, lowStockThreshold: row.lowStock })),
    Object.fromEntries(stock.map((row) => [row.title, row.sold])),
  );
  const placeable: Product[] = catalogue.map(
    (row) =>
      ({
        id: row.title,
        title: row.title,
        status: row.status,
        trackStock: row.soldOut,
        stockQuantity: row.soldOut ? 0 : null,
      }) as Product,
  );
  const touched = [...catalogue].sort((a, b) => a.touchedDaysAgo - b.touchedDaysAgo)[0];
  const ghost = firstPlaceable(
    rankProductsToPlace(
      placeable,
      Object.fromEntries(catalogue.map((row) => [row.title, { unitsSold: row.sold, revenueCents: 0, currency: "EUR" as const }])),
      touched ? { id: touched.title, at: new Date(now.getTime() - touched.touchedDaysAgo * DAY_MS).toISOString() } : null,
      now,
    ),
  );
  const shipping = predictShippingDefaults(
    recent.map((product) => product.currency),
    businessCountry || undefined,
  );
  const storefronts = domains
    .split("\n")
    .map((line) => line.split(":"))
    .filter(([name, list]) => name?.trim() && list?.trim())
    .map(([name, list], index) => ({ id: `s${index}`, name: name!.trim(), domains: splitOptionInput(list!) }));
  const embed = embedDomainsElsewhere(storefronts, "new");
  const choices = addOnChoices(orders, offers);
  const addOnHistory = addOnHabits(
    offering || null,
    orders.map((order) => ({ buyer: order.buyer, productIds: splitOptionInput(order.products) })),
    offers.map((offer) => ({ id: offer.title, addOnIds: splitOptionInput(offer.addOns) })),
  );

  return (
    <main className={cn(pageShellClass, "space-y-6")} data-predictions-lab="">
      <header className="space-y-3">
        <h1 className={pageTitleClass}>Predictions lab</h1>
        <p className={pageSubtitleClass}>
          Pick a store, edit its history, and see what every screen would offer. Rows are newest first, as the app
          reads them. AI writing help has its own lab:{" "}
          <AppLink href="/dev/ai-writing" className={inlineLinkClass}>
            /dev/ai-writing
          </AppLink>
          .
        </p>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Scenarios">
          {SCENARIOS.map((candidate) => (
            <button
              key={candidate.name}
              type="button"
              className={chipButtonClass}
              aria-pressed={candidate.name === scenario.name}
              onClick={() => load(candidate)}
            >
              {candidate.name}
            </button>
          ))}
        </div>
        <p className={infoTextClass}>{scenario.about}</p>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card
          wide
          title="New product: the head start"
          about="The real chips under a new product's title and the real options editor. Type a title, tap a chip, tap the arrow to undo, add a size and watch the next ones appear."
        >
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label htmlFor="lab-title" className={labelClass}>
                  Title
                </label>
                <input
                  id="lab-title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Try: Linen shirt, Hoodie, Leather boots"
                  className={cn(fieldBaseClass, "py-3 text-lg font-medium")}
                />
                <StarterSuggestions
                  sameAs={suggested.sameAs}
                  title={title}
                  isDigital={false}
                  current={form}
                  onApply={(next, open) => {
                    const fresh = open.filter((id) => !opened.includes(id));
                    setForm(next);
                    setOpened([...opened, ...fresh]);
                    return fresh;
                  }}
                  onUndo={(before, closed) => {
                    setForm(before);
                    setOpened(opened.filter((id) => !closed.includes(id)));
                  }}
                />
              </div>
              <div className="space-y-1.5">
                <p className={eyebrowClass}>Options</p>
                <OptionsField
                  inputId="lab-options"
                  groups={form.optionGroups}
                  onChange={(optionGroups) => setForm({ ...form, optionGroups })}
                />
              </div>
            </div>
            <div className="space-y-1">
              <p className={eyebrowClass}>Filled in</p>
              <Said label="Sections opened">{opened.length > 0 ? opened.join(", ") : "none"}</Said>
              <Said label="Materials">{form.details.materials || "empty"}</Said>
              <Said label="Origin">{form.details.origin || "empty"}</Said>
              <Said label="Maker">{form.details.safety.manufacturerName || "empty"}</Said>
              <Said label="EU contact">{form.details.safety.responsibleName || "empty"}</Said>
              <p className={cn(eyebrowClass, "pt-3")}>Starts on (silent defaults)</p>
              <Said label="Currency">{suggested.currency ?? none}</Said>
              <Said label="Shipping">{suggested.shippingProfileId ?? none}</Said>
              <Said label="Units">{suggested.dimensionUnit ?? none}</Said>
              <Said label="Low-stock alert">{suggested.lowStockThreshold ?? none}</Said>
              <Said label="Limit per order">{suggested.maxPerOrder ?? none}</Said>
              <Said label="Own badges first">{suggested.badges?.map((badge) => badge.label).join(", ") || none}</Said>
            </div>
          </div>
        </Card>

        <Card
          title="Recent products"
          about="What the new product form learns from. Options as “Size: S, M | Colour: Sand”."
          wide
        >
          <Rows<LabProduct>
            name="product"
            rows={products}
            onChange={setProducts}
            blank={{ ...SCENARIOS[1]!.products[2]!, title: "New product", materials: "", badges: "" }}
            columns={[
              { key: "title", label: "Title", kind: "text" },
              { key: "currency", label: "Currency", kind: "select", options: ["EUR", "USD"] },
              { key: "profile", label: "Shipping", kind: "select", options: ["", "bulky"] },
              { key: "unit", label: "Unit", kind: "select", options: ["cm", "in"] },
              { key: "lowStock", label: "Low stock", kind: "number", width: "w-20" },
              { key: "maxPerOrder", label: "Max/order", kind: "number", width: "w-20" },
              { key: "options", label: "Options", kind: "text" },
              { key: "materials", label: "Materials", kind: "text" },
              { key: "origin", label: "Origin", kind: "text" },
              { key: "maker", label: "Maker", kind: "check" },
              { key: "badges", label: "Badges", kind: "text" },
            ]}
          />
        </Card>

        <Card title="Size guesses" about="One title per line: what the chip under the title would offer.">
          <textarea
            aria-label="Titles to try"
            value={titles}
            onChange={(event) => setTitles(event.target.value)}
            rows={6}
            className={cn(fieldBaseClass, "font-mono text-xs")}
          />
          <div>
            {titles
              .split("\n")
              .filter((line) => line.trim())
              .map((line, index) => {
                const sizes = guessSizes(line);
                return (
                  <Said key={`${line}-${index}`} label={line}>
                    {sizes === null ? (
                      <span className="text-muted-foreground">no chip (not sure)</span>
                    ) : sizes.length > 0 ? (
                      `Sizes ${sizes[0]} to ${sizes[sizes.length - 1]}`
                    ) : (
                      "Sizes (empty group, the seller's own)"
                    )}
                  </Said>
                );
              })}
          </div>
          <div className="space-y-1.5 pt-2">
            <label htmlFor="lab-next" className={labelClass}>
              Options so far
            </label>
            <input
              id="lab-next"
              value={optionsSoFar}
              onChange={(event) => setOptionsSoFar(event.target.value)}
              className={cn(fieldBaseClass, "py-1.5 text-sm")}
            />
            <Said label="Offered next">
              {nextOptionValues(splitOptionInput(optionsSoFar)).join(", ") || (
                <span className="text-muted-foreground">nothing (not sure)</span>
              )}
            </Said>
          </div>
        </Card>

        <Card
          title="Discounts"
          about="A new discount's percent and length follow the newest three when they all agree (two at least); days 0 is no end."
        >
          <Rows<LabDiscount>
            name="discount"
            rows={discounts}
            onChange={setDiscounts}
            blank={{ percent: 10, days: 7, channel: "" }}
            columns={[
              { key: "percent", label: "% off", kind: "number", width: "w-20" },
              { key: "days", label: "Days", kind: "number", width: "w-20" },
              { key: "channel", label: "Shared on", kind: "text" },
            ]}
          />
          <div>
            <Said label="Percent">{discountsSaid.percent ? `${discountsSaid.percent}%` : none}</Said>
            <Said label="Runs for">{discountsSaid.days ? `${discountsSaid.days} days` : none}</Said>
            <Said label="Own channels first">{discountsSaid.channels?.join(", ") || none}</Said>
          </div>
        </Card>

        <Card title="Shipped parcels" about="The ship form opens on the carrier this store last used to that country.">
          <Rows<LabShipment>
            name="parcel"
            rows={shipments}
            onChange={setShipments}
            blank={{ carrier: "dhl", country: "DE" }}
            columns={[
              { key: "carrier", label: "Carrier", kind: "select", options: CARRIER_IDS },
              { key: "country", label: "To", kind: "select", options: COUNTRIES },
            ]}
          />
          <div className="space-y-1.5">
            <label htmlFor="lab-destination" className={labelClass}>
              Next parcel goes to
            </label>
            <select
              id="lab-destination"
              value={destination}
              onChange={(event) => setDestination(event.target.value)}
              className={cn(fieldBaseClass, "py-1.5 text-sm")}
            >
              {COUNTRIES.map((country) => (
                <option key={country}>{country}</option>
              ))}
            </select>
            <Said label="Ship form opens on">
              {(() => {
                const carrier: CarrierId | null = carrierFor(habits, destination);
                return carrier ? carrierName(carrier) : "Other (no carrier)";
              })()}
            </Said>
          </div>
        </Card>

        <Card
          title="Stock and sales"
          about="Overview warns when a product sells out within a week at its 28-day pace. A low-stock alert of 0 turns it off."
        >
          <Rows<LabStock>
            name="product"
            rows={stock}
            onChange={setStock}
            blank={{ title: "New product", stock: 5, lowStock: 5, sold: 10 }}
            columns={[
              { key: "title", label: "Title", kind: "text" },
              { key: "stock", label: "In stock", kind: "number", width: "w-20" },
              { key: "lowStock", label: "Low stock", kind: "number", width: "w-20" },
              { key: "sold", label: "Sold, 28 days", kind: "number", width: "w-20" },
            ]}
          />
          <div>
            {restocks.length === 0 ? (
              <Said label="Overview">{none}</Said>
            ) : (
              <>
                <Said label="Overview row">{tRestock("label", { count: restocks.length })}</Said>
                {restocks.map((row) => (
                  <Said key={row.id} label={row.title}>
                    {tRestock("descriptionSingle", { title: row.title, days: row.daysLeft })}
                  </Said>
                ))}
              </>
            )}
          </div>
        </Card>

        <Card
          title="Empty storefront board"
          about="The ghost tile offers the likeliest product: touched this week, then best selling. The picker keeps the catalogue's own order."
        >
          <Rows<LabPlaceable>
            name="catalogue product"
            rows={catalogue}
            onChange={setCatalogue}
            blank={{ title: "New product", sold: 0, touchedDaysAgo: 0, status: "active", soldOut: false }}
            columns={[
              { key: "title", label: "Title", kind: "text" },
              { key: "sold", label: "Sold", kind: "number", width: "w-20" },
              { key: "touchedDaysAgo", label: "Touched (days ago)", kind: "number", width: "w-20" },
              { key: "status", label: "Status", kind: "select", options: ["active", "draft"] },
              { key: "soldOut", label: "Sold out", kind: "check" },
            ]}
          />
          <div>
            <Said label="Ghost tile">{ghost?.title ?? none}</Said>
            <Said label="Picker order">{catalogue.map((row) => row.title).join(", ") || none}</Said>
          </div>
        </Card>

        <Card
          wide
          title="Add to your order"
          about="The real add-ons picker for one product. Its chip offers what 2 or more buyers bought with it (in one order or two), or else what 2 or more of the seller's other products already offer. Orders list their products as “Mug, Coasters”."
        >
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="space-y-4">
              <Rows<LabOrder>
                name="order"
                rows={orders}
                onChange={setOrders}
                blank={{ buyer: "new@example.com", products: "" }}
                columns={[
                  { key: "buyer", label: "Buyer", kind: "text" },
                  { key: "products", label: "Products", kind: "text" },
                ]}
              />
              <Rows<LabOffer>
                name="product"
                rows={offers}
                onChange={setOffers}
                blank={{ title: "New product", addOns: "" }}
                columns={[
                  { key: "title", label: "Product", kind: "text" },
                  { key: "addOns", label: "Offers", kind: "text" },
                ]}
              />
            </div>
            <div className="space-y-2" data-lab-add-ons="">
              <label htmlFor="lab-offering" className={labelClass}>
                Choosing for
              </label>
              <select
                id="lab-offering"
                value={offering}
                onChange={(event) => {
                  setOffering(event.target.value);
                  setOffered([]);
                }}
                className={cn(fieldBaseClass, "py-1.5 text-sm")}
              >
                <option value="">a new product</option>
                {choices.map((choice) => (
                  <option key={choice.id}>{choice.title}</option>
                ))}
              </select>
              <AddOnsPicker
                key={offering}
                inputId="lab-add-ons"
                productId={offering || null}
                isDigital={false}
                currency="EUR"
                choices={choices}
                habits={addOnHistory}
                value={offered}
                onChange={setOffered}
              />
              <Said label="Bought with it">{counted(addOnHistory.boughtWith) || none}</Said>
              <Said label="Offered with others">{counted(addOnHistory.offeredWith) || none}</Said>
            </div>
          </div>
        </Card>

        <Card title="Settings" about="Shipping settings and a new storefront's embed page.">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="lab-country" className={labelClass}>
                Business country
              </label>
              <select
                id="lab-country"
                value={businessCountry}
                onChange={(event) => setBusinessCountry(event.target.value)}
                className={cn(fieldBaseClass, "py-1.5 text-sm")}
              >
                <option value="">not set</option>
                {COUNTRIES.map((country) => (
                  <option key={country}>{country}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <label htmlFor="lab-domains" className={labelClass}>
                Other storefronts&apos; embed domains (Name: a.example, b.example)
              </label>
              <textarea
                id="lab-domains"
                value={domains}
                onChange={(event) => setDomains(event.target.value)}
                rows={2}
                className={cn(fieldBaseClass, "font-mono text-xs")}
              />
            </div>
          </div>
          <div>
            <Said label="Ships from (one tap)">{shipping.shipsFrom ?? none}</Said>
            <Said label="Rates currency">{shipping.ratesCurrency ?? none}</Said>
            <Said label="Embed (one tap)">{embed ? `Same as ${embed.from}: ${embed.value.join(", ")}` : none}</Said>
          </div>
        </Card>
      </div>
    </main>
  );
}
