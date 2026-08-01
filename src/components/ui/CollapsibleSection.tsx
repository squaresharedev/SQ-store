"use client";

/**
 * CollapsibleSection — reusable side-panel section. Renders FLUSH: no card
 * chrome, so the content spans the panel's full width and neighbouring
 * sections are told apart by a divider line alone. Carries an optional
 * collapsible toggle (ChevronDown) and an optional header action slot; when
 * `collapsible` is false the section is always open and the header is a plain
 * <h2>.
 *
 * The horizontal padding lives HERE rather than on the panel, so the dividers
 * run edge to edge. On mobile the padding is dropped: there these sections sit
 * inside a bottom sheet that already provides its own.
 */

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export function CollapsibleSection({
  title,
  children,
  headerAction,
  collapsible = false,
  defaultOpen = true,
}: {
  title: string;
  children: React.ReactNode;
  headerAction?: React.ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const isOpen = !collapsible || open;

  return (
    <section className="border-b border-border">
      <div className="flex items-center justify-between gap-2 py-3 lg:px-4">
        {collapsible ? (
          <button
            type="button"
            onClick={() => setOpen((current) => !current)}
            aria-expanded={isOpen}
            className="flex min-w-0 flex-1 items-center justify-between gap-2 text-sm font-semibold text-foreground"
          >
            {title}
            <ChevronDown
              className={cn(
                "size-4 text-muted-foreground transition-transform duration-base ease-standard motion-reduce:transition-none",
                isOpen && "rotate-180",
              )}
              strokeWidth={2}
              aria-hidden="true"
            />
          </button>
        ) : (
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        )}
        {headerAction}
      </div>
      {isOpen && <div className="pb-4 lg:px-4">{children}</div>}
    </section>
  );
}
