"use client";

import { useEffect, useState } from "react";
import { Shuffle, RotateCcw, PanelRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { pageShellClass } from "@/components/ui/surface-styles";
import { infoTextClass, panelEyebrowClass } from "@/components/ui/control-styles";
import {
  CART_ADD_FEEDBACK,
  CART_COUNT_STYLES,
  CART_FREE_LINES,
  CART_ICONS,
  CART_ROW_STYLES,
  CART_STEPPERS,
  CART_SUGGESTION_STYLES,
} from "@/components/cart/cart-look";
import { StorefrontCart } from "@/components/cart/StorefrontCart";
import { CART_AFTER_ADD, CART_MAIN_BUTTONS } from "@/types/storefront";
import { SAMPLE_CART_STATES } from "@/lib/cart/sample";
import { useCart } from "@/components/cart/CartContext";
import { LabCopyButtons, LabFitBadge, LabGroup, LabJsx, LabTabs, LabToggle } from "../lab-kit/controls";
import { LabLazy } from "../lab-kit/lazy";
import { LAB_SCENARIOS, LAB_SHOPS, LAB_STOREFRONT_ID, type LabScenarioId, type LabShopId } from "./fixtures";
import {
  LAB_DEFAULTS,
  LAB_DEVICES,
  LAB_PLACEMENTS,
  decodeState,
  encodeState,
  labJsx,
  lookOf,
  shuffle,
  withDefaults,
  type CartLabState,
  type LabPlacementId,
} from "./lab-model";
import { LAB_GROUPS, LAB_PRESETS, LAB_SHORTLIST, SHORTLIST_GROUP, type LabPreset } from "./presets";
import { Placement } from "./Placement";

/** One option list as a segmented control. */
function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly T[] | readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  const list = options.map((option) =>
    typeof option === "string" ? { value: option, label: option } : option,
  ) as { value: T; label: string }[];
  // Wrapping chips rather than one segmented row: some option names are long
  // and the controls column is narrow.
  return (
    <div className="flex flex-col gap-1.5" role="radiogroup" aria-label={label}>
      <span className={panelEyebrowClass}>{label}</span>
      <div className="flex flex-wrap gap-1">
        {list.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={option.value === value}
            onClick={() => onChange(option.value)}
            className={cn(
              "border px-2 py-1 text-xs transition-colors duration-base ease-standard",
              option.value === value
                ? "border-foreground bg-foreground text-background"
                : "border-border hover:bg-accent",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Opens the REAL cart panel (the dialog) with the lab's state. */
function OpenRealPanel() {
  const cart = useCart();
  return (
    <Button type="button" variant="secondary" onClick={() => cart?.setOpen(true)} data-cart-lab-open-panel="">
      <PanelRight className="size-4" aria-hidden="true" />
      Open the real panel
    </Button>
  );
}

function tilesFor(group: string): LabPreset[] {
  if (group === SHORTLIST_GROUP) {
    return LAB_SHORTLIST.flatMap((entry) => LAB_PRESETS.filter((preset) => preset.id === entry.id));
  }
  return LAB_PRESETS.filter((preset) => preset.group === group);
}

/**
 * THE CART LAB: the cart's look and the seller's cart options, tuned live
 * over three shops and the carts worth judging, and every ready-made
 * variation one tap from the playground. The address bar holds what is on
 * screen; Copy link sends it, Copy JSX gives the look's changes to CART_LOOK
 * (components/cart/cart-look.ts) and the seller's options as cartPage holds
 * them.
 */
export function CartLab() {
  const [state, setState] = useState<CartLabState>(() => decodeState(window.location.hash));
  const [group, setGroup] = useState<string>(SHORTLIST_GROUP);
  const [replay, setReplay] = useState(0);
  const hash = encodeState(state);

  useEffect(() => {
    window.history.replaceState(null, "", `#${hash}`);
  }, [hash]);

  // A pasted link (a hash change on the same page) loads its state.
  useEffect(() => {
    const follow = () => setState(decodeState(window.location.hash));
    window.addEventListener("hashchange", follow);
    return () => window.removeEventListener("hashchange", follow);
  }, []);

  const set = <K extends keyof CartLabState>(key: K, value: CartLabState[K]) =>
    setState((current) => ({ ...current, [key]: value }));
  const shop = LAB_SHOPS.find((entry) => entry.id === state.shop) ?? LAB_SHOPS[0];
  const jsx = labJsx(state);

  return (
    <div className={pageShellClass} data-cart-lab="">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-8">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">Cart lab</h1>
          <p className={infoTextClass}>
            How the cart looks, and the cart options a seller gets, over real components. Pick a tile, tune it, then
            Copy link or Copy JSX.
          </p>
        </header>

        <div className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <aside className="flex flex-col gap-5 lg:sticky lg:top-6 lg:self-start" data-cart-lab-controls="">
            <LabGroup title="Look">
              <Choice label="Line rows" value={state.rows} options={CART_ROW_STYLES} onChange={(value) => set("rows", value)} />
              <Choice label="Quantity" value={state.stepper} options={CART_STEPPERS} onChange={(value) => set("stepper", value)} />
              <Choice label="Icon" value={state.icon} options={CART_ICONS} onChange={(value) => set("icon", value)} />
              <Choice label="Count" value={state.count} options={CART_COUNT_STYLES} onChange={(value) => set("count", value)} />
              <Choice label="Free delivery" value={state.freeLine} options={CART_FREE_LINES} onChange={(value) => set("freeLine", value)} />
              <Choice label="After pressing" value={state.feedback} options={CART_ADD_FEEDBACK} onChange={(value) => set("feedback", value)} />
              <LabToggle id="cart-lab-bump" label="Count pops on add" checked={state.bump} onChange={(on) => set("bump", on)} />
              <Choice label="Goes well with" value={state.suggestions} options={CART_SUGGESTION_STYLES} onChange={(value) => set("suggestions", value)} />
            </LabGroup>
            <LabGroup title="Seller's options">
              <Choice label="Leading button" value={state.mainButton} options={CART_MAIN_BUTTONS} onChange={(value) => set("mainButton", value)} />
              <Choice label="After adding" value={state.afterAdd} options={CART_AFTER_ADD} onChange={(value) => set("afterAdd", value)} />
              <LabToggle id="cart-lab-delivery" label="Free-delivery line" checked={state.deliveryBar} onChange={(on) => set("deliveryBar", on)} />
              <LabToggle id="cart-lab-quick" label="Add from cards" checked={state.quickAdd} onChange={(on) => set("quickAdd", on)} />
              <LabToggle id="cart-lab-suggest" label="Goes well with" checked={state.suggest} onChange={(on) => set("suggest", on)} />
            </LabGroup>
            <LabGroup title="Drawn over">
              <Choice
                label="Where"
                value={state.placement}
                options={LAB_PLACEMENTS.map((entry) => ({ value: entry.id, label: entry.label }))}
                onChange={(value: LabPlacementId) => set("placement", value)}
              />
              <Choice
                label="Shop"
                value={state.shop}
                options={LAB_SHOPS.map((entry) => ({ value: entry.id, label: entry.id }))}
                onChange={(value: LabShopId) => set("shop", value)}
              />
              <Choice label="Designer sample" value={state.sample} options={SAMPLE_CART_STATES} onChange={(value) => set("sample", value)} />
              <Choice label="Designer device" value={state.device} options={LAB_DEVICES} onChange={(value) => set("device", value)} />
              <LabToggle id="cart-lab-open" label="Designer: cart starts open" checked={state.open} onChange={(on) => set("open", on)} />
              <Choice
                label="Cart"
                value={state.scenario}
                options={(Object.keys(LAB_SCENARIOS) as LabScenarioId[]).map((id) => ({ value: id, label: id }))}
                onChange={(value: LabScenarioId) => set("scenario", value)}
              />
            </LabGroup>
          </aside>

          <section className="flex min-w-0 flex-col gap-3" data-cart-lab-playground="">
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="secondary" onClick={() => setState((current) => shuffle(current))} data-cart-lab-shuffle="">
                <Shuffle className="size-4" aria-hidden="true" />
                Shuffle
              </Button>
              <Button type="button" variant="secondary" onClick={() => setReplay((count) => count + 1)}>
                <RotateCcw className="size-4" aria-hidden="true" />
                Replay
              </Button>
              <Button type="button" variant="ghost" onClick={() => setState(LAB_DEFAULTS)}>
                Reset
              </Button>
              <StorefrontCart
                storefrontId={LAB_STOREFRONT_ID}
                cart={{}}
                theme={{ ink: shop.ink, cornerRadius: shop.cornerRadius, cta: shop.cta }}
                preview
                previewView={LAB_SCENARIOS[state.scenario].view}
                look={lookOf(state)}
              >
                <OpenRealPanel />
              </StorefrontCart>
            </div>
            <div className="overflow-hidden border border-border" key={replay}>
              <Placement state={state} interactive />
            </div>
            <LabCopyButtons jsx={jsx} />
            <LabJsx jsx={jsx} />
          </section>
        </div>

        <section className="flex flex-col gap-4" data-cart-lab-presets="">
          <LabTabs groups={LAB_GROUPS} active={group} count={(id) => tilesFor(id).length} onChange={setGroup} />
          {group === SHORTLIST_GROUP && (
            <p className={infoTextClass}>Ranked, best first. Each says why it is here.</p>
          )}
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {tilesFor(group).map((preset) => {
              const tileState = withDefaults({ ...pickContext(state), ...preset.state });
              const why = LAB_SHORTLIST.find((entry) => entry.id === preset.id)?.why;
              return (
                <article key={preset.id} className="relative flex flex-col gap-2 border border-border p-3" data-cart-lab-preset={preset.id}>
                  <LabLazy>
                    <div className="h-80 overflow-hidden">
                      <div className="origin-top-left scale-[0.75]" style={{ width: "133.3%" }}>
                        <Placement state={tileState} />
                      </div>
                    </div>
                  </LabLazy>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-semibold">{preset.name}</h3>
                      <p className="text-xs text-muted-foreground">{group === SHORTLIST_GROUP && why ? why : preset.note}</p>
                    </div>
                    <LabFitBadge fit={preset.fit} className="shrink-0" />
                  </div>
                  {/* The press is an overlay, never a wrapper: the tile holds
                      buttons of its own. */}
                  <button
                    type="button"
                    className="absolute inset-0"
                    aria-label={`Load ${preset.name} into the playground`}
                    onClick={() => {
                      setState(tileState);
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }}
                  />
                </article>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}

/** A tile keeps the playground's shop and cart unless it is about them. */
function pickContext(state: CartLabState): Partial<CartLabState> {
  return { shop: state.shop, scenario: state.scenario };
}
