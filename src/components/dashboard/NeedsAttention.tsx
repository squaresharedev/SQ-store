import Link from "next/link";
import { useTranslations } from "next-intl";
import { AlertCircle, ArrowRight, CheckCircle2 } from "lucide-react";
import { iconNudgeRightClass, infoTextClass } from "@/components/ui/control-styles";
import type { AttentionItem } from "@/lib/dashboard/attention";
import { ModuleCard } from "./ModuleCard";

/** Real, data-backed action items; quiet "all clear" when there are none. */
export function NeedsAttention({ items }: { items: AttentionItem[] }) {
  const t = useTranslations();
  return (
    <ModuleCard title={t("Dashboard.attention.title")} decoration="dots">
      {items.length === 0 ? (
        <p className="flex items-center gap-2 font-inter text-sm text-muted-foreground">
          <CheckCircle2
            className="size-4 text-success"
            strokeWidth={2}
            aria-hidden="true"
          />
          {t("Dashboard.attention.allClear")}
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
                    {t(item.label.key, item.label.values)}
                  </p>
                  <p className={infoTextClass}>
                    {t(item.description.key, item.description.values)}
                  </p>
                </div>
              </div>
              <Link
                href={item.href}
                className="group/btn inline-flex items-center gap-1 font-inter text-xs font-medium text-foreground underline decoration-border underline-offset-4 transition-colors duration-base ease-standard hover:decoration-foreground motion-reduce:transition-none"
              >
                {t(item.actionLabel.key, item.actionLabel.values)}
                <ArrowRight
                  className={`size-3 ${iconNudgeRightClass}`}
                  strokeWidth={2}
                  aria-hidden="true"
                />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </ModuleCard>
  );
}
