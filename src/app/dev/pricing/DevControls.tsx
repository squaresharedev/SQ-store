import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// The controls and section frame the billing dev galleries share.

/** A labelled row of pressable choices, one of them current. */
export function DevOptionGroup<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={label}>
      <span className="w-full font-inter text-xs text-muted-foreground sm:w-auto">{label}</span>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          className={cn(
            "border px-3 py-1.5 font-inter text-xs",
            option.value === value ? "border-foreground bg-accent" : "border-border",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** One titled block of a gallery. */
export function GallerySection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mx-auto max-w-6xl space-y-3 px-6 py-6">
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      {children}
    </section>
  );
}
