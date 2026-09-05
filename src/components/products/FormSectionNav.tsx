"use client";

import { useEffect, useState, type MouseEvent } from "react";
import { Check, CircleAlert } from "lucide-react";
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
 * both: every section named in one place, each with what it currently holds.
 *
 * It carries STATE, not just names — that is what makes it worth the space.
 * "Photos · 3 photos" and "Photos · Empty" answer the question the seller
 * actually has without going there, and a section with a problem is the one
 * thing here painted in the destructive tone.
 *
 * Wide screens only. On a narrow one there is no margin to put it in, and a
 * horizontal strip of nine chips above a form is a second thing to scroll
 * past rather than a way through it. The section headers carry the same
 * summaries, so nothing is only available here.
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
                  "flex flex-col gap-0.5 rounded-sm px-3 py-1.5 font-inter text-sm transition-colors duration-base ease-standard motion-reduce:transition-none",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                  current
                    ? "bg-accent font-medium text-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <span className="flex items-center gap-1.5">
                  {/* Only two things earn an icon: a problem, and a required
                      section that is done. Ticking every filled section would
                      make the two that matter invisible among nine. */}
                  {section.state === "invalid" ? (
                    <CircleAlert
                      className="size-3.5 shrink-0 text-destructive"
                      strokeWidth={2}
                      aria-hidden="true"
                    />
                  ) : section.required && section.state === "filled" ? (
                    <Check
                      className="size-3.5 shrink-0 text-muted-foreground"
                      strokeWidth={2.5}
                      aria-hidden="true"
                    />
                  ) : null}
                  <span className="min-w-0 truncate">{section.label}</span>
                </span>
                {/* The summary is the payload of this rail. Muted and small,
                    because it is the second line of an answer whose first
                    line is the section name. */}
                <span
                  className={cn(
                    "truncate pl-0 font-inter text-xs",
                    section.state === "invalid" ? "text-destructive" : "text-muted-foreground",
                  )}
                >
                  {section.state === "invalid"
                    ? "Needs attention"
                    : section.summary || (section.required ? "Required" : "Empty")}
                </span>
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
 * `rootMargin` pulls the observation band up to a strip near the top of the
 * viewport, so the highlighted entry is the section whose heading you have
 * just reached rather than whichever one happens to be tallest on screen —
 * the latter jumps around on a form whose sections differ in height by 10x.
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
        // The FIRST section in the band, so scrolling down moves the highlight
        // forward one section at a time rather than skipping to the last one.
        const current = elements.find((element) => seen.get(element.id));
        if (current) setActive(current.dataset.productSection ?? null);
      },
      { rootMargin: "-80px 0px -70% 0px", threshold: 0 },
    );
    for (const element of elements) observer.observe(element);
    return () => observer.disconnect();
  }, [key]);

  return active;
}
