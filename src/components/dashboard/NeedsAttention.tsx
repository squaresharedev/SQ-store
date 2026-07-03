import Link from "next/link";
import { AlertCircle, ArrowRight, CheckCircle2 } from "lucide-react";
import { ModuleCard } from "./ModuleCard";

export type AttentionItem = {
  key: string;
  label: string;
  description: string;
  href: string;
  actionLabel: string;
};

/** Real, data-backed action items; quiet "all clear" when there are none. */
export function NeedsAttention({ items }: { items: AttentionItem[] }) {
  return (
    <ModuleCard title="Needs attention" decoration="dots">
      {items.length === 0 ? (
        <p className="flex items-center gap-2 font-inter text-sm text-muted-foreground">
          <CheckCircle2
            className="size-4 text-success"
            strokeWidth={2}
            aria-hidden="true"
          />
          All clear. Nothing needs your attention right now.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((item) => (
            <li
              key={item.key}
              className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0"
            >
              <div className="flex min-w-0 items-start gap-2">
                <AlertCircle
                  className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                  strokeWidth={2}
                  aria-hidden="true"
                />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">
                    {item.label}
                  </p>
                  <p className="font-inter text-xs text-muted-foreground">
                    {item.description}
                  </p>
                </div>
              </div>
              <Link
                href={item.href}
                className="inline-flex items-center gap-1 font-inter text-xs font-medium text-foreground underline decoration-border underline-offset-4 transition-colors duration-180 ease-in-out hover:decoration-foreground motion-reduce:transition-none"
              >
                {item.actionLabel}
                <ArrowRight className="size-3" strokeWidth={2} aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </ModuleCard>
  );
}
