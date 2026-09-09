"use client";

import { useId } from "react";
import { formatCents } from "@/lib/format/money";
import type { Currency } from "@/types/product";
import { PageSelect } from "./PageSelect";
import { useQuantity } from "./QuantityContext";

/**
 * How many. One control, and a closed list rather than a number field.
 *
 * A CLOSED LIST IS THE POINT, not a stylistic preference. An `<input
 * type="number">` is a text box a browser puts arrows on: it accepts "1e3",
 * accepts a paste, and hands the page a string it then has to defend against.
 * A list can only ever emit one of the values it was handed — PageSelect
 * commits by index into its own options array, with no text path in or out —
 * so the shape of the control is the first thing standing between a buyer and
 * a forged quantity.
 *
 * It is only the first thing, and deliberately not the load-bearing one. The
 * options are built from a server-decided limit, every change is re-clamped
 * against that limit in the provider, and none of it authorizes a sale: that
 * is lib/products/order-quantity.ts, which re-reads the ceiling itself.
 *
 * The control is omitted entirely when there is nothing to choose: a product
 * sold one at a time, or one that is sold out. A dropdown with a single entry
 * is a decision a buyer is asked to make and then not allowed to make.
 */
export function QuantityPicker({
  priceCents,
  currency,
  radius,
  ink,
}: {
  /** Unit price, for the line total under the control. */
  priceCents: number;
  currency: Currency;
  radius: number;
  ink: string;
}) {
  // Minted rather than spelled out: the editor can have a product page beside
  // other surfaces, and a duplicated id would point the label at the wrong
  // control.
  const controlId = useId();
  const { quantity, limit, setQuantity } = useQuantity();
  if (limit <= 1) return null;

  const total = priceCents * quantity;

  return (
    <div
      className="flex flex-col gap-2"
      data-product-quantity={quantity}
      data-quantity-limit={limit}
    >
      <label className="text-sm opacity-70" htmlFor={controlId}>
        Quantity
      </label>
      {/* The same control as an option group's dropdown, from the same file:
          two lists sitting one above the other in the buy box have no business
          looking like two different things. */}
      <PageSelect
        id={controlId}
        label="Quantity"
        value={String(quantity)}
        onChange={(next) => setQuantity(Number(next))}
        options={Array.from({ length: limit }, (_, index) => ({
          value: String(index + 1),
          label: String(index + 1),
        }))}
        radius={radius}
        ink={ink}
        className="w-28"
      />
      {/* Only once there is arithmetic to show. At one unit the total is the
          price already printed above it, and repeating it reads as a second,
          different number. */}
      {quantity > 1 && (
        <p className="text-sm opacity-70" data-product-line-total={total}>
          {quantity} × {formatCents(priceCents, currency)} ={" "}
          <span className="font-medium opacity-100">{formatCents(total, currency)}</span>
        </p>
      )}
    </div>
  );
}
