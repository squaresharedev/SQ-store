import type { CSSProperties } from "react";
import { CornerArt } from "@/components/ui/CornerArt";
import { cn } from "@/lib/utils";

const WIDTH = 220;
const HEIGHT = 100;
/** An avatar's disc, the white gap ring that parts it from its neighbours,
 *  and the step from one to the next (they overlap). */
const RADIUS = 21;
const GAP_RADIUS = 24;
const STEP = 34;
const ROW_Y = 50;
/** The newest member's place, clear of the card's right edge by the card's
 *  own padding. */
const NEWEST_X = WIDTH - 28 - RADIUS;
/** The row fades out to the left over this much. */
const FADE = 64;

/** How the members look, in turn: an ink disc with a white figure, and the
 *  three quieter ways round. Every LOOKS.length-th member looks the same, so
 *  after one full loop (one arrival per look) the row is as it began. */
const LOOKS = [
  { disc: "fill-foreground", figure: "fill-background" },
  { disc: "fill-background", figure: "fill-muted-foreground" },
  { disc: "fill-muted", figure: "fill-foreground" },
  { disc: "fill-background", figure: "fill-foreground" },
] as const;
const STAGE_MS = 2400;
const LOOP_MS = STAGE_MS * LOOKS.length;

/** The row drawn past both ends: enough to the left to fill the faded side,
 *  and one loop's worth of members still to come on the right, past the
 *  card's edge. */
const BEHIND = Math.ceil(NEWEST_X / STEP) + 1;
const MEMBERS = Array.from({ length: BEHIND + 1 + LOOKS.length }, (_, index) => ({
  x: NEWEST_X + (index - BEHIND) * STEP,
  look: LOOKS[(((index - BEHIND) % LOOKS.length) + LOOKS.length) % LOOKS.length],
  // Each newcomer hops as it takes the newest place: the one there at the
  // start straight away, the others one stage apart.
  hop: index >= BEHIND && index < BEHIND + LOOKS.length ? (index - BEHIND) * STAGE_MS : undefined,
}));

/** Head and shoulders, the shoulders cut off along the disc's own edge. */
const SHOULDER_X = RADIUS * Math.cos((42 * Math.PI) / 180);
const SHOULDER_Y = RADIUS * Math.sin((42 * Math.PI) / 180);
const FIGURE =
  `M ${-SHOULDER_X} ${SHOULDER_Y} C ${-SHOULDER_X} 4, ${SHOULDER_X} 4, ${SHOULDER_X} ${SHOULDER_Y} ` +
  `A ${RADIUS} ${RADIUS} 0 0 1 ${-SHOULDER_X} ${SHOULDER_Y} Z`;

/**
 * A TEAM THAT GROWS, for the team card: a row of members' avatars, and one by
 * one a new one slides in through the card's right edge, taking the newest
 * place with a little hop while the rest shuffle along and the oldest fade
 * away to the left.
 */
export function ArrivingTeam({ className }: { className?: string }) {
  const fade = `linear-gradient(to right, transparent, #000 ${FADE}px)`;
  return (
    <CornerArt
      name="arriving-team"
      width={WIDTH}
      height={HEIGHT}
      className={className}
      style={{ "--corner-loop": `${LOOP_MS}ms`, "--team-step": `${STEP}px` } as CSSProperties}
    >
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        width={WIDTH}
        height={HEIGHT}
        className="absolute inset-0"
        style={{ WebkitMaskImage: fade, maskImage: fade }}
      >
        <g className="corner-team-shift">
          {MEMBERS.map(({ x, look, hop }, index) => (
            <g key={index} transform={`translate(${x} ${ROW_Y})`}>
              <g
                className={cn(hop !== undefined && "corner-team-hop")}
                style={hop !== undefined ? { animationDelay: `${hop}ms` } : undefined}
              >
                <circle r={GAP_RADIUS} className="fill-background" />
                <circle r={RADIUS} className={cn(look.disc, "stroke-foreground")} strokeWidth={2.5} />
                <circle cy={-6} r={7.5} className={look.figure} />
                <path d={FIGURE} className={look.figure} />
                <circle r={RADIUS} fill="none" className="stroke-foreground" strokeWidth={2.5} />
              </g>
            </g>
          ))}
        </g>
      </svg>
    </CornerArt>
  );
}
