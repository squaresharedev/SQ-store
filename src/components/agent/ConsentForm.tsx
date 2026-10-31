"use client";

import * as React from "react";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { StepUpPrompt, StepUpScope, StepUpSubmit } from "@/components/auth/StepUp";
import { ActionErrorNotice } from "@/components/ui/ActionErrorNotice";
import { buttonClassName } from "@/components/ui/button";
import { helpTextClass } from "@/components/ui/control-styles";
import { InfoTip } from "@/components/ui/InfoTip";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { approveAgentConnection, type ConsentState } from "@/lib/agent/consent-actions";
import type { AgentScope } from "@/lib/agent/scopes";
import type { MessageKey } from "@/i18n/types";
import type { TeamAction, TeamRole } from "@/lib/team/permissions";

const INITIAL: ConsentState = {};

export type ConsentStore = {
  accountId: string;
  name: string;
  role: TeamRole;
  permissions: readonly TeamAction[];
};

export type ConsentScope = {
  id: AgentScope;
  label: MessageKey;
  hint: MessageKey;
  requires: TeamAction;
  required: boolean;
  optIn: boolean;
  ticked: boolean;
};

/**
 * "May this app work on your store?" One app, one store, a short list of
 * switches, one button. The host the approval goes to is the loudest thing after
 * the name, because the name is whatever the app said it was and the host is
 * the one part it cannot fake and still receive the code.
 *
 * What a person's role could never do on the chosen store is not offered: a
 * scope narrows a role and never widens one.
 */
export function ConsentForm({
  appName,
  redirectHost,
  hidden,
  denyHref,
  stores,
  scopes,
}: {
  appName: string;
  redirectHost: string;
  hidden: Record<string, string | undefined>;
  denyHref: string;
  stores: ConsentStore[];
  scopes: ConsentScope[];
}) {
  const t = useTranslations("Settings.connectedApps.consent");
  const resolve = useTranslations();
  const [state, formAction, pending] = useActionState(approveAgentConnection, INITIAL);
  const [storeId, setStoreId] = React.useState(stores[0]?.accountId ?? "");
  const [ticked, setTicked] = React.useState<ReadonlySet<AgentScope>>(
    () => new Set(scopes.filter((scope) => scope.ticked).map((scope) => scope.id)),
  );

  // The app gets its code by a full navigation: it is the app's page, not ours.
  React.useEffect(() => {
    if (state.redirectTo) window.location.assign(state.redirectTo);
  }, [state.redirectTo]);

  if (state.redirectTo) {
    return (
      <p role="status" className="text-center text-sm text-foreground" data-agent-consent="connected">
        {t("connected", { app: appName })}
      </p>
    );
  }

  const store = stores.find((candidate) => candidate.accountId === storeId);
  const offered = scopes.filter((scope) => store?.permissions.includes(scope.requires));

  return (
    <form action={formAction} className="flex flex-col gap-5" data-agent-consent="form">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold text-foreground">{t("title", { app: appName })}</h1>
        <p className="text-sm text-muted-foreground" data-agent-consent-host>
          {t.rich("sendsTo", {
            host: redirectHost,
            strong: (chunks) => <strong className="font-semibold text-foreground">{chunks}</strong>,
          })}
        </p>
      </div>

      {Object.entries(hidden).map(([name, value]) =>
        value === undefined ? null : <input key={name} type="hidden" name={name} value={value} />,
      )}

      <input type="hidden" name="account_id" value={storeId} />
      {stores.length > 1 ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="agent-consent-store">{t("store")}</Label>
          <Select
            id="agent-consent-store"
            value={storeId}
            options={stores.map((option) => ({ value: option.accountId, label: option.name }))}
            onChange={setStoreId}
          />
        </div>
      ) : null}

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-sm font-medium text-foreground">{t("scopesTitle")}</legend>
        {offered.map((scope) => {
          const on = ticked.has(scope.id);
          const labelId = `agent-scope-${scope.id.replace(":", "-")}`;
          return (
            <div key={scope.id} className="flex items-center justify-between gap-3" data-agent-scope={scope.id}>
              <span className="flex min-w-0 items-center gap-1.5 text-sm text-foreground">
                <span id={labelId}>{resolve(scope.label)}</span>
                <InfoTip label={resolve(scope.hint)}>{resolve(scope.hint)}</InfoTip>
              </span>
              <Switch
                aria-labelledby={labelId}
                checked={on}
                disabled={scope.required}
                onCheckedChange={(next) =>
                  setTicked((current) => {
                    const updated = new Set(current);
                    if (next) updated.add(scope.id);
                    else updated.delete(scope.id);
                    return updated;
                  })
                }
              />
              {on ? <input type="hidden" name="scope" value={scope.id} /> : null}
            </div>
          );
        })}
      </fieldset>

      <p className={helpTextClass}>{t("note", { app: appName })}</p>

      {state.error ? <ActionErrorNotice error={state.error} /> : null}
      {/* However the account confirms: no 2FA, or a recent sign-in, is just the
          button; a passkey IS the button; only an authenticator app types a code. */}
      <StepUpScope id="agent-consent" state={state}>
        <StepUpPrompt />
        <div className="flex items-center justify-end gap-3">
          <a href={denyHref} className={buttonClassName("ghost")}>
            {t("deny")}
          </a>
          <StepUpSubmit pending={pending} pendingLabel={t("approving")} disabled={!store}>
            {t("approve")}
          </StepUpSubmit>
        </div>
      </StepUpScope>
    </form>
  );
}
