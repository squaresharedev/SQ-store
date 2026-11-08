import { GradientAscii } from "@/components/ui/GradientAscii";
import {
  ASCII_PALETTES,
  ASCII_TERMINAL_GLYPHS,
  type AsciiFieldSettings,
} from "@/components/ui/gradient-ascii-tokens";
import { cn } from "@/lib/utils";

/** The field behind the address: chosen in the ASCII lab (/dev/ascii-lab, its
 *  "On the MCP card" tab), where it can be tuned against the real slab. */
export const MCP_ADDRESS_FIELD: Partial<AsciiFieldSettings> = {
  surface: "dark",
  colors: ASCII_PALETTES.terminal,
  characters: ASCII_TERMINAL_GLYPHS,
  cellSize: 12,
  density: 0.6,
  glyphOpacity: 0.65,
  gradientOpacity: 0.4,
  glow: 1.1,
  depthOfField: 0.37,
  softness: 1,
  scale: 1.36,
  flow: 0.6,
  speed: 0.53,
  grain: 0.07,
  variation: 29,
  scrambleRadius: 0.17,
};

/**
 * THE MCP ADDRESS ON A TERMINAL SLAB: a black panel where code glows along the
 * top and fades down to the dark band the address sits in, so the address is
 * the brightest, plainest thing on it. The address stays real text, to read,
 * select and copy; the field is decoration (ui/GradientAscii), drawn behind it
 * and only once the slab is on screen.
 *
 * `field` is for the lab, which draws this same slab to tune it.
 */
export function McpAddressSlab({
  mcpUrl,
  field = MCP_ADDRESS_FIELD,
  className,
}: {
  mcpUrl: string;
  field?: Partial<AsciiFieldSettings>;
  className?: string;
}) {
  return (
    <div className={cn("relative h-35 overflow-hidden bg-foreground text-background", className)}>
      <GradientAscii {...field} className="absolute inset-0" />
      <code className="relative flex h-full items-end break-all p-4 font-mono text-sm">{mcpUrl}</code>
    </div>
  );
}
