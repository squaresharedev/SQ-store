import { cn } from "@/lib/utils";

/**
 * Circular avatar (styles.md §8.8): shows the uploaded photo when present, else
 * initials on the neutral secondary surface. Size comes from `className`
 * (default size-9). Avatar images are public Storage URLs — a plain <img> keeps
 * this a server-safe presentational component with no next/image config.
 */
function initialsFrom(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function Avatar({
  src,
  name,
  className,
}: {
  src?: string | null;
  name: string;
  className?: string;
}) {
  const base = cn(
    "inline-flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-secondary text-secondary-foreground",
    className,
  );

  if (src) {
    return (
      <span className={base}>
        {/* eslint-disable-next-line @next/next/no-img-element -- public Storage URL; next/image adds no value here. */}
        <img src={src} alt="" className="size-full object-cover" />
      </span>
    );
  }

  return (
    <span className={base} aria-hidden>
      <span className="font-inter text-xs font-semibold">
        {initialsFrom(name)}
      </span>
    </span>
  );
}
