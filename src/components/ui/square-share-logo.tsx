/**
 * Square Share brand mark: four square "pixels". Three form an L (the square),
 * the fourth is nudged up-right and detached — the "share"/send square, rendered
 * in the acid accent (the one deliberate purple on the mark). crispEdges keeps
 * the pixels hard.
 */
export function SquareShareLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      shapeRendering="crispEdges"
      className={className}
      aria-hidden="true"
    >
      <rect x="2" y="2" width="9" height="9" fill="currentColor" />
      <rect x="2" y="13" width="9" height="9" fill="currentColor" />
      <rect x="13" y="13" width="9" height="9" fill="currentColor" />
      <rect x="14" y="0" width="8" height="8" fill="var(--color-acid)" />
    </svg>
  );
}
