import { useId } from "react";

/**
 * Two products drawn in code, for the empty products list: a potted snake
 * plant and a smartwatch. The alternative to the photo cut-outs, and meant to
 * sit beside them without looking like clip-art: one light source (top left)
 * for every highlight and shadow, soft cylindrical shading on the round forms,
 * glass that catches the light, and a contact shadow under each so they stand
 * on something.
 *
 * Decorative only (the caller hides them from assistive tech). Gradient and
 * filter ids are prefixed with useId, so any number can share a page.
 */

const FACE_FONT = "var(--font-geist), ui-sans-serif, system-ui, sans-serif";

type Leaf = { x: number; h: number; w: number; lean: number; front: boolean };

// Base x, height, width, lean (tip offset). Back leaves first, so the front
// ones overlap them.
const LEAVES: Leaf[] = [
  { x: 106, h: 196, w: 30, lean: -20, front: false },
  { x: 138, h: 214, w: 34, lean: 14, front: false },
  { x: 90, h: 138, w: 36, lean: -40, front: true },
  { x: 152, h: 150, w: 32, lean: 32, front: true },
  { x: 120, h: 176, w: 40, lean: -4, front: true },
];
const SOIL_Y = 262;

/** A snake plant blade: widest a third of the way up, then a long taper to a
 *  sharp tip, with a slight S in it. */
function leafPath({ x, h, w, lean }: Leaf) {
  const y = SOIL_Y;
  const tipX = x + lean;
  const tipY = y - h;
  return [
    `M ${x - w / 2} ${y}`,
    `C ${x - w * 0.78 + lean * 0.15} ${y - h * 0.32}, ${x - w * 0.42 + lean * 0.72} ${y - h * 0.78}, ${tipX} ${tipY}`,
    `C ${x + w * 0.42 + lean * 0.72} ${y - h * 0.78}, ${x + w * 0.78 + lean * 0.15} ${y - h * 0.32}, ${x + w / 2} ${y}`,
    "Z",
  ].join(" ");
}

/** The lighter line down the middle of a blade, where it catches the light. */
function midribPath({ x, h, lean }: Leaf) {
  const y = SOIL_Y - 6;
  return `M ${x - 2} ${y} Q ${x + lean * 0.35 - 3} ${y - h * 0.5}, ${x + lean * 0.9 - 1} ${y - h * 0.9}`;
}

export function PlantIllustration({ className }: { className?: string }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const id = (name: string) => `${uid}-${name}`;
  const url = (name: string) => `url(#${id(name)})`;

  return (
    <svg viewBox="32 36 184 362" className={className} aria-hidden="true" focusable="false">
      <defs>
        {/* Matte stone pot, lit from the left: light band a third of the way
            across, falling off into shade on the right. */}
        <linearGradient id={id("pot")} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#cfcac4" />
          <stop offset="0.3" stopColor="#f3f1ee" />
          <stop offset="0.62" stopColor="#e2ddd7" />
          <stop offset="1" stopColor="#aaa29a" />
        </linearGradient>
        <linearGradient id={id("rim")} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#e7e3de" />
          <stop offset="0.4" stopColor="#fbfaf8" />
          <stop offset="1" stopColor="#cbc4bc" />
        </linearGradient>
        <radialGradient id={id("soil")} cx="0.45" cy="0.35" r="0.7">
          <stop offset="0" stopColor="#4a3627" />
          <stop offset="1" stopColor="#1f150e" />
        </radialGradient>
        {/* Each blade is folded slightly down its middle and lit from the
            left: the left half catches the light, the right half turns away. */}
        <linearGradient id={id("leafBack")} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#1c6a3b" />
          <stop offset="0.5" stopColor="#15562f" />
          <stop offset="0.52" stopColor="#0f4424" />
          <stop offset="1" stopColor="#0b3a1e" />
        </linearGradient>
        <linearGradient id={id("leafFront")} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#2a8a4e" />
          <stop offset="0.5" stopColor="#1f7a44" />
          <stop offset="0.52" stopColor="#176335" />
          <stop offset="1" stopColor="#10502a" />
        </linearGradient>
        {/* The snake plant's cross-bands, kept faint: a texture, not stripes. */}
        <pattern id={id("bands")} width="34" height="13" patternUnits="userSpaceOnUse">
          <path d="M0 6.5 Q 8.5 3 17 6.5 T 34 6.5" fill="none" stroke="#052e16" strokeOpacity="0.14" strokeWidth="3" />
        </pattern>
        {/* Darker toward the soil, where the blades crowd each other. */}
        <linearGradient id={id("leafShade")} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0.55" stopColor="#022c16" stopOpacity="0" />
          <stop offset="1" stopColor="#022c16" stopOpacity="0.45" />
        </linearGradient>
        <linearGradient id={id("potSheen")} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.75" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        <filter id={id("blur")} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="5" />
        </filter>
        <filter id={id("blurSoft")} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2" />
        </filter>
      </defs>

      {/* Contact shadow. */}
      <ellipse cx="124" cy="386" rx="76" ry="8" fill="#000" opacity="0.2" filter={url("blur")} />

      {/* The rim's back half and the soil, behind the leaves. */}
      <ellipse cx="120" cy="252" rx="75" ry="15" fill={url("rim")} />
      <ellipse cx="120" cy="254" rx="66" ry="10.5" fill={url("soil")} />

      {LEAVES.map((leaf, index) => {
        const d = leafPath(leaf);
        return (
          <g key={index}>
            <path d={d} fill={url(leaf.front ? "leafFront" : "leafBack")} />
            <path d={d} fill={url("bands")} />
            <path d={d} fill={url("leafShade")} />
            <path d={midribPath(leaf)} fill="none" stroke="#dcfce7" strokeOpacity={leaf.front ? 0.18 : 0.1} strokeWidth="1.6" strokeLinecap="round" />
            {/* The pale edge a Laurentii blade has, as a fine line. */}
            <path d={d} fill="none" stroke="#cbe89a" strokeOpacity="0.75" strokeWidth="1.1" strokeLinejoin="round" />
          </g>
        );
      })}

      {/* The pot's body, from the rim's FRONT half down: it covers the leaf
          bases, so they grow out of the soil rather than sitting on it. */}
      <path
        d="M45 252 A75 15 0 0 0 195 252 L183 368 Q181 386 163 386 L77 386 Q59 386 57 368 Z"
        fill={url("pot")}
      />
      {/* Light down the lit side of the body, and the rim's lit front lip. */}
      <path d="M78 276 L86 366" stroke={url("potSheen")} strokeWidth="9" strokeLinecap="round" filter={url("blurSoft")} />
      <path d="M45 252 A75 15 0 0 0 195 252" fill="none" stroke="#fdfcfb" strokeWidth="3" strokeLinecap="round" />
      <path d="M58 262 A64 12 0 0 0 182 262" fill="none" stroke="#000" strokeOpacity="0.06" strokeWidth="4" />
    </svg>
  );
}

export function WatchIllustration({ className }: { className?: string }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const id = (name: string) => `${uid}-${name}`;
  const url = (name: string) => `url(#${id(name)})`;

  return (
    <svg viewBox="40 0 168 400" className={className} aria-hidden="true" focusable="false">
      <defs>
        {/* Sport band: soft rubber, lit from the left. */}
        <linearGradient id={id("strap")} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#18181b" />
          <stop offset="0.32" stopColor="#3a3a40" />
          <stop offset="0.7" stopColor="#27272a" />
          <stop offset="1" stopColor="#111113" />
        </linearGradient>
        {/* Graphite aluminium case. */}
        <linearGradient id={id("case")} x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#7a7a82" />
          <stop offset="0.35" stopColor="#4a4a52" />
          <stop offset="1" stopColor="#1d1d21" />
        </linearGradient>
        <linearGradient id={id("edge")} x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.55" />
          <stop offset="0.5" stopColor="#ffffff" stopOpacity="0.08" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={id("crown")} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#8a8a92" />
          <stop offset="1" stopColor="#3a3a40" />
        </linearGradient>
        {/* A green bloom rising from the bottom of the face: the brand's
            green, picked up from the glow behind the add card. */}
        <radialGradient id={id("bloom")} cx="0.5" cy="1.05" r="0.75">
          <stop offset="0" stopColor="#4ade80" stopOpacity="0.45" />
          <stop offset="1" stopColor="#4ade80" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={id("glass")} x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.16" />
          <stop offset="0.45" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        <clipPath id={id("screen")}>
          <rect x="62" y="118" width="116" height="164" rx="28" />
        </clipPath>
        <filter id={id("blur")} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="5" />
        </filter>
      </defs>

      {/* Contact shadow. */}
      <ellipse cx="124" cy="390" rx="58" ry="7" fill="#000" opacity="0.2" filter={url("blur")} />

      {/* Straps, tapering away from the case. */}
      <path d="M76 120 L82 24 Q84 8 100 8 L140 8 Q156 8 158 24 L164 120 Z" fill={url("strap")} />
      <path d="M76 280 L82 372 Q84 388 100 388 L140 388 Q156 388 158 372 L164 280 Z" fill={url("strap")} />
      {[308, 326, 344, 362].map((y) => (
        <g key={y}>
          <rect x="114" y={y} width="12" height="6" rx="3" fill="#0b0b0d" />
          <rect x="114" y={y + 5} width="12" height="1.5" rx="0.75" fill="#52525b" opacity="0.6" />
        </g>
      ))}

      {/* Case, crown and side button. */}
      <rect x="189" y="164" width="11" height="32" rx="4" fill={url("crown")} />
      {[170, 176, 182, 188].map((y) => (
        <rect key={y} x="192" y={y} width="8" height="1.4" rx="0.7" fill="#27272a" opacity="0.7" />
      ))}
      <rect x="190" y="210" width="6" height="30" rx="3" fill="#3f3f46" />
      <rect x="48" y="104" width="144" height="192" rx="40" fill={url("case")} />
      <rect x="48.75" y="104.75" width="142.5" height="190.5" rx="39.25" fill="none" stroke={url("edge")} strokeWidth="1.5" />
      <rect x="56" y="112" width="128" height="176" rx="33" fill="#0a0a0b" />

      {/* The face. */}
      <g clipPath={url("screen")}>
        <rect x="62" y="118" width="116" height="164" fill="#000" />
        <rect x="62" y="190" width="116" height="92" fill={url("bloom")} />
        <text
          x="120"
          y="160"
          textAnchor="middle"
          fontFamily={FACE_FONT}
          fontSize="12"
          fontWeight="600"
          letterSpacing="1.6"
          fill="#4ade80"
        >
          WED 25
        </text>
        <text
          x="120"
          y="208"
          textAnchor="middle"
          fontFamily={FACE_FONT}
          fontSize="37"
          fontWeight="600"
          letterSpacing="-1"
          fill="#fafafa"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          10:09
        </text>
        {/* One activity ring, in the same green. */}
        <circle cx="120" cy="246" r="13" fill="none" stroke="#16351f" strokeWidth="4.5" />
        <circle
          cx="120"
          cy="246"
          r="13"
          fill="none"
          stroke="#4ade80"
          strokeWidth="4.5"
          strokeLinecap="round"
          strokeDasharray={`${2 * Math.PI * 13 * 0.72} ${2 * Math.PI * 13}`}
          transform="rotate(-90 120 246)"
        />
        {/* The glass catching the light. */}
        <rect x="62" y="118" width="116" height="164" fill={url("glass")} />
      </g>
    </svg>
  );
}
