"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

/**
 * Renders its children everywhere EXCEPT the listed paths (exact match).
 *
 * For chrome the shell hangs on every page that one page already says in its
 * own way: the seller-details banner stands down on Overview, where the setup
 * checklist states the same gap as a step to take.
 *
 * Layouts cannot read the pathname (next/navigation's usePathname is
 * client-only by design), so the decision sits in this thin client wrapper
 * while whatever it wraps stays a server component, rendered on the server as
 * before and passed in as children.
 */
export function HiddenOnPaths({
  paths,
  children,
}: {
  paths: readonly string[];
  children: ReactNode;
}) {
  const pathname = usePathname();
  if (paths.includes(pathname)) return null;
  return <>{children}</>;
}
