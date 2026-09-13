"use client";

import {
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { PanelRight, Settings as SettingsIcon, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import { infoTextClass } from "@/components/ui/control-styles";
import {
  SearchBar,
  SearchGroupHeading,
  SearchOption,
  useActiveOption,
} from "@/components/search/SearchBar";
import {
  searchEditor,
  type EditorSearchEntry,
  type EditorTarget,
} from "./editor-search";

/**
 * FIND ANYTHING IN THE EDITOR, without knowing where it lives.
 *
 * The menu answers "where does that live" by showing six labels, which works
 * right up to the moment a seller is thinking of the THING rather than the
 * group. "Roundness" is under Product cards and "gap" is under Canvas, and
 * nothing about either word says so.
 *
 * It reaches past settings on purpose. Inside the editor the question is
 * rarely "which page" and often "where did that go": the block buried under
 * another one, the drawer behind a toolbar icon. Those are in the index too
 * (see editor-search), and they are what makes this field worth opening rather
 * than a shortcut for a menu that is already on screen.
 *
 * SCOPED, NOT UNIVERSAL. It looks and behaves exactly like the universal
 * palette (both are built from components/search/SearchBar), but its index is
 * only the storefront designer and the product page: no orders, analytics,
 * account settings or pages. Those belong to the palette in the top bar, and
 * a hit here must always be something this panel can open in place.
 *
 * It filters rather than navigates: picking a row hands an EditorTarget to the
 * panel's owner, which opens the group, selects the block, or opens the panel.
 */

const KIND_ICONS: Record<EditorTarget["kind"], typeof SettingsIcon> = {
  setting: SettingsIcon,
  block: Square,
  panel: PanelRight,
};

export function PanelSearchField({
  entries,
  onPick,
}: {
  /** The editor index. Built by the owner (see editorEntries) because half of
   *  it is the live board, and memoised there for the same reason. */
  entries: readonly EditorSearchEntry[];
  onPick: (target: EditorTarget) => void;
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();
  const optionId = useCallback((id: string) => `${listboxId}-${id}`, [listboxId]);

  const sections = useMemo(() => searchEditor(entries, query), [entries, query]);
  /** The rows in render order, which is the order the arrows walk. */
  const flat = useMemo(() => sections.flatMap((section) => section.hits), [sections]);
  const ids = useMemo(() => flat.map((hit) => hit.entry.id), [flat]);
  const { activeId, choose, move } = useActiveOption(ids, optionId);

  function reset() {
    setQuery("");
    choose(null);
  }

  function pick(entry: EditorSearchEntry) {
    reset();
    onPick(entry.payload);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        move(1);
        break;
      case "ArrowUp":
        event.preventDefault();
        move(-1);
        break;
      case "Enter": {
        const hit = flat.find((item) => item.entry.id === activeId);
        if (!hit) break;
        event.preventDefault();
        pick(hit.entry);
        break;
      }
      case "Escape":
        // Only while there is something to clear; otherwise it belongs to
        // whatever encloses this field (the mobile sheet, the panel).
        if (query) {
          event.preventDefault();
          event.stopPropagation();
          reset();
        }
        break;
    }
  }

  const open = query.trim() !== "";

  return (
    <div className="border-b border-border pt-2 pb-3 lg:px-4">
      <SearchBar
        variant="bar"
        inputRef={inputRef}
        value={query}
        onValueChange={setQuery}
        onKeyDown={onKeyDown}
        label="Find a setting or object"
        placeholder="Find a setting or object"
        listboxId={listboxId}
        expanded={flat.length > 0}
        activeDescendant={activeId ? optionId(activeId) : undefined}
        clear={
          query
            ? {
                label: "Clear search",
                onPress: () => {
                  reset();
                  inputRef.current?.focus();
                },
              }
            : null
        }
        // At rest this is a field on a panel rather than a bar being covered
        // by its own expansion, so it needs the focus ring the palette's
        // anchored bar deliberately does without.
        className="focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background"
      />

      {open && (
        <div className="mt-2">
          {flat.length === 0 ? (
            <p className={cn(infoTextClass, "px-2 py-1.5")}>
              Nothing in the editor matches that.
            </p>
          ) : (
            <div id={listboxId} role="listbox" aria-label="Matches">
              {sections.map((section) => (
                <EditorSearchGroup
                  key={section.key}
                  label={section.label}
                  // A single group would be unlabelled noise: with one section
                  // on screen the heading says nothing the rows do not.
                  showLabel={sections.length > 1}
                  hits={section.hits}
                  activeId={activeId}
                  optionId={optionId}
                  onPick={pick}
                  onHover={choose}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function EditorSearchGroup({
  label,
  showLabel,
  hits,
  activeId,
  optionId,
  onPick,
  onHover,
}: {
  label: string;
  showLabel: boolean;
  hits: EditorSearchSectionHits;
  activeId: string | null;
  optionId: (id: string) => string;
  onPick: (entry: EditorSearchEntry) => void;
  onHover: (id: string) => void;
}) {
  const headingId = useId();
  return (
    <div
      role="group"
      aria-label={showLabel ? undefined : label}
      aria-labelledby={showLabel ? headingId : undefined}
    >
      {showLabel && (
        <SearchGroupHeading id={headingId} label={label} density="compact" />
      )}
      {hits.map(({ entry, matchedTerm }) => {
        // Only when nothing already on the row explains it. Fuzzy and synonym
        // matching mean a search for "wallpaper" answers "Background", and
        // without saying which word it recognised that reads as a wrong result
        // rather than a right one.
        //
        // The subtitle is excluded as well as the title: a hit on "Storefront
        // / Product cards" is already accounted for by the caption at the
        // right, and repeating it there says nothing twice.
        const explained =
          !matchedTerm ||
          matchedTerm === entry.title ||
          matchedTerm === entry.subtitle;
        return (
          <SearchOption
            key={entry.id}
            id={optionId(entry.id)}
            active={entry.id === activeId}
            icon={KIND_ICONS[entry.payload.kind]}
            title={entry.title}
            subtitle={explained ? null : matchedTerm}
            trailing={
              <span className={cn(infoTextClass, "shrink-0")}>
                {entryLocation(entry)}
              </span>
            }
            density="compact"
            onPick={() => onPick(entry)}
            onHover={() => onHover(entry.id)}
          />
        );
      })}
    </div>
  );
}

type EditorSearchSectionHits = ReturnType<typeof searchEditor>[number]["hits"];

/**
 * The right-hand caption: where the row lives.
 *
 * A setting's shared subtitle reads "Storefront / Theme", which is a useful
 * search term and a redundant caption inside the storefront editor. The group
 * name is what a seller needs here, so the last segment is what is shown.
 * Everything else says what kind of thing it is, which its subtitle already
 * holds.
 */
function entryLocation(entry: EditorSearchEntry): string {
  const subtitle = entry.subtitle ?? "";
  const slash = subtitle.lastIndexOf("/");
  return slash === -1 ? subtitle : subtitle.slice(slash + 1).trim();
}
