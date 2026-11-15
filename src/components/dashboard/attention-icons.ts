import {
  FileText,
  ImageOff,
  KeyRound,
  Landmark,
  LayoutGrid,
  Package,
  PackageMinus,
  Receipt,
  SearchX,
  ShieldAlert,
  ShoppingCart,
  Tag,
  Truck,
  Undo2,
  Unlink,
  type LucideIcon,
} from "lucide-react";
import type { AttentionKey } from "@/lib/dashboard/attention";

/** The icon each "Needs attention" row wears: what kind of thing it is about.
 *  Keyed by every AttentionKey, so a new row cannot ship without one. */
export const ATTENTION_ICONS: Record<AttentionKey, LucideIcon> = {
  "to-ship": Truck,
  withdrawals: Undo2,
  paused: ShieldAlert,
  restock: PackageMinus,
  "two-factor": KeyRound,
  stripe: Landmark,
  "no-legal": FileText,
  "no-buy-path": ShoppingCart,
  "no-shipping": Package,
  "checkout-rates": Tag,
  storefront: LayoutGrid,
  images: ImageOff,
  "flagged-orders": Receipt,
  "noindex-product-pages": SearchX,
  "dead-blocks": Unlink,
};
