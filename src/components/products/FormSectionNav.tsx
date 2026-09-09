"use client";

import { useEffect, useState, type MouseEvent } from "react";
import { CircleCheck, CircleX } from "lucide-react";
import { cn } from "@/lib/utils";
import { sectionAnchorId } from "./FormSection";
import type { ProductFormSectionSnapshot } from "@/lib/products/form-datapoints";

/**
 * A plain `href="#id"` click is a same-document navigation, and Chrome,
 * Safari and Firefox all fire a `popstate` event for it (not just
 * `hashchange`) even though nothing was actually traversed. The product
 * form's unsaved-changes guard listens for `popstate` to catch the browser
 * Back button, so left unhandled, every click here while the form is dirty
 * was mistaken for a Back press and popped the "Discard your changes?"
 * prompt. Scrolling by hand and updating the URL with `replaceState`
 * (which never fires `popstate`) keeps the same jump-to-section behaviour
 * without feeding the guard a false signal.
 */
function handleNavClick(event: MouseEvent<HTMLAnchorElement>, id: string) {
  // Leave modified/non-primary clicks (open in new tab, etc.) to the browser.
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return;
  }
  event.preventDefault();
  const anchorId = sectionAnchorId(id);
  document.getElementById(anchorId)?.scrollIntoView({ behavior: "smooth", block: "start" });
  window.history.replaceState(null, "", `#${anchorId}`);
}

/**
 * WHERE AM I, AND WHAT IS LEFT.
 *
 * A product form is nine sections and roughly forty fields; at full height it
 * is several screens long. Without an index, a seller who came to change one
 * thing has to scroll and read headings to find it, and a seller filling one
 * in has no idea how much is left or which two fields are actually stopping
 * the save. Both are scanning problems, and a standing index is the answer to
 * both: every section named in one place.
 *
 * It carries STATE, not just names — that is what makes it worth the space.
 * A green check is a section that is filled in and fine; a red cross is one
 * with a problem the seller needs to go fix. The section's own header carries
 * the longer summary ("3 photos"), so the index stays a plain list of names
 * plus that one signal rather than a second place to read the same detail.
 *
 * Wide screens only. On a narrow one there is no margin to put it in, and a
 * horizontal strip of nine chips above a form is a second thing to scroll
 * past rather than a way through it.
 */
export function FormSectionNav({
  sections,
  className,
}: {
  sections: ProductFormSectionSnapshot[];
  className?: string;
}) {
  const active = useActiveSection(sections.map((section) => section.id));

  return (
    <nav aria-label="Form sections" className={className} data-product-form-nav="">
      <p className="px-3 pb-2 font-inter text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        On this page
      </p>
      <ul className="space-y-px">
        {sections.map((section) => {
          const current = section.id === active;
          return (
            <li key={section.id}>
              <a
                href={`#${sectionAnchorId(section.id)}`}
                onClick={(event) => handleNavClick(event, section.id)}
                aria-current={current ? "true" : undefined}
                data-product-form-nav-item={section.id}
                data-product-section-state={section.state}
                className={cn(
                  "flex items-center gap-1.5 rounded-sm px-3 py-1.5 font-inter text-sm transition-colors duration-base ease-standard motion-reduce:transition-none",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                  current
                    ? "bg-accent font-medium text-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                {section.state === "invalid" ? (
                  <CircleX
                    className="size-3.5 shrink-0 text-destructive"
                    strokeWidth={2}
                    aria-hidden="true"
                  />
                ) : section.state === "filled" ? (
                  <CircleCheck
                    className="size-3.5 shrink-0 text-success"
                    strokeWidth={2}
                    aria-hidden="true"
                  />
                ) : (
                  <span className="size-3.5 shrink-0" aria-hidden="true" />
                )}
                <span className="min-w-0 truncate">{section.label}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * Which section the reader is looking at.
 *
 * `rootMargin` collapses the observed root to a single line at 50% top and
 * 50% bottom, i.e. exactly the viewport's vertical centre, so the highlighted
 * entry is whichever section that centre line is currently crossing. Sections
 * are stacked and non-overlapping, so at most one can ever cross that line at
 * once — no band-width tie-break to get wrong, and no jumping to whichever
 * section happens to be tallest on screen (the earlier "strip near the top"
 * band did neither: it lit up the section that had JUST reached the top,
 * which reads as the previous section still being "current" for most of the
 * scroll through the next one).
 */
function useActiveSection(ids: string[]): string | null {
  const [active, setActive] = useState<string | null>(null);
  // Depend on the JOINED ids, not the array: the caller rebuilds it every
  // render, and re-running the observer each time would tear down and rebuild
  // nine observations on every keystroke.
  const key = ids.join(",");

  useEffect(() => {
    const sectionIds = key ? key.split(",") : [];
    const elements = sectionIds
      .map((id) => document.getElementById(sectionAnchorId(id)))
      .filter((element): element is HTMLElement => element !== null);
    if (elements.length === 0) return;

    const seen = new Map<string, boolean>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) seen.set(entry.target.id, entry.isIntersecting);
        // Normally exactly one element is intersecting the centre line; the
        // FIRST match is a tie-break for the instant the line sits exactly on
        // a boundary between two sections (both can report `isIntersecting`
        // that one frame), favouring the section being scrolled INTO.
        const current = elements.find((element) => seen.get(element.id));
        if (current) setActive(current.dataset.productSection ?? null);
      },
      { rootMargin: "-50% 0px -50% 0px", threshold: 0 },
    );
    for (const element of elements) observer.observe(element);
    return () => observer.disconnect();
  }, [key]);

  return active;
}
