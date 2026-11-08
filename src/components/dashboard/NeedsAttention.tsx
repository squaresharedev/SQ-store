import { useTranslations } from "next-intl";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { infoTextClass } from "@/components/ui/control-styles";
import type { AttentionItem } from "@/lib/dashboard/attention";
import { ModuleActionLink, ModuleCard } from "./ModuleCard";

/** Real, data-backed action items; quiet "all clear" when there are none. */
export function NeedsAttention({
  items,
  setupVisible = false,
}: {
  items: AttentionItem[];
  /** The setup checklist is on screen. Its open steps are the to-do list then,
   *  and an "All clear" beside them would contradict it, so nothing renders. */
  setupVisible?: boolean;
}) {
  const t = useTranslations();
  if (items.length === 0 && setupVisible) return null;
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
              <ModuleActionLink href={item.href}>
                {t(item.actionLabel.key, item.actionLabel.values)}
              </ModuleActionLink>
            </li>
          ))}
        </ul>
      )}
    </ModuleCard>
  );
}
