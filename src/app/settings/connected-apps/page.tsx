import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ConnectedAppsSection } from "@/components/settings/ConnectedAppsSection";
import { agentAccessEnabled } from "@/lib/agent/access";
import { listConnectedApps } from "@/lib/agent/oauth/grants";
import { redirectDisplayHost } from "@/lib/agent/oauth/redirects";
import { CONNECTED_APPS_PATH, mcpResourceUrl } from "@/lib/agent/paths";
import { requireUser } from "@/lib/auth/session";
import { getAccessibleAccounts } from "@/lib/team/account-context";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Settings.metadata.connectedApps");
  return { title: t("title") };
}

/**
 * Settings > Connected apps: the address to connect an assistant with, and every
 * app this person has let in, each one a press away from being out again. Stays
 * up while the agent switch is off, so anyone can still disconnect an app.
 */
export default async function ConnectedAppsPage() {
  const user = await requireUser(CONNECTED_APPS_PATH);
  const [apps, accounts] = await Promise.all([listConnectedApps(user.id), getAccessibleAccounts()]);
  const storeNames = new Map(accounts.map((account) => [account.accountId, account.storeName]));

  return (
    <ConnectedAppsSection
      mcpUrl={agentAccessEnabled() ? mcpResourceUrl() : null}
      apps={apps.map((app) => ({
        grantId: app.grantId,
        name: app.appName,
        host: app.redirectUris[0] ? redirectDisplayHost(app.redirectUris[0]) : null,
        storeName: storeNames.get(app.accountId) ?? null,
        scopes: app.scopes,
        lastUsedAt: app.lastUsedAt,
      }))}
    />
  );
}
