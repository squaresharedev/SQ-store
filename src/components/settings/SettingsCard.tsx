import { cn } from "@/lib/utils";

/**
 * One settings card: a titled white panel holding a single form or action.
 * Sections stack a few of these with generous spacing so sparse pages still
 * feel deliberate.
 */
export function SettingsCard({
  title,
  description,
  danger,
  children,
}: {
  title: string;
  description?: string;
  /** Red border treatment for danger-zone cards. */
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        "border bg-white p-6 sm:p-7",
        danger ? "border-red-200" : "border-neutral-200",
      )}
    >
      <h2
        className={cn(
          "text-base font-semibold",
          danger ? "text-red-600" : "text-neutral-900",
        )}
      >
        {title}
      </h2>
      {description && (
        <p className="mt-1 font-inter text-sm leading-relaxed text-neutral-500">
          {description}
        </p>
      )}
      <div className="mt-5">{children}</div>
    </section>
  );
}
