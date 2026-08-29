/**
 * Re-export of the shared motion tokens. The values themselves live in
 * @/components/ui/motion-tokens, which the in-page action icons animate
 * against too; this file stays so the nav icons keep importing locally.
 */
export {
  EASE_STANDARD,
  EASE_ENTRANCE,
  SETTLE,
} from "@/components/ui/motion-tokens";
