"use client";

import { useId, useMemo, useState, type KeyboardEvent } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { fieldBaseClass, infoTextClass } from "@/components/ui/control-styles";
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
 * It filters rather than navigates: picking a row hands an EditorTarget to the
 * panel's owner, which opens the group, selects the block, or opens the panel.
 *
 * IT IS A COMBOBOX, the same shape as the universal palette: focus stays in
 * the input and the highlighted row is tracked with aria-activedescendant, so
 * arrows walk the list and Enter opens without the caret ever fighting for the
 * key. Before this the rows were reachable by Tab alone, which meant typing a
 * query and pressing Enter did nothing at all.
 */
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
  /** The row arrowed onto. Derived against the live list below, never trusted
   *  on its own, so a keystroke that removes it cannot dangle. */
  const [chosenId, setChosenId] = useState<string | null>(null);
  const listboxId = useId();
  const optionId = (id: string) => `${listboxId}-${id}`;

  const sections = useMemo(() => searchEditor(entries, query), [entries, query]);
  /** The rows in render order, which is the order the arrows walk. */
  const flat = useMemo(() => sections.flatMap((section) => section.hits), [sections]);

  const activeId =
    chosenId && flat.some((hit) => hit.entry.id === chosenId)
      ? chosenId
      : (flat[0]?.entry.id ?? null);

  function move(delta: 1 | -1) {
    if (flat.length === 0) return;
    const index = flat.findIndex((hit) => hit.entry.id === activeId);
    const next = flat[(index + delta + flat.length) % flat.length];
    if (next) setChosenId(next.entry.id);
  }

  function pick(entry: EditorSearchEntry) {
    setQuery("");
    setChosenId(null);
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
          setQuery("");
          setChosenId(null);
        }
        break;
    }
  }

  const open = query.trim() !== "";

  return (
    <div className="border-b border-border pt-2 pb-3 lg:px-4">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          strokeWidth={2}
          aria-hidden="true"
        />
        <input
          type="search"
          role="combobox"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Find a setting or object"
          aria-label="Find a setting or object"
          aria-autocomplete="list"
          aria-expanded={flat.length > 0}
          aria-controls={flat.length > 0 ? listboxId : undefined}
          aria-activedescendant={activeId ? optionId(activeId) : undefined}
          autoComplete="off"
          spellCheck={false}
          className={cn(fieldBaseClass, "w-full pl-8 text-sm")}
        />
      </div>

      {open && (
        <div className="mt-2">
          {flat.length === 0 ? (
            <p className={infoTextClass}>Nothing in the editor matches that.</p>
          ) : (
            // Divs, not buttons in a list: inside role="listbox" the only
            // legal child is role="option" (or a group of them), and an option
            // must not also be a control. Focus lives in the input regardless,
            // so the rows are driven by aria-activedescendant exactly as in
            // SearchOverlay.
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
                  onHover={setChosenId}
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
    <div role="group" aria-label={showLabel ? undefined : label} aria-labelledby={showLabel ? headingId : undefined}>
      {showLabel && (
        <p
          id={headingId}
          className="px-2 pb-0.5 pt-2 font-inter text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground"
        >
          {label}
        </p>
      )}
      {hits.map(({ entry, matchedTerm }) => {
        const active = entry.id === activeId;
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
        const via = explained ? null : matchedTerm;
        return (
          <div
            key={entry.id}
            id={optionId(entry.id)}
            role="option"
            aria-selected={active}
            // Keep focus in the input, or the combobox collapses before the
            // click lands. Mouse only: preventing the default on a touch
            // pointerdown also kills the synthesized click, so every tap would
            // do nothing.
            onPointerDown={(event) => {
              if (event.pointerType === "mouse") event.preventDefault();
            }}
            onClick={() => onPick(entry)}
            onMouseMove={() => onHover(entry.id)}
            className={cn(
              "flex cursor-pointer items-baseline justify-between gap-2 rounded-sm px-2 py-1.5 text-left transition-colors duration-base ease-standard motion-reduce:transition-none",
              active ? "bg-accent" : "hover:bg-accent/50",
            )}
          >
            <span className="min-w-0">
              <span className="block truncate text-sm text-foreground">
                {entry.title}
              </span>
              {via && (
                <span className={cn(infoTextClass, "block truncate")}>{via}</span>
              )}
            </span>
            <span className={cn(infoTextClass, "shrink-0")}>
              {entryLocation(entry)}
            </span>
          </div>
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
