"use client";

import * as React from "react";
import { useActionState } from "react";
import { ExternalLink, Plug } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { AppLogo, ClaudeMark } from "@/components/agent/AppLogo";
import { SCOPE_ICONS } from "@/components/agent/scope-icons";
import { McpAddressSlab } from "@/components/settings/McpAddressSlab";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { useActionStateToast } from "@/components/ui/ActionErrorNotice";
import { Button, buttonClassName } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { helpTextClass, infoTextClass, labelClass } from "@/components/ui/control-styles";
import { CopyButton } from "@/components/ui/CopyButton";
import { Disclosure } from "@/components/ui/Disclosure";
import { HeroMark } from "@/components/ui/HeroMark";
import { InfoTip } from "@/components/ui/InfoTip";
import {
  mutedBadgeClass,
  switchStateClass,
  switchStateOffClass,
  switchStateOnClass,
} from "@/components/ui/surface-styles";
import { revokeConnectedApp } from "@/lib/agent/consent-actions";
import { CLAUDE_CONNECTORS_URL } from "@/lib/agent/paths";
import { AGENT_SCOPES, AGENT_SCOPE_IDS, scopeBadge, type AgentScope } from "@/lib/agent/scopes";
import type { ActionState } from "@/lib/errors";
import { cn } from "@/lib/utils";

const INITIAL: ActionState = {};

const COPY_MESSAGES = {
  copy: "Settings.connectedApps.connect.copy",
  copied: "Settings.connectedApps.connect.copied",
  failed: "Settings.connectedApps.connect.copyFailed",
} as const;

/** Two columns where there is room: the list is twelve short lines. */
const SCOPE_GRID_CLASS = "grid gap-x-6 gap-y-2 sm:grid-cols-2";

/** Lines text up with a ScopeName's words: its icon (size-4) plus its gap (2.5). */
const SCOPE_TEXT_INDENT_CLASS = "pl-6.5";

export type ConnectedAppRow = {
  grantId: string;
  name: string;
  /** Where its approval went: the part of an app's identity it cannot just claim. */
  host: string | null;
  storeName: string | null;
  scopes: AgentScope[];
  lastUsedAt: string | null;
};

/** One thing an assistant may do: its picture and its name. */
function ScopeName({ scope, muted = false }: { scope: AgentScope; muted?: boolean }) {
  const resolve = useTranslations();
  const Icon = SCOPE_ICONS[scope];
  return (
    <span className={cn("flex min-w-0 items-center gap-2.5 font-inter text-sm", muted ? "text-muted-foreground" : "text-foreground")}>
      <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      <span className="truncate">{resolve(AGENT_SCOPES[scope].label)}</span>
    </span>
  );
}

function AppRow({ app }: { app: ConnectedAppRow }) {
  const t = useTranslations("Settings.connectedApps");
  const tState = useTranslations("Settings.security.approvals");
  const format = useFormatter();
  const [open, setOpen] = React.useState(false);
  const [state, formAction, pending] = useActionState(revokeConnectedApp, INITIAL);
  useActionStateToast(state);

  const used = app.lastUsedAt
    ? t("lastUsed", { when: format.dateTime(new Date(app.lastUsedAt), { dateStyle: "medium" }) })
    : t("neverUsed");

  return (
    <li className="flex flex-col gap-4 border-t border-border py-5 first:border-t-0 first:pt-0" data-connected-app={app.name}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <AppLogo name={app.name} host={app.host} />
          <div className="min-w-0">
            <p className="truncate font-inter text-sm font-medium text-foreground">{app.name}</p>
            <p className={cn(infoTextClass, "break-words")}>{[app.host, app.storeName, used].filter(Boolean).join(" · ")}</p>
          </div>
        </div>
        <Button type="button" variant="ghost-danger" onClick={() => setOpen(true)}>
          {t("revoke")}
        </Button>
      </div>

      <ul className={SCOPE_GRID_CLASS} aria-label={t("app.capabilitiesLabel", { app: app.name })}>
        {AGENT_SCOPE_IDS.map((scope) => {
          const on = app.scopes.includes(scope);
          return (
            <li key={scope} className="flex items-center justify-between gap-3" data-scope={scope} data-scope-state={on ? "on" : "off"}>
              <ScopeName scope={scope} muted={!on} />
              <span className={cn(switchStateClass, on ? switchStateOnClass : switchStateOffClass)}>
                {on ? tState("statusOn") : tState("statusOff")}
              </span>
            </li>
          );
        })}
      </ul>
      <p className={infoTextClass}>{t("app.changeHint", { app: app.name })}</p>

      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        visual={<HeroMark icon={Plug} />}
        title={t("revokeTitle", { app: app.name })}
        description={t("revokeBody")}
        tone="danger"
        confirmLabel={t("revoke")}
        pendingLabel={t("revoking")}
        pending={pending}
        action={formAction}
      >
        <input type="hidden" name="grant_id" value={app.grantId} />
      </ConfirmDialog>
    </li>
  );
}

export function ConnectedAppsSection({ mcpUrl, apps }: { mcpUrl: string; apps: ConnectedAppRow[] }) {
  const t = useTranslations("Settings.connectedApps");
  const resolve = useTranslations();

  return (
    <div className="flex flex-col gap-6">
      <SettingsCard title={t("connect.title")} description={t("connect.benefit")}>
        <div className="flex flex-col gap-6">
          {/* How to connect, before the address it is about. The protocol's
              name waits behind the "?", for an assistant that asks for it. */}
          <p className={cn(infoTextClass, "flex items-center gap-1.5")}>
            <span>{t("connect.body")}</span>
            <InfoTip label={t("connect.mcpHintLabel")}>{t("connect.mcpHint")}</InfoTip>
          </p>
          <div className="flex flex-wrap items-center gap-2" data-mcp-url>
            {/* A line of its own, whole: the address is the thing to read and copy. */}
            <McpAddressSlab mcpUrl={mcpUrl} className="min-w-0 basis-full" />
            <CopyButton value={mcpUrl} variant="labelled" messages={COPY_MESSAGES} />
            <a
              href={CLAUDE_CONNECTORS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonClassName("secondary")}
              data-open-claude
            >
              <ClaudeMark className="size-4" />
              {t("connect.openClaude")}
              <ExternalLink aria-hidden className="size-3.5 text-muted-foreground" />
            </a>
          </div>

          <div className="flex flex-col gap-3">
            <p className={labelClass}>{t("connect.capabilitiesTitle")}</p>
            <ul className={SCOPE_GRID_CLASS} data-mcp-capabilities>
              {AGENT_SCOPE_IDS.map((scope) => {
                const badge = scopeBadge(scope);
                return (
                  <li key={scope} data-scope={scope}>
                    <Disclosure
                      summary={
                        <span className="flex min-w-0 items-center gap-2">
                          <ScopeName scope={scope} />
                          {badge ? <span className={cn(mutedBadgeClass, "ml-auto")}>{resolve(badge)}</span> : null}
                        </span>
                      }
                    >
                      {/* Under the name's words, past its icon. */}
                      <p className={cn(infoTextClass, SCOPE_TEXT_INDENT_CLASS)} data-scope-hint>
                        {resolve(AGENT_SCOPES[scope].hint)}
                      </p>
                    </Disclosure>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </SettingsCard>

      <SettingsCard title={t("listTitle")}>
        {apps.length === 0 ? (
          <p className={helpTextClass}>{t("empty")}</p>
        ) : (
          <ul className="flex flex-col">
            {apps.map((app) => (
              <AppRow key={app.grantId} app={app} />
            ))}
          </ul>
        )}
      </SettingsCard>
    </div>
  );
}
