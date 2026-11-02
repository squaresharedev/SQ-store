import {
  Bell,
  Eye,
  Gavel,
  LayoutGrid,
  Package,
  Percent,
  Receipt,
  RotateCcw,
  Star,
  Trash2,
  Truck,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import type { AgentScope } from "@/lib/agent/scopes";

/** The picture for each thing an assistant may be allowed to do. Keyed by the
 *  scope list, so a new scope without one fails to compile. */
export const SCOPE_ICONS: Record<AgentScope, LucideIcon> = {
  "store:read": Eye,
  "orders:read": Receipt,
  "products:write": Package,
  "storefronts:write": LayoutGrid,
  "discounts:write": Percent,
  "reviews:write": Star,
  "orders:fulfil": Truck,
  "profile:write": UserRound,
  "notifications:write": Bell,
  "moderation:write": Gavel,
  "orders:refund": RotateCcw,
  destructive: Trash2,
};
