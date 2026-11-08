"use client";

import type { ReactNode, Ref } from "react";
import { ArrowUpRight, Bell, LifeBuoy, Menu, MessageSquareQuote, Plus, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { NAV_ITEM_CLASSES, NAV_ITEM_IDLE_CLASSES } from "@/components/dashboard/Sidebar";
import { SortSlidersIcon } from "@/components/ui/SortSlidersIcon";
import { UploadIcon } from "@/components/ui/UploadIcon";
import { Avatar } from "@/components/ui/avatar";
import { primaryButtonClass, secondaryButtonClass, topBarIconButtonClass } from "@/components/ui/control-styles";
import { pageTitleClass } from "@/components/ui/surface-styles";
import { MAIN_NAV, SETTINGS_LINK } from "@/lib/search/nav-constants";
import { PRODUCTS_PATH } from "@/lib/products/paths";
import { STORY_APP_WIDTH } from "./product-import-story-tokens";

/** Whose store the picture is: a name, not copy. */
const STORY_PROFILE_NAME = "Mara Lind";

/** The toolbar's secondary buttons, as the products page draws them (ProductsBrowser). */
const TOOLBAR_BUTTON = cn(secondaryButtonClass, "h-10 shrink-0 px-3 py-2 text-sm");

/** The rail's row: the same classes the dashboard's rail rows wear, here on a plain element. */
function RailRow({ active, children }: { active?: boolean; children: ReactNode }) {
  return <div className={cn(NAV_ITEM_CLASSES, active ? "bg-accent text-foreground" : NAV_ITEM_IDLE_CLASSES)}>{children}</div>;
}

/**
 * THE DASHBOARD, as it looks on the Products page, drawn from the app's own
 * pieces: the rail's rows and animated icons, the top bar's search field, bell
 * and avatar, the page's title and toolbar buttons. Nothing in it is live: it is
 * a picture, drawn at the real size (`STORY_APP_WIDTH`) for the story to scale
 * down. `compact` is the phone layout the app switches to under md: no rail,
 * a top bar with the menu button and the page's name.
 *
 * `grid` is the product grid (the story's own: its slots are what the cursor
 * drops into) and `count` how many products it holds.
 */
export function ProductImportAppScene({
  compact,
  designRef,
  count,
  grid,
}: {
  compact: boolean;
  /** The drawn app, for measuring how tall it came out. */
  designRef: Ref<HTMLDivElement>;
  count: ReactNode;
  grid: ReactNode;
}) {
  const t = useTranslations();
  const width = compact ? STORY_APP_WIDTH.compact : STORY_APP_WIDTH.desktop;

  const toolbar = (
    <div className="flex items-center justify-end gap-2">
      {!compact && (
        <span className={TOOLBAR_BUTTON}>
          <SortSlidersIcon className="size-4 shrink-0" />
          {t("Products.browser.sortResting")}
        </span>
      )}
      {!compact && (
        <span className={TOOLBAR_BUTTON}>
          <MessageSquareQuote className="size-4" strokeWidth={2} />
          {t("Products.browser.reviews")}
        </span>
      )}
      <span className={TOOLBAR_BUTTON}>
        <UploadIcon className="size-4" />
        {t("Products.browser.import")}
      </span>
      <span className={cn(primaryButtonClass, "h-10 shrink-0")}>
        <Plus className="size-4" strokeWidth={2} />
        {t("Products.browser.add")}
      </span>
    </div>
  );

  const avatar = <Avatar name={STORY_PROFILE_NAME} className="size-9" />;
  const bell = (
    <span className={topBarIconButtonClass}>
      <Bell className="size-5" strokeWidth={2} />
    </span>
  );

  if (compact) {
    return (
      <div ref={designRef} className="bg-background text-foreground" style={{ width }}>
        {/* The phone top bar: the menu, the page's name, search, the bell and the profile. */}
        <div className="flex h-14 items-center gap-2 border-b border-border bg-background px-4">
          <span className={topBarIconButtonClass}>
            <Menu className="size-5" strokeWidth={2} />
          </span>
          <span className="min-w-0 flex-1 truncate text-xl font-semibold text-foreground">{t("Nav.main.products.label")}</span>
          <span className={topBarIconButtonClass}>
            <Search className="size-5" strokeWidth={2} />
          </span>
          {bell}
          {avatar}
        </div>
        <div className="space-y-4 p-4">
          {toolbar}
          {grid}
        </div>
      </div>
    );
  }

  return (
    <div ref={designRef} className="flex bg-background text-foreground" style={{ width }}>
      {/* The rail. */}
      <div className="flex w-64 shrink-0 flex-col border-r border-border bg-background">
        <div className="flex h-14 items-center gap-2.5 border-b border-border px-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- static public asset, as in the rail itself. */}
          <img src="/img/logo.png" alt="" className="size-6 shrink-0 rounded-sm object-contain" />
          <span className="truncate text-lg font-semibold tracking-tight text-foreground">{t("Dashboard.sidebar.title")}</span>
        </div>
        <div className="flex-1 space-y-1 px-3 py-4">
          {MAIN_NAV.map((item) => (
            <RailRow key={item.href} active={item.href === PRODUCTS_PATH}>
              <item.icon />
              {t(item.label)}
            </RailRow>
          ))}
        </div>
        <div className="space-y-1 border-t border-border px-3 py-4">
          {/* The plan chip: a pill, and a black disc with an arrow. */}
          <div className={cn(NAV_ITEM_CLASSES, "mr-3 rounded-full bg-muted py-1.5 pr-1 text-foreground")}>
            <span className="size-5 shrink-0" />
            <span className="min-w-0 truncate">{t("Billing.card.upgrade", { plan: t("Billing.plans.starter.name") })}</span>
            <span className="ml-auto flex size-7 shrink-0 items-center justify-center rounded-full bg-foreground text-background">
              <ArrowUpRight className="size-3.5" strokeWidth={2.25} />
            </span>
          </div>
          <RailRow>
            <SETTINGS_LINK.icon />
            {t(SETTINGS_LINK.label)}
          </RailRow>
          <RailRow>
            <LifeBuoy className="size-5 shrink-0" strokeWidth={2} />
            {t("Nav.main.help")}
          </RailRow>
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* The top bar: search at the left, the bell and the profile at the right. */}
        <div className="flex h-14 shrink-0 items-center gap-1 border-b border-border bg-background px-6">
          <span className="flex h-9 w-full max-w-xs items-center gap-2 rounded-none border border-input bg-background px-3 text-left text-sm text-muted-foreground">
            <Search className="size-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{t("Search.trigger.label")}</span>
            <kbd className="shrink-0 rounded-none border border-border bg-muted px-1.5 py-0.5 font-inter text-[0.6875rem] leading-none text-muted-foreground">
              Ctrl K
            </kbd>
          </span>
          <div className="flex-1" />
          {bell}
          {avatar}
        </div>
        <div className="space-y-6 px-6 py-8">
          <div className="flex items-end justify-between gap-3">
            <div className="flex items-baseline gap-3">
              <h1 className={pageTitleClass}>{t("Products.page.heading")}</h1>
              <span className="font-inter text-sm tabular-nums text-muted-foreground">{count}</span>
            </div>
            {toolbar}
          </div>
          {grid}
        </div>
      </div>
    </div>
  );
}
