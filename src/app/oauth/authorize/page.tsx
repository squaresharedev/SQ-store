import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ShieldAlert } from "lucide-react";
import { ConsentForm } from "@/components/agent/ConsentForm";
import { AuthPageShell } from "@/components/auth/AuthPageShell";
import { StepUpProvider } from "@/components/auth/StepUp";
import { HeroMark } from "@/components/ui/HeroMark";
import { agentAccessEnabled, agentAccessAllowedForStore } from "@/lib/agent/access";
import { deniedRedirect, judgeAuthorizeRequest } from "@/lib/agent/oauth/authorize";
import { redirectDisplayHost } from "@/lib/agent/oauth/redirects";
import { OAUTH_AUTHORIZE_PATH } from "@/lib/agent/paths";
import { AGENT_SCOPES, AGENT_SCOPE_IDS, initialScopes } from "@/lib/agent/scopes";
import { stepUpProviderProps } from "@/lib/auth/assurance";
import { getAssurance, requireUser } from "@/lib/auth/session";
import { getAccessibleAccounts } from "@/lib/team/account-context";
import { TEAM_PERMISSIONS } from "@/lib/team/permissions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Settings.connectedApps.consent");
  return {
    title: t("metadataTitle"),
    // The URL holds the app's state and challenge: not for passing on.
    referrer: "no-referrer",
    robots: { index: false, follow: false },
  };
}

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * GET /oauth/authorize: where an app sends a seller to ask for access. Opening
 * it decides nothing (link previews and prefetchers open pages). Only the signed-
 * in person's press of Connect does, through approveAgentConnection.
 */
export default async function AuthorizePage({ searchParams }: { searchParams: SearchParams }) {
  if (!agentAccessEnabled()) notFound();

  const raw = await searchParams;
  const params: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(raw)) {
    params[key] = Array.isArray(value) ? value[0] : value;
  }

  const query = new URLSearchParams(
    Object.entries(params).flatMap(([key, value]) => (value === undefined ? [] : [[key, value]])),
  );
  await requireUser(`${OAUTH_AUTHORIZE_PATH}?${query}`);

  const judged = await judgeAuthorizeRequest(params);
  if (judged.kind === "redirect") redirect(judged.to);
  if (judged.kind === "fatal") {
    const t = await getTranslations("Settings.connectedApps.consent");
    return (
      <AuthPageShell>
        <div className="flex flex-col items-center gap-3 text-center" data-agent-consent-refused={judged.reason}>
          <HeroMark icon={ShieldAlert} />
          <h1 className="text-lg font-semibold text-foreground">{t("refusedTitle")}</h1>
          <p className="text-sm text-muted-foreground">{t("refusedBody")}</p>
        </div>
      </AuthPageShell>
    );
  }

  const stores = agentAccessAllowedForStore() ? await getAccessibleAccounts() : [];
  const ticked = initialScopes(judged.params.requestedScopes);
  const assurance = await getAssurance();

  return (
    <AuthPageShell>
      <StepUpProvider {...stepUpProviderProps(assurance)}>
        <ConsentForm
          appName={judged.client.name}
          redirectHost={redirectDisplayHost(judged.params.redirectUri)}
          hidden={{
            client_id: judged.params.clientId,
            redirect_uri: judged.params.redirectUri,
            state: judged.params.state,
            code_challenge: judged.params.codeChallenge,
            resource: judged.params.resource,
          }}
          denyHref={deniedRedirect(judged.params)}
          stores={stores.map((store) => ({
            accountId: store.accountId,
            name: store.storeName,
            role: store.role,
            permissions: TEAM_PERMISSIONS[store.role],
          }))}
          scopes={AGENT_SCOPE_IDS.map((id) => ({
            id,
            label: AGENT_SCOPES[id].label,
            hint: AGENT_SCOPES[id].hint,
            requires: AGENT_SCOPES[id].requires,
            required: "required" in AGENT_SCOPES[id],
            optIn: "optIn" in AGENT_SCOPES[id],
            ticked: ticked.includes(id),
          }))}
        />
      </StepUpProvider>
    </AuthPageShell>
  );
}
