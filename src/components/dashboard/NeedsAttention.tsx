import { useTranslations } from "next-intl";
import { CheckCircle2 } from "lucide-react";
import { ATTENTION_VISIBLE_ROWS, type AttentionItem } from "@/lib/dashboard/attention";
import { AttentionRows, type AttentionRow } from "./AttentionRows";
import { ModuleCard } from "./ModuleCard";

/** Real, data-backed action items; quiet "all clear" when there are none. The
 *  copy is resolved here, on the server, and the rows (AttentionRows) get plain
 *  strings, so no message catalogue ships to the browser for them. */
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

  const rows: AttentionRow[] = items.map((item) => ({
    key: item.key,
    label: t(item.label.key, item.label.values),
    description: t(item.description.key, item.description.values),
    href: item.href,
    urgent: item.urgent ?? false,
  }));
  const visible = rows.length > ATTENTION_VISIBLE_ROWS + 1 ? ATTENTION_VISIBLE_ROWS : rows.length;

  return (
    <ModuleCard title={t("Dashboard.attention.title")}>
      {rows.length === 0 ? (
        <p className="flex items-center gap-2 font-inter text-sm text-muted-foreground">
          <CheckCircle2
            className="size-4 text-success"
            strokeWidth={2}
            aria-hidden="true"
          />
          {t("Dashboard.attention.allClear")}
        </p>
      ) : (
        <AttentionRows
          rows={rows}
          visible={visible}
          showMoreLabel={t("Dashboard.attention.showMore", { count: rows.length - visible })}
          showFewerLabel={t("Dashboard.attention.showFewer")}
        />
      )}
    </ModuleCard>
  );
}
