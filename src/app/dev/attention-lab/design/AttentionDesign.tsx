"use client";

import { useState, type MouseEvent, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { AlertCircle, ArrowRight, CheckCircle2, ChevronRight, type LucideIcon } from "lucide-react";
import { ModuleCard } from "@/components/dashboard/ModuleCard";
import {
  focusRingInsetClass,
  iconNudgeRightClass,
  infoTextClass,
  moduleLinkClass,
  panelEyebrowClass,
  primaryButtonClass,
  transitionClass,
} from "@/components/ui/control-styles";
import { badgeClass } from "@/components/ui/surface-styles";
import type { AttentionItem } from "@/lib/dashboard/attention";
import { cn } from "@/lib/utils";
import type { AttentionDesignProps } from "../lab-model";
import { ATTENTION_ICONS } from "@/components/dashboard/attention-icons";

/**
 * The overview's "Needs attention" card as the lab draws it: every knob of
 * AttentionDesignProps, over real rows from lib/dashboard/attention.ts. With
 * the defaults it is the shipped card (components/dashboard/NeedsAttention).
 *
 * Phone versus wide is decided by the CARD's width (`@container`, wide from
 * `@lg`), not the screen's, so the lab's 412px phone box draws it as a phone
 * would and the real page could keep the same classes.
 */

type Row = {
  key: string;
  label: string;
  description: string;
  action: string;
  href: string;
  count: number | null;
  urgent: boolean;
  Icon: LucideIcon;
};

const PAD: Record<AttentionDesignProps["density"], { y: string; pull: string; tile: string }> = {
  tight: { y: "py-2", pull: "-my-2", tile: "p-2.5" },
  regular: { y: "py-2.5", pull: "-my-2.5", tile: "p-3" },
  roomy: { y: "py-3.5", pull: "-my-3.5", tile: "p-4" },
};

const DETAIL: Record<AttentionDesignProps["detail"], string> = {
  full: "",
  clamp: "line-clamp-1",
  wide: "hidden @lg:block",
  none: "hidden",
};

/** A count row's label without its leading number, which has a column of its own. */
function withoutCount(label: string, count: number | null): string {
  if (count === null || !/^\d/.test(label)) return label;
  return label.replace(/^[\d\s.,  ]+/, "");
}

/** A destination. In the lab a press reports where it would go instead of leaving. */
function Go({
  href,
  onOpen,
  className,
  children,
}: {
  href: string;
  onOpen?: (href: string) => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      className={className}
      onClick={(event: MouseEvent) => {
        if (!onOpen) return;
        event.preventDefault();
        onOpen(href);
      }}
    >
      {children}
    </a>
  );
}

function Arrow() {
  return <ArrowRight className={cn("size-3 shrink-0", iconNudgeRightClass)} strokeWidth={2} aria-hidden="true" />;
}

/** The action's words, drawn like ModuleActionLink; a span when the whole row is already the link. */
function ActionWords({ row, asSpan, className }: { row: Row; asSpan?: boolean; className?: string }) {
  const body = (
    <>
      {row.action}
      <Arrow />
    </>
  );
  return asSpan ? <span className={cn(moduleLinkClass, "w-fit", className)}>{body}</span> : <>{body}</>;
}

function Marker({ row, design }: { row: Row; design: AttentionDesignProps }) {
  const lifted = design.urgency === "ink" && row.urgent;
  const tone = lifted ? "text-foreground" : "text-muted-foreground";
  const { Icon } = row;
  switch (design.marker) {
    case "none":
      return null;
    case "dot":
      return (
        <span
          aria-hidden="true"
          className={cn(
            "mt-1.5 size-2 shrink-0 rounded-full",
            design.urgency === "ink" ? (row.urgent ? "bg-foreground" : "bg-border") : "bg-muted-foreground",
          )}
        />
      );
    case "boxed":
      return (
        <span
          aria-hidden="true"
          className={cn("flex size-9 shrink-0 items-center justify-center border", lifted ? "border-foreground text-foreground" : "border-border text-muted-foreground")}
        >
          <Icon className="size-4" strokeWidth={2} />
        </span>
      );
    case "kind":
      return <Icon className={cn("mt-0.5 size-4 shrink-0", tone)} strokeWidth={2} aria-hidden="true" />;
    default:
      return <AlertCircle className={cn("mt-0.5 size-4 shrink-0", tone)} strokeWidth={2} aria-hidden="true" />;
  }
}

function Words({ row, design, children }: { row: Row; design: AttentionDesignProps; children?: ReactNode }) {
  const lifted = design.urgency === "ink" && row.urgent;
  return (
    <span className="block min-w-0 flex-1">
      <span className={cn("block text-sm text-foreground", lifted ? "font-semibold" : "font-medium")}>{row.label}</span>
      {design.detail !== "none" && <span className={cn("block", infoTextClass, DETAIL[design.detail])}>{row.description}</span>}
      {children}
    </span>
  );
}

/** The urgent row's flag on the card's left edge (urgency "bar"). */
const barClass = "relative before:absolute before:inset-y-2 before:-left-4 before:w-0.5 before:bg-foreground";

function ListRow({ row, design, onOpen }: { row: Row; design: AttentionDesignProps; onOpen?: (href: string) => void }) {
  const pad = PAD[design.density];
  const bar = design.urgency === "bar" && row.urgent && barClass;
  const linkRow = design.rowLink || design.action === "chevron";

  if (linkRow) {
    const action = design.action === "wrap" ? "end" : design.action;
    return (
      <li className={cn("relative", bar)}>
        <Go
          href={row.href}
          onOpen={onOpen}
          className={cn("group/btn -mx-2 flex items-start gap-2.5 px-2 hover:bg-accent", pad.y, transitionClass, focusRingInsetClass)}
        >
          <Marker row={row} design={design} />
          <Words row={row} design={design}>
            {(action === "under" || action === "responsive") && (
              <ActionWords row={row} asSpan className={cn("mt-1.5 flex", action === "responsive" && "@lg:hidden")} />
            )}
          </Words>
          {action === "end" && <ActionWords row={row} asSpan className="mt-0.5 shrink-0" />}
          {action === "responsive" && <ActionWords row={row} asSpan className="mt-0.5 hidden shrink-0 @lg:inline-flex" />}
          {action === "chevron" && <ChevronRight className="size-4 shrink-0 self-center text-muted-foreground" strokeWidth={2} aria-hidden="true" />}
        </Go>
      </li>
    );
  }

  const go = (className?: string) => (
    <Go href={row.href} onOpen={onOpen} className={cn(moduleLinkClass, className)}>
      <ActionWords row={row} />
    </Go>
  );

  if (design.action === "wrap") {
    // Shipped: at the end when it fits, wrapped under the icon when it does not.
    return (
      <li className={cn("flex flex-wrap items-center justify-between gap-2 first:pt-0 last:pb-0", pad.y, bar)}>
        <div className="flex min-w-0 items-start gap-2">
          <Marker row={row} design={design} />
          <Words row={row} design={design} />
        </div>
        {go()}
      </li>
    );
  }

  return (
    <li className={cn("flex items-start gap-2.5 first:pt-0 last:pb-0", pad.y, bar)}>
      <Marker row={row} design={design} />
      <Words row={row} design={design}>
        {(design.action === "under" || design.action === "responsive") && (
          <span className={cn("mt-1.5 block", design.action === "responsive" && "@lg:hidden")}>{go()}</span>
        )}
      </Words>
      {design.action === "end" && go("mt-0.5 shrink-0")}
      {design.action === "responsive" && go("mt-0.5 hidden shrink-0 @lg:inline-flex")}
    </li>
  );
}

function CountRow({ row, design, onOpen }: { row: Row; design: AttentionDesignProps; onOpen?: (href: string) => void }) {
  const pad = PAD[design.density];
  const lifted = design.urgency === "ink" && row.urgent;
  const { Icon } = row;
  const words = { ...row, label: withoutCount(row.label, row.count) };
  const showWords = design.action !== "chevron";
  return (
    <li className={cn("relative", design.urgency === "bar" && row.urgent && barClass)}>
      <Go
        href={row.href}
        onOpen={onOpen}
        className={cn("group/btn -mx-2 flex items-center gap-3 px-2 hover:bg-accent", pad.y, transitionClass, focusRingInsetClass)}
      >
        <span className={cn("flex w-11 shrink-0 justify-start", lifted || design.urgency !== "ink" ? "text-foreground" : "text-muted-foreground")}>
          {row.count !== null ? (
            <span className="text-xl font-semibold leading-none tabular-nums">{row.count}</span>
          ) : (
            <Icon className="size-5" strokeWidth={2} aria-hidden="true" />
          )}
        </span>
        <Words row={words} design={design}>
          {showWords && design.action !== "end" && <ActionWords row={row} asSpan className={cn("mt-1 flex", design.action === "responsive" && "@lg:hidden")} />}
        </Words>
        {showWords && design.action === "end" && <ActionWords row={row} asSpan className="shrink-0" />}
        {showWords && design.action === "responsive" && <ActionWords row={row} asSpan className="hidden shrink-0 @lg:inline-flex" />}
        {!showWords && <ChevronRight className="size-4 shrink-0 text-muted-foreground" strokeWidth={2} aria-hidden="true" />}
      </Go>
    </li>
  );
}

function Tile({ row, design, onOpen }: { row: Row; design: AttentionDesignProps; onOpen?: (href: string) => void }) {
  const lifted = (design.urgency === "ink" || design.urgency === "group") && row.urgent;
  return (
    <li className="flex">
      <Go
        href={row.href}
        onOpen={onOpen}
        className={cn(
          "group/btn flex w-full flex-col gap-2 border bg-background hover:bg-accent",
          PAD[design.density].tile,
          lifted ? "border-foreground" : "border-border",
          design.urgency === "bar" && row.urgent && "border-t-2 border-t-foreground",
          transitionClass,
          focusRingInsetClass,
        )}
      >
        {design.marker !== "none" && <Marker row={row} design={design} />}
        <span className={cn("block text-sm text-foreground", lifted ? "font-semibold" : "font-medium")}>{row.label}</span>
        {design.detail !== "none" && <span className={cn("block", infoTextClass, design.detail === "clamp" ? "line-clamp-2" : DETAIL[design.detail])}>{row.description}</span>}
        <span className="mt-auto pt-1">
          {design.action === "chevron" ? (
            <ChevronRight className="size-4 text-muted-foreground" strokeWidth={2} aria-hidden="true" />
          ) : (
            <ActionWords row={row} asSpan className="flex" />
          )}
        </span>
      </Go>
    </li>
  );
}

function Lead({ row, design, onOpen }: { row: Row; design: AttentionDesignProps; onOpen?: (href: string) => void }) {
  return (
    <div className="flex items-start gap-3 bg-muted p-4">
      <Marker row={row} design={{ ...design, marker: design.marker === "none" || design.marker === "dot" ? "boxed" : design.marker }} />
      <div className="min-w-0 flex-1">
        <p className="text-base font-semibold text-foreground">{row.label}</p>
        <p className={cn(infoTextClass, "mt-0.5")}>{row.description}</p>
        <Go href={row.href} onOpen={onOpen} className={cn(primaryButtonClass, "mt-3 h-9 px-3 text-xs")}>
          {row.action}
          <Arrow />
        </Go>
      </div>
    </div>
  );
}

function Rows({ rows, design, onOpen }: { rows: Row[]; design: AttentionDesignProps; onOpen?: (href: string) => void }) {
  if (rows.length === 0) return null;
  if (design.layout === "tiles") {
    return (
      <ul className="grid grid-cols-2 gap-2 @lg:grid-cols-3">
        {rows.map((row) => (
          <Tile key={row.key} row={row} design={design} onOpen={onOpen} />
        ))}
      </ul>
    );
  }
  const linkRows = design.layout === "count" || design.rowLink || design.action === "chevron";
  return (
    <ul className={cn("divide-y divide-border", linkRows && PAD[design.density].pull)}>
      {rows.map((row) =>
        design.layout === "count" ? (
          <CountRow key={row.key} row={row} design={design} onOpen={onOpen} />
        ) : (
          <ListRow key={row.key} row={row} design={design} onOpen={onOpen} />
        ),
      )}
    </ul>
  );
}

/** Rows under a small heading each, waiting-on-you first (urgency "group"). */
function Grouped({ rows, design, onOpen }: { rows: Row[]; design: AttentionDesignProps; onOpen?: (href: string) => void }) {
  const urgent = rows.filter((row) => row.urgent);
  const rest = rows.filter((row) => !row.urgent);
  if (urgent.length === 0 || rest.length === 0) return <Rows rows={rows} design={design} onOpen={onOpen} />;
  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <h3 className={panelEyebrowClass}>Waiting on you</h3>
        <Rows rows={urgent} design={design} onOpen={onOpen} />
      </section>
      <section className="space-y-3">
        <h3 className={panelEyebrowClass}>When you have a minute</h3>
        <Rows rows={rest} design={design} onOpen={onOpen} />
      </section>
    </div>
  );
}

export function AttentionDesign({
  design,
  items,
  onOpen,
}: {
  design: AttentionDesignProps;
  items: AttentionItem[];
  /** Where a press would go; without it the links are real. */
  onOpen?: (href: string) => void;
}) {
  const t = useTranslations();
  const [expanded, setExpanded] = useState(false);

  const rows: Row[] = items.map((item) => {
    const count = item.label.values?.count;
    return {
      key: item.key,
      label: t(item.label.key, item.label.values),
      description: t(item.description.key, item.description.values),
      action: t(item.actionLabel.key, item.actionLabel.values),
      href: item.href,
      count: typeof count === "number" ? count : null,
      urgent: item.urgent ?? false,
      Icon: ATTENTION_ICONS[item.key],
    };
  });

  const lead = design.layout === "lead" ? rows[0] : undefined;
  const listed = lead ? rows.slice(1) : rows;
  const cut = design.limit > 0 && !expanded && listed.length > design.limit + 1 ? design.limit : listed.length;
  const shown = listed.slice(0, cut);
  const hidden = listed.length - cut;

  return (
    <div className="@container">
      <ModuleCard
        title={t("Dashboard.attention.title")}
        decoration={design.decoration === "dots" ? "dots" : undefined}
        action={design.titleCount && rows.length > 0 ? <span className={cn(badgeClass, "tabular-nums")}>{rows.length}</span> : undefined}
      >
        {rows.length === 0 ? (
          <p className="flex items-center gap-2 font-inter text-sm text-muted-foreground">
            <CheckCircle2 className="size-4 text-success" strokeWidth={2} aria-hidden="true" />
            {t("Dashboard.attention.allClear")}
          </p>
        ) : (
          <div className="space-y-4">
            {lead && <Lead row={lead} design={design} onOpen={onOpen} />}
            {design.urgency === "group" && design.layout !== "lead" ? (
              <Grouped rows={shown} design={design} onOpen={onOpen} />
            ) : (
              <Rows rows={shown} design={design} onOpen={onOpen} />
            )}
            {(hidden > 0 || (expanded && design.limit > 0)) && (
              <button type="button" onClick={() => setExpanded((open) => !open)} className={cn(moduleLinkClass, design.layout !== "tiles" && "mt-1")}>
                {hidden > 0 ? `Show ${hidden} more` : "Show fewer"}
              </button>
            )}
          </div>
        )}
      </ModuleCard>
    </div>
  );
}
