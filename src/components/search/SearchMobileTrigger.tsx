"use client";

import { Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { topBarIconButtonClass } from "@/components/ui/control-styles";
import { useSearch } from "@/components/search/SearchProvider";

/**
 * The MINIMIZED state of universal search, mobile: an icon button beside the
 * bell in the Sidebar's mobile header.
 *
 * Icon-only rather than the desktop trigger's field shape, because that header
 * already carries a menu toggle, the page title, the bell and the avatar in
 * 56px: a field there would push the title out. It wears the bar's shared
 * icon-button token, so it matches the menu toggle and stays a 40px target.
 */
export function SearchMobileTrigger() {
  const t = useTranslations("Search.trigger");
  const search = useSearch();
  if (!search) return null;

  return (
    <button
      type="button"
      onClick={search.open}
      data-tour="search-phone"
      aria-label={t("label")}
      aria-haspopup="dialog"
      aria-expanded={search.isOpen}
      className={topBarIconButtonClass}
    >
      <Search className="size-5" strokeWidth={2} aria-hidden />
    </button>
  );
}
