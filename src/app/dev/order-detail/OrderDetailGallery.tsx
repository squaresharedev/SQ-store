"use client";

import { OrderDetail } from "@/components/orders/OrderDetail";
import { OrderMailProvider } from "@/components/orders/OrderMailProvider";
import { ToastProvider } from "@/components/ui/Toast";
import { cn } from "@/lib/utils";
import type { OrderView } from "@/types/order-view";

/**
 * The order panel from fixtures, so each state can be looked at (and blurred:
 * can you still tell what is on each row?) without a signed-in seller. The
 * panel's own actions still call the real server action, which refuses without
 * a session, so opening the ship form is safe and sending it does nothing.
 */

const BASE: OrderView = {
  id: "fee1e988-1111-4111-8111-111111111111",
  productTitle: "Roundhouse Coffee Table",
  selection: [],
  quantity: 1,
  shipTo: {
    name: "Kai Tran",
    line1: "Calle Mayor 8",
    line2: "2B",
    city: "Madrid",
    postalCode: "28013",
    country: "ES",
    phone: "+34 612 345 678",
  },
  fulfilment: { status: "unfulfilled", shippedAt: null, trackingNumber: null, carrier: null },
  amountCents: 48000,
  platformFeeCents: 1440,
  platformFeeBps: 300,
  currency: "EUR",
  channel: "marketplace",
  status: "paid",
  buyerEmail: "kai.tran@example.com",
  createdAt: "2026-10-04T14:03:00.000Z",
  giftMessage: null,
  withdrawalRequestedAt: null,
  discount: null,
};

const SPECIMENS: { key: string; title: string; order: OrderView; mail?: boolean }[] = [
  { key: "waiting", title: "Waiting to ship", order: BASE },
  {
    key: "version-gift-discount",
    title: "Version, gift note, discount",
    order: {
      ...BASE,
      quantity: 2,
      selection: [
        { label: "Size", value: "Six seater" },
        { label: "Finish", value: "Walnut" },
      ],
      giftMessage: "Happy birthday, Mum!",
      channel: "button",
      discount: { cents: 4800, code: "SUMMER10", byCode: true },
    },
  },
  {
    key: "shipped",
    title: "Shipped, with tracking",
    order: {
      ...BASE,
      channel: "embed",
      fulfilment: {
        status: "shipped",
        shippedAt: "2026-10-05T09:00:00.000Z",
        trackingNumber: "RR123456789IE",
        carrier: "an-post",
      },
    },
  },
  { key: "no-address", title: "No delivery address", order: { ...BASE, shipTo: null, channel: "direct" } },
  { key: "mail-off", title: "Email switched off", order: BASE, mail: false },
  {
    key: "withdrawn",
    title: "Withdrawn by the buyer",
    order: { ...BASE, withdrawalRequestedAt: "2026-10-06T10:00:00.000Z" },
  },
  {
    key: "download",
    title: "A download (nothing to pack)",
    order: {
      ...BASE,
      shipTo: null,
      selection: [{ label: "Format", value: "PDF" }],
      fulfilment: { status: "not_required", shippedAt: null, trackingNumber: null, carrier: null },
    },
  },
];

function Specimen({ title, order, mail = true, dark }: { title: string; order: OrderView; mail?: boolean; dark: boolean }) {
  return (
    <figure data-specimen={`${dark ? "dark" : "light"}`} className="flex flex-col gap-2">
      <figcaption className="font-inter text-xs text-muted-foreground">
        {title}
        {dark ? " (dark)" : ""}
      </figcaption>
      {/* The panel's real width on a phone (OrderDetailSheet is full width there). */}
      <div className={cn("h-[820px] w-[390px] border border-border bg-background text-foreground", dark && "dark")}>
        <OrderMailProvider enabled={mail}>
          <OrderDetail order={order} onClose={() => {}} canFulfil />
        </OrderMailProvider>
      </div>
    </figure>
  );
}

export function OrderDetailGallery() {
  return (
    <ToastProvider>
      <main className="flex flex-col gap-8 bg-background p-6">
        <h1 className="font-inter text-lg font-semibold text-foreground">Order panel</h1>
        <div className="flex flex-wrap items-start gap-8">
          {SPECIMENS.map((s) => (
            <Specimen key={s.key} title={s.title} order={s.order} mail={s.mail} dark={false} />
          ))}
          <Specimen title="Version, gift note, discount" order={SPECIMENS[1].order} dark />
        </div>
      </main>
    </ToastProvider>
  );
}
