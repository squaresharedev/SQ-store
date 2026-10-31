"use client";

import * as React from "react";
import { useActionState } from "react";
import { Plug } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { useActionStateToast } from "@/components/ui/ActionErrorNotice";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { helpTextClass } from "@/components/ui/control-styles";
import { CopyButton } from "@/components/ui/CopyButton";
import { HeroMark } from "@/components/ui/HeroMark";
import { revokeConnectedApp } from "@/lib/agent/consent-actions";
import { AGENT_SCOPES, type AgentScope } from "@/lib/agent/scopes";
import type { ActionState } from "@/lib/errors";

const INITIAL: ActionState = {};

const COPY_MESSAGES = {
  copy: "Settings.connectedApps.connect.copy",
  copied: "Settings.connectedApps.connect.copied",
  failed: "Settings.connectedApps.connect.copyFailed",
} as const;

export type ConnectedAppRow = {
  grantId: string;
  name: string;
  /** Where its approval went: the part of an app's identity it cannot just claim. */
  host: string | null;
  storeName: string | null;
  scopes: AgentScope[];
  lastUsedAt: string | null;
};

function AppRow({ app }: { app: ConnectedAppRow }) {
  const t = useTranslations("Settings.connectedApps");
  const resolve = useTranslations();
  const format = useFormatter();
  const [open, setOpen] = React.useState(false);
  const [state, formAction, pending] = useActionState(revokeConnectedApp, INITIAL);
  useActionStateToast(state);

  return (
    <li className="flex flex-col gap-2 border-t border-border py-4 first:border-t-0 first:pt-0" data-connected-app={app.name}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">{app.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {[app.host, app.storeName].filter(Boolean).join(" · ")}
          </p>
        </div>
        <Button type="button" variant="ghost" onClick={() => setOpen(true)}>
          {t("revoke")}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {app.scopes.map((scope) => resolve(AGENT_SCOPES[scope].label)).join(", ")}
      </p>
      <p className="text-xs text-muted-foreground">
        {app.lastUsedAt
          ? t("lastUsed", { when: format.dateTime(new Date(app.lastUsedAt), { dateStyle: "medium" }) })
          : t("neverUsed")}
      </p>

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

export function ConnectedAppsSection({
  mcpUrl,
  apps,
}: {
  /** Null while the agent switch is off. */
  mcpUrl: string | null;
  apps: ConnectedAppRow[];
}) {
  const t = useTranslations("Settings.connectedApps");

  return (
    <div className="flex flex-col gap-6">
      <SettingsCard title={t("connect.title")} description={t("connect.body")}>
        {mcpUrl ? (
          <div className="flex items-center gap-2" data-mcp-url>
            <code className="min-w-0 flex-1 truncate rounded-sm border border-border bg-muted px-3 py-2 text-sm text-foreground">
              {mcpUrl}
            </code>
            <CopyButton value={mcpUrl} variant="labelled" messages={COPY_MESSAGES} />
          </div>
        ) : (
          <p className={helpTextClass}>{t("connect.paused")}</p>
        )}
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
