import { Code2, Globe, MousePointerClick, Store, type LucideIcon } from "lucide-react";
import type { OrderChannel } from "@/types/order-view";

/** One icon per sales channel, in the order the Orders toolbar shows them. The
 *  toolbar's toggle and an order's own panel read from here, so a channel looks
 *  the same wherever it appears. A Record, so a new channel cannot ship without
 *  its icon. */
export const CHANNEL_ICONS: Record<OrderChannel, LucideIcon> = {
  marketplace: Store,
  embed: Code2,
  button: MousePointerClick,
  direct: Globe,
};
