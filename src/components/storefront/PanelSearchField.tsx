"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import {
  GROUP_LABELS,
  STOREFRONT_SETTINGS,
  settingGroup,
  type SettingEntry,
  type SettingRef,
} from "@/lib/storefront/setting-ref";
import { rankEntries } from "@/lib/search/rank";
import { cn } from "@/lib/utils";
import { fieldBaseClass, infoTextClass } from "@/components/ui/control-styles";

/**
 * Find a setting by name, without knowing which group holds it.
 *
 * The menu answers "where does that live" by showing six labels, which works
 * right up to the moment a seller is thinking of the SETTING rather than the
 * group. "Roundness" is under Product cards and "gap" is under Canvas, and
 * nothing about either word says so. This is the way out, and it is the same
 * catalogue and the same ranker universal search uses, so the two can never
 * find different things.
 *
 * It filters rather than navigates: picking a row hands a SettingRef to the
 * panel's owner, which opens the group and flashes the section.
 */
export function PanelSearchField({
  onPick,
}: {
  onPick: (ref: SettingRef) => void;
}) {
  const [query, setQuery] = useState("");

  const matches = useMemo(() => {
    const trimmed = query.trim();
    if (trimmed === "") return [];
    return rankEntries(
      STOREFRONT_SETTINGS,
      trimmed,
      (entry: SettingEntry) => [entry.label, ...entry.keywords],
      6,
    );
  }, [query]);

  return (
    <div className="border-b border-border py-3 lg:px-4">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          strokeWidth={2}
          aria-hidden="true"
        />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Find a setting"
          aria-label="Find a setting"
          className={cn(fieldBaseClass, "w-full pl-8 text-sm")}
        />
      </div>

      {query.trim() !== "" && (
        <div className="mt-2">
          {matches.length === 0 ? (
            <p className={infoTextClass}>No setting matches that.</p>
          ) : (
            <ul role="list" className="m-0 list-none space-y-0.5 p-0">
              {matches.map((entry) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setQuery("");
                      onPick(entry.ref);
                    }}
                    className="flex w-full items-baseline justify-between gap-2 rounded-sm px-2 py-1.5 text-left transition-colors duration-base ease-standard hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
                  >
                    <span className="min-w-0 truncate text-sm text-foreground">
                      {entry.label}
                    </span>
                    <span className={cn(infoTextClass, "shrink-0")}>
                      {GROUP_LABELS[settingGroup(entry.ref)]}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
