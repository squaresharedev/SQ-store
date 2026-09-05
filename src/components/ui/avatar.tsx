"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Circular avatar (styles.md §8.8): shows the uploaded photo when present, else
 * initials on the neutral secondary surface. Size comes from `className`
 * (default size-9).
 *
 * WHY CLIENT COMPONENT. Avatar images used to be public Storage URLs, which a
 * plain <img> served correctly. Since OAuth sign-in, `src` may be a
 * googleusercontent.com URL, which Chrome blocks with ERR_BLOCKED_BY_ORB when
 * the <img> has no `referrerPolicy`. Even with the policy set, the URL can
 * expire or be inaccessible on shared machines, so we fall back to initials on
 * any load error rather than leaving a broken-image glyph. The error handler
 * requires a client component; the server-only restriction relaxes when the
 * component's surface (ProfileMenu, TopBar) is already a client island.
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
  const [imageError, setImageError] = useState(false);

  const base = cn(
    "inline-flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-secondary text-secondary-foreground",
    className,
  );

  if (src && !imageError) {
    return (
      <span className={base}>
        {/* eslint-disable-next-line @next/next/no-img-element -- Storage and OAuth URLs; next/image adds no value here. */}
        <img
          src={src}
          alt=""
          className="size-full object-cover"
          // Required for googleusercontent.com URLs: Chrome blocks them with
          // ERR_BLOCKED_BY_ORB when the Referer header names our origin. With
          // "no-referrer" the browser sends no Referer, which Google accepts.
          referrerPolicy="no-referrer"
          onError={() => setImageError(true)}
        />
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
