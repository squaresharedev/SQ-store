"use client";

/**
 * CollapsibleSection — reusable panel section extracted from the inline
 * PanelSection in ControlsPanel.tsx. Renders a card-style section with an
 * optional collapsible toggle (ChevronDown), an optional header action slot,
 * and children in the body. When `collapsible` is false the section is always
 * open and the header is a plain <h2>.
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
    <section className="rounded-md border border-border bg-card p-4 shadow-xs">
      <div className="mb-3 flex items-center justify-between gap-2">
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
                "size-4 text-muted-foreground transition-transform duration-180 ease-in-out motion-reduce:transition-none",
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
      {isOpen && children}
    </section>
  );
}
