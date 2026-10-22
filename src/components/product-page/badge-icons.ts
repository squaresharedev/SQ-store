import {
  Award,
  BadgeCheck,
  Clock,
  Droplets,
  Flame,
  Gem,
  Gift,
  Globe,
  Hammer,
  HandHeart,
  Handshake,
  Heart,
  Leaf,
  Lock,
  MapPin,
  Package,
  PawPrint,
  PenTool,
  Rabbit,
  Recycle,
  RotateCcw,
  ShieldCheck,
  Snowflake,
  Sparkles,
  Sprout,
  Star,
  Store,
  Sun,
  ThumbsUp,
  Trees,
  Trophy,
  Truck,
  Users,
  Vegan,
  WheatOff,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { BadgeColor, BadgeIcon } from "@/types/product";
import { LIGHT_INK } from "./product-page-maps";

/**
 * The drawing behind each stored badge icon id. One map, read by the buyer's
 * page and by the seller's form, so the icon a seller picks is the icon a buyer
 * sees. Typed as a full Record: an id added to BADGE_ICONS without a drawing
 * here does not compile.
 */
export const BADGE_ICON_COMPONENTS: Record<BadgeIcon, LucideIcon> = {
  "badge-check": BadgeCheck,
  heart: Heart,
  star: Star,
  award: Award,
  trophy: Trophy,
  "thumbs-up": ThumbsUp,
  users: Users,
  sparkles: Sparkles,
  gem: Gem,
  gift: Gift,
  truck: Truck,
  zap: Zap,
  clock: Clock,
  "rotate-ccw": RotateCcw,
  "shield-check": ShieldCheck,
  lock: Lock,
  leaf: Leaf,
  recycle: Recycle,
  sprout: Sprout,
  trees: Trees,
  package: Package,
  vegan: Vegan,
  rabbit: Rabbit,
  "paw-print": PawPrint,
  "wheat-off": WheatOff,
  droplets: Droplets,
  sun: Sun,
  snowflake: Snowflake,
  "hand-heart": HandHeart,
  hammer: Hammer,
  "pen-tool": PenTool,
  "map-pin": MapPin,
  store: Store,
  handshake: Handshake,
  globe: Globe,
  flame: Flame,
};

/**
 * The two shades of each badge colour: one for a light page (and for the light
 * pill a badge wears on a photo), one for a dark page. Tailwind's 600 and 400
 * steps, so an icon holds its own against either. `ink` has no entry: it is
 * the page's own text colour, whatever that is.
 */
export const BADGE_COLOR_SHADES: Record<Exclude<BadgeColor, "ink">, { onLight: string; onDark: string }> = {
  red: { onLight: "#dc2626", onDark: "#f87171" },
  orange: { onLight: "#ea580c", onDark: "#fb923c" },
  amber: { onLight: "#d97706", onDark: "#fbbf24" },
  green: { onLight: "#16a34a", onDark: "#4ade80" },
  teal: { onLight: "#0d9488", onDark: "#2dd4bf" },
  blue: { onLight: "#2563eb", onDark: "#60a5fa" },
  purple: { onLight: "#9333ea", onDark: "#c084fc" },
  pink: { onLight: "#db2777", onDark: "#f472b6" },
};

/** The colour one badge's icon is drawn in, on a surface whose text is `ink`. */
export function badgeIconColor(color: BadgeColor | undefined, ink: string): string {
  if (!color || color === "ink") return ink;
  const shades = BADGE_COLOR_SHADES[color];
  return ink === LIGHT_INK ? shades.onDark : shades.onLight;
}
