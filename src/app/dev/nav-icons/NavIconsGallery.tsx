"use client";

import { useState } from "react";
import { MotionConfig, motion, useReducedMotion } from "motion/react";
import { cardClass } from "@/components/ui/surface-styles";
import { helpTextClass } from "@/components/ui/control-styles";
import { cn } from "@/lib/utils";
import {
  AnalyticsIcon,
  DiscoverIcon,
  OrdersIcon,
  OverviewIcon,
  PaymentsIcon,
  ProductsIcon,
  SettingsIcon,
  StorefrontIcon,
  type NavIconProps,
} from "@/components/dashboard/nav-icons";

const ICONS: Array<{
  name: string;
  story: string;
  icon: (props: NavIconProps) => React.ReactNode;
}> = [
  {
    name: "Overview",
    story:
      "The columns counter-scroll and stay where they land. Leaving does not rewind them.",
    icon: OverviewIcon,
  },
  {
    name: "Products",
    story: "The box opens, all four lids swinging outward.",
    icon: ProductsIcon,
  },
  {
    name: "Storefront",
    story: "The waves of the awning swing right, then left, then settle.",
    icon: StorefrontIcon,
  },
  {
    name: "Orders",
    story:
      "Wind tears down the whole flank, then thins out as the cart coasts to a stop.",
    icon: OrdersIcon,
  },
  {
    name: "Analytics",
    story:
      "The bars collapse and re-grow left to right, overshooting like fresh data.",
    icon: AnalyticsIcon,
  },
  {
    name: "Payments",
    story:
      "The card tips and throws off a sparkle, then lies back down when you leave.",
    icon: PaymentsIcon,
  },
  {
    name: "Settings",
    story: "The gear clicks a notch forward on every hover, and stays there.",
    icon: SettingsIcon,
  },
  {
    name: "Discover",
    story: "The compass needle swings, seeking a bearing, and settles.",
    icon: DiscoverIcon,
  },
];

/** One tile, wired exactly like a real sidebar row. */
function Tile({
  name,
  story,
  icon: Icon,
  trigger,
}: {
  name: string;
  story: string;
  icon: (props: NavIconProps) => React.ReactNode;
  trigger: Record<string, string>;
}) {
  const [hoverCount, setHoverCount] = useState(0);
  return (
    <motion.div
      {...trigger}
      // Plain component state, matching the sidebar row: the icons whose
      // story is a one-shot need to know when a hover begins.
      onHoverStart={() => setHoverCount((count) => count + 1)}
      // Explicit so motion's tap gesture doesn't inject tabindex="0"
      // on the client only, which trips a hydration mismatch.
      tabIndex={-1}
      data-testid={`icon-tile-${name.toLowerCase()}`}
      className={cn(cardClass, "group cursor-default p-4")}
    >
      <div className="flex items-center justify-between gap-4">
        {/* Rail-size replica of a sidebar row */}
        <div
          className={cn(
            "flex items-center gap-2 rounded-sm px-3 py-2.5 text-sm font-medium",
            "text-muted-foreground transition-colors duration-base ease-standard",
            "motion-reduce:transition-none",
            "group-hover:bg-accent group-hover:text-foreground",
          )}
        >
          <Icon hoverCount={hoverCount} />
          {name}
        </div>
        {/* Inspection size */}
        <Icon hoverCount={hoverCount} className="size-12 text-foreground" />
      </div>
      <p className="mt-3 font-inter text-xs text-muted-foreground">{story}</p>
    </motion.div>
  );
}

/**
 * Every tile is wired exactly like a real sidebar row (variant labels
 * propagated from the hovered container), shown at rail size in a fake nav
 * row plus a large inspection size so the choreography can be eyeballed
 * frame by frame in one place.
 */
export function NavIconsGallery() {
  const reducedMotion = useReducedMotion();
  const trigger: Record<string, string> = reducedMotion
    ? { initial: "idle" }
    : { initial: "idle", whileHover: "hover", whileTap: "hover" };

  return (
    <MotionConfig reducedMotion="user">
      <main className="mx-auto max-w-5xl space-y-10 p-6 sm:p-10">
        <header className="space-y-2">
          <h1 className="font-inter text-2xl font-semibold text-foreground">
            Animated nav icons
          </h1>
          <p className={helpTextClass}>
            Hover any tile: the row is the trigger, exactly like the sidebar.
            Each icon performs its meaning in one color, and renders as its
            static lucide self for reduced-motion users.
          </p>
        </header>

        <section className="grid gap-4 sm:grid-cols-2">
          {ICONS.map((entry) => (
            <Tile key={entry.name} {...entry} trigger={trigger} />
          ))}
        </section>
      </main>
    </MotionConfig>
  );
}
