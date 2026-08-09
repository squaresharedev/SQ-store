"use client";

import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { focusRingClass, transitionClass } from "@/components/ui/control-styles";
import { useSearch } from "@/components/search/SearchProvider";

/**
 * The MINIMIZED state of universal search, mobile: an icon button beside the
 * bell in the Sidebar's mobile header.
 *
 * Icon-only rather than the desktop trigger's field shape, because that header
 * already carries a menu toggle, the page title, the bell and the avatar in
 * 56px — a field there would push the title out. Sized size-10 to match the
 * menu toggle it sits in line with, which also keeps it a 40px touch target.
 */
export function SearchMobileTrigger() {
  const search = useSearch();
  if (!search) return null;

  return (
    <button
      type="button"
      onClick={search.open}
      aria-label="Search"
      aria-haspopup="dialog"
      aria-expanded={search.isOpen}
      className={cn(
        "flex size-10 items-center justify-center rounded-sm text-foreground",
        "hover:bg-accent",
        transitionClass,
        focusRingClass,
      )}
    >
      <Search className="size-5" strokeWidth={2} aria-hidden />
    </button>
  );
}
