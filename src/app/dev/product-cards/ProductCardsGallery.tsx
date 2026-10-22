"use client";

import { useState, type MouseEvent } from "react";
import { ProductCard } from "@/components/products/ProductCard";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { ToastProvider, useToast } from "@/components/ui/Toast";
import { productGridClass } from "@/components/ui/surface-styles";
import { cn } from "@/lib/utils";
import { BESTSELLER_ID, CARD_FIXTURES } from "./fixtures";

/**
 * The real product card (components/products/ProductCard) on fixtures, at the
 * content-column widths the products page gives it, so every state can be
 * looked at without a signed-in seller. Links and menu actions are caught and
 * announced as toasts: nothing here navigates or reaches a server.
 */

/** The content column a card gets on each screen: the viewport less the
 *  256px sidebar (from md) and the page gutters, capped by max-w-7xl. */
const WIDTHS = {
  wide: { label: "1440", px: 1136 },
  laptop: { label: "1280", px: 976 },
  small: { label: "1024", px: 720 },
  phone: { label: "Phone", px: 342 },
} as const;
type Width = keyof typeof WIDTHS;

const ROLES = { owner: "Owner", viewer: "Viewer" } as const;
type Role = keyof typeof ROLES;

const THEMES = { light: "Light", dark: "Dark" } as const;
type Theme = keyof typeof THEMES;

function Gallery() {
  const toast = useToast();
  const [width, setWidth] = useState<Width>("laptop");
  const [role, setRole] = useState<Role>("owner");
  const [theme, setTheme] = useState<Theme>("light");

  // Every link on a card is real (the editor, the to-ship queue); here they
  // only say where they would go.
  function catchLinks(event: MouseEvent) {
    const link = (event.target as HTMLElement).closest("a[href]");
    if (!link) return;
    event.preventDefault();
    toast.info(`Opens ${link.getAttribute("href")}`);
  }

  return (
    <main className="flex min-h-screen flex-col gap-6 bg-background p-6 text-foreground">
      <header className="flex flex-col gap-4">
        <div>
          <h1 className="text-xl font-semibold">Product card</h1>
          <p className="mt-1 max-w-3xl font-inter text-sm text-muted-foreground">
            One shop with every state at once: a bestseller with orders waiting, low stock, sold out, untracked stock, a
            draft, no photo on no storefront, paused, in review and removed.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <SegmentedControl
            ariaLabel="Screen width"
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
          <SegmentedControl
            ariaLabel="Theme"
            value={theme}
            onChange={setTheme}
            options={(Object.keys(THEMES) as Theme[]).map((value) => ({ value, label: THEMES[value] }))}
          />
        </div>
      </header>

      <div
        onClickCapture={catchLinks}
        // content-box: the width is the column the cards get, the padding is the frame's.
        className={cn("box-content border border-dashed border-border bg-background p-3 text-foreground", theme === "dark" && "dark")}
        style={{ width: WIDTHS[width].px }}
      >
        <ul className={productGridClass}>
          {CARD_FIXTURES.map((f) => (
            <li key={f.product.id}>
              <ProductCard
                product={f.product}
                canWrite={role === "owner"}
                sales={f.sales}
                isBestseller={f.product.id === BESTSELLER_ID}
                storefrontCount={f.storefrontCount}
                toShip={f.toShip}
                onDelete={() => toast.info(`Delete "${f.product.title}"`)}
                onCopyLink={() => toast.info(f.storefrontCount ? "Copy link" : "Not on a storefront yet")}
                onOpenPage={() => toast.info(f.storefrontCount ? "Open page" : "Not on a storefront yet")}
                onBuyButton={() => toast.info("Add to your website")}
              />
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}

export function ProductCardsGallery() {
  return (
    <ToastProvider>
      <Gallery />
    </ToastProvider>
  );
}
