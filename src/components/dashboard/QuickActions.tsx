import Link from "next/link";
import { Code, Package, Plus, Store } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  primaryButtonClass,
  secondaryButtonClass,
} from "@/components/ui/control-styles";
import { cn } from "@/lib/utils";
import { ModuleCard } from "./ModuleCard";

type Action = {
  label: string;
  href: string;
  icon: LucideIcon;
  primary?: boolean;
};

const ACTIONS: Action[] = [
  { label: "Add product", href: "/products/new", icon: Plus, primary: true },
  { label: "Edit storefront", href: "/storefront", icon: Store },
  { label: "View products", href: "/products", icon: Package },
  // No embed snippet exists yet; the designer is where it will live.
  { label: "Get embed code", href: "/storefront", icon: Code },
];

/** The four things a seller reaches for most, one click from home. */
export function QuickActions() {
  return (
    <ModuleCard title="Quick actions">
      <div className="flex flex-col gap-2">
        {ACTIONS.map(({ label, href, icon: Icon, primary }) => (
          <Link
            key={label}
            href={href}
            className={cn(
              primary ? primaryButtonClass : secondaryButtonClass,
              "justify-start",
            )}
          >
            <Icon className="size-4" strokeWidth={2} aria-hidden="true" />
            {label}
          </Link>
        ))}
      </div>
    </ModuleCard>
  );
}
