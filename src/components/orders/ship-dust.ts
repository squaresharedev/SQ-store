/**
 * Dust thrown up by the van's wheels in the mark-shipped button. Each speck is
 * a small DOM dot on the Web Animations API (compositor-driven, no per-frame
 * JS), thrown backwards and slightly up, then it settles and fades. Specks are
 * placed in the button's own coordinates and stay where they were kicked, so as
 * the van moves forward it leaves a trail of them.
 *
 * Where the browser has no Web Animations (a test DOM), nothing is created.
 */

/** Tuning, in px and ms. */
export const DUST = {
  /** How often the wheels shed a speck while the van runs. */
  everyMs: 45,
  size: [1.6, 2.6],
  life: [340, 520],
  /** How far a speck is thrown backwards when the van is standing, and the extra at full speed. */
  throwBack: [10, 20],
  extraThrow: 34,
  lift: [5, 10],
} as const;

const between = ([lo, hi]: readonly [number, number] | readonly number[]) => lo + Math.random() * (hi - lo);

/**
 * Kick one speck up from a point (in `layer`'s coordinates). `speed` is 0 for a
 * van revving on the spot and 1 flat out: faster throws it further back.
 */
export function kickDust(layer: HTMLElement, at: { x: number; y: number }, speed: number) {
  if (typeof layer.animate !== "function") return;
  const size = between(DUST.size as [number, number]);
  const back = between(DUST.throwBack as [number, number]) + DUST.extraThrow * speed * Math.random();
  const lift = between(DUST.lift as [number, number]);
  const dot = document.createElement("span");
  dot.className = "absolute rounded-full bg-current";
  dot.style.left = `${at.x - size / 2}px`;
  dot.style.top = `${at.y - size / 2}px`;
  dot.style.width = `${size}px`;
  dot.style.height = `${size}px`;
  const flight = dot.animate(
    [
      { transform: "translate(0px, 0px) scale(1)", opacity: 0.85 },
      { transform: `translate(${-back * 0.6}px, ${-lift}px) scale(0.9)`, opacity: 0.6, offset: 0.35 },
      { transform: `translate(${-back}px, 2px) scale(0.3)`, opacity: 0 },
    ],
    { duration: between(DUST.life as [number, number]), easing: "ease-out", fill: "forwards" },
  );
  flight.onfinish = () => dot.remove();
  layer.appendChild(dot);
}
