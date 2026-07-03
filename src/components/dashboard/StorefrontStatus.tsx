import Link from "next/link";
import { secondaryButtonClass } from "@/components/ui/control-styles";
import { ModuleCard } from "./ModuleCard";

/** Storefront state + the ways out of it. There is no embed snippet yet, so
 *  "Get embed code" routes to the storefront designer for now. */
export function StorefrontStatus({
  saved,
  blockCount,
}: {
  /** Whether a storefront row exists at all. */
  saved: boolean;
  blockCount: number;
}) {
  const live = saved && blockCount > 0;

  return (
    <ModuleCard title="Storefront" decoration="grid">
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className={`size-1.5 rounded-full ${live ? "bg-success" : "bg-muted-foreground"}`}
        />
        <p className="text-sm font-medium text-foreground">
          {live ? "Live" : "Draft"}
        </p>
      </div>
      <p className="mt-1 font-inter text-sm text-muted-foreground">
        {live
          ? `${blockCount} block${blockCount === 1 ? "" : "s"} in your grid.`
          : saved
            ? "Saved, but your grid is still empty."
            : "Not saved yet. Arrange your grid and save it."}
      </p>

      <div className="mt-4 flex flex-col gap-2">
        <Link href="/storefront" className={secondaryButtonClass}>
          {saved ? "Edit storefront" : "Set up storefront"}
        </Link>
        <Link href="/storefront" className={secondaryButtonClass}>
          Get embed code
        </Link>
      </div>
    </ModuleCard>
  );
}
