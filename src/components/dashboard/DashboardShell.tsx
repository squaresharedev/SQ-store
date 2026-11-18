import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { TopBar } from "@/components/layout/TopBar";
import { ViewingBanner } from "@/components/layout/ViewingBanner";
import { HiddenOnPaths } from "@/components/layout/HiddenOnPaths";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { ProfileMenu } from "@/components/layout/ProfileMenu";
import { NotificationsProvider } from "@/components/notifications/NotificationsProvider";
import { TourOverlay } from "@/components/onboarding/TourOverlay";
import { SearchProvider } from "@/components/search/SearchProvider";
import { SearchMobileTrigger } from "@/components/search/SearchMobileTrigger";
import { OverviewAddButton } from "@/components/dashboard/OverviewAddButton";
import { SellerDetailsBanner } from "@/components/settings/SellerDetailsNotice";
import { TermsNoticeBanner } from "@/components/settings/TermsNoticeBanner";
import { getTermsStatus } from "@/lib/legal/terms-status";
import { LEGAL_SETTINGS_PATH } from "@/lib/legal/terms-versions";
import { AccountPlanProvider } from "@/components/billing/plan-context";
import { PlanStatusBanner } from "@/components/billing/PlanStatusBanner";
import {
  getAccessibleAccounts,
  getActiveAccount,
} from "@/lib/team/account-context";
import { getTraderIdentityStatus } from "@/lib/settings/seller-identity";
import { getProfile, getUser } from "@/lib/auth/session";
import { getAccountBilling } from "@/lib/billing/account-plan";
import { countOrdersToShip, getCarrierHabits } from "@/lib/orders/queries";
import { ORDERS_PATH } from "@/lib/dashboard/paths";
import { emailSendingEnabled } from "@/lib/email/send";
import { OrderMailProvider } from "@/components/orders/OrderMailProvider";
import { LastCarrierProvider } from "@/components/orders/LastCarrierProvider";
import { OrderRefundProvider } from "@/components/orders/OrderRefundProvider";
import { can } from "@/lib/team/permissions";
import { SkipLink } from "@/components/ui/SkipLink";

/** Where the seller-details banner stands down for owners: the setup checklist
 *  on Overview states the same gap as a step. */
const BANNER_HIDDEN_PATHS = ["/dashboard"] as const;

/** Where the Terms banner stands down: the page its link leads to, which shows
 *  the whole notice itself. */
const TERMS_BANNER_HIDDEN_PATHS = [LEGAL_SETTINGS_PATH] as const;

/** The element "Skip to main content" moves focus to. */
const MAIN_CONTENT_ID = "main-content";

/**
 * The active store's publish-gate status and plan, read together once its
 * account is known. No account (signed out mid-render) reads nothing.
 */
async function identityAndBillingFor(account: Awaited<ReturnType<typeof getActiveAccount>>) {
  if (!account) return [null, null] as const;
  return Promise.all([
    getTraderIdentityStatus(account.accountId),
    getAccountBilling(account.accountId),
  ]);
}

/**
 * The dashboard chrome: fixed left Sidebar + content offset by the rail width,
 * the notification bell, and the profile/account menu (which also holds the
 * multi-tenant store switcher). Resolves the active account + accessible stores
 * server-side so the switcher and the "viewing another store" banner stay
 * consistent everywhere the shell is used (the (dashboard) group + storefront
 * list).
 */
export async function DashboardShell({
  username,
  children,
}: {
  username: string;
  children: ReactNode;
}) {
  // getActiveAccount() is React-cached, so calling it twice returns the same
  // promise. The .then() below attaches to that shared promise so identity
  // and billing start the moment the account resolves, in parallel with the
  // other reads, rather than sequentially after the first batch completes.
  const [account, accounts, profile, user, toShipCount, terms, carrierHabits, identityAndBilling] =
    await Promise.all([
      getActiveAccount(),
      getAccessibleAccounts(),
      getProfile(),
      getUser(),
      // Cached per request, so the Orders page and the overview reuse it.
      countOrdersToShip(),
      getTermsStatus(),
      getCarrierHabits(),
      // The publish gate and plan banner both depend on the active account.
      // Starting them here (via .then on the cached getActiveAccount promise)
      // overlaps them with the reads above instead of sequencing after.
      //
      // Both reads are independent, so they run together (one round trip, not
      // two). A read failure shows nothing rather than a guessed value.
      getActiveAccount().then(identityAndBillingFor),
    ]);
  const [identity, billing] = identityAndBilling;
  const t = await getTranslations("Dashboard.shell");
  const tOrders = await getTranslations("Orders");
  // Parcels people have paid for and are waiting on, beside Orders on the
  // rail, from whichever page the seller is on.
  const navCounts = {
    [ORDERS_PATH]: { value: toShipCount, label: tOrders("toShipCount", { count: toShipCount }) },
  };

  const currentAccountId = account?.accountId ?? "";
  const email = user?.email ?? "";
  const name = profile?.username?.trim() || email.split("@")[0] || username;
  const avatarUrl = profile?.avatar_url ?? null;

  const viewingOther = account && !account.isOwner ? account : null;
  // The store's own name when it is known; the chrome falls back to words.
  const viewingStoreKnownName = viewingOther
    ? (accounts.find((a) => a.accountId === viewingOther.accountId)?.storeName ?? null)
    : null;
  const viewingStoreName = viewingOther ? (viewingStoreKnownName ?? t("anotherStore")) : null;
  const missingTraderDetails = identity?.ok ? identity.missing : [];
  const sellerDetailsBanner = (
    <SellerDetailsBanner
      missing={missingTraderDetails}
      audience={viewingOther ? "member" : "owner"}
      storeName={viewingStoreKnownName}
    />
  );

  // The ACTIVE store's plan: the rail's chip and the profile menu's row
  // describe the store being worked on, which for a teammate is the
  // owner's. A read failure shows no plan at all rather than a guessed one.
  const plan = billing?.ok ? billing.billing.plan : null;
  const pastDuePlan =
    billing?.ok && billing.billing.status === "past_due" && billing.billing.plan !== "free"
      ? billing.billing.plan
      : null;
  // Mobile: search + bell + profile menu ride in the Sidebar's mobile header,
  // after Overview's Add product for anyone who may add one.
  const mobileControls = (
    <div className="flex items-center gap-1">
      {can(account?.role, "products.write") && <OverviewAddButton />}
      <SearchMobileTrigger />
      <NotificationBell />
      <ProfileMenu
        name={name}
        email={email}
        avatarUrl={avatarUrl}
        accounts={accounts}
        currentAccountId={currentAccountId}
      />
    </div>
  );

  return (
    <NotificationsProvider userId={user?.id ?? ""}>
      {/* Universal search wraps the whole shell so ⌘K works from any page that
          wears it, and the palette renders above the sidebar and its drawer. */}
      <SearchProvider
        role={account?.role ?? null}
        accountId={account?.accountId ?? null}
      >
        {/* The store's plan, for the rail's chip and the profile menu. */}
        <AccountPlanProvider plan={plan}>
          <div className="min-h-screen bg-background">
            {/* First in the tab order, so it is the first thing a keyboard user
                can reach and skip the rail with. */}
            <SkipLink href={`#${MAIN_CONTENT_ID}`}>{t("skipToContent")}</SkipLink>
            <Sidebar topBarSlot={mobileControls} counts={navCounts} />
            <div className="md:pl-64">
              <TopBar
                accounts={accounts}
                currentAccountId={currentAccountId}
                name={name}
                email={email}
                avatarUrl={avatarUrl}
              />
              {viewingOther && viewingStoreName && (
                <ViewingBanner
                  storeName={viewingStoreName}
                  role={viewingOther.role}
                  ownAccountId={viewingOther.userId}
                />
              )}
              {/* Under the "viewing another store" banner, because which store
                  this is about has to be read first for the warning to mean
                  anything. */}
              {viewingOther ? (
                sellerDetailsBanner
              ) : (
                <HiddenOnPaths paths={BANNER_HIDDEN_PATHS}>
                  {sellerDetailsBanner}
                </HiddenOnPaths>
              )}
              <HiddenOnPaths paths={TERMS_BANNER_HIDDEN_PATHS}>
                <TermsNoticeBanner
                  upcoming={terms?.upcoming}
                  acceptedVersion={profile?.legal_accepted_version ?? null}
                />
              </HiddenOnPaths>
              <PlanStatusBanner pastDuePlan={pastDuePlan} audience={viewingOther ? "member" : "owner"} />
              {/* Where "Skip to main content" lands. A plain wrapper: each page
                  brings its own <main>, and this only has to take focus. */}
              <div id={MAIN_CONTENT_ID} tabIndex={-1} className="outline-none">
                <OrderMailProvider enabled={emailSendingEnabled()}>
                  <OrderRefundProvider allowed={can(account?.role, "orders.refund")} storeName={viewingStoreKnownName}>
                    <LastCarrierProvider storeId={currentAccountId} habits={carrierHabits}>
                      {children}
                    </LastCarrierProvider>
                  </OrderRefundProvider>
                </OrderMailProvider>
              </div>
            </div>
          </div>
          {/* The guided tour's layer. Inside SearchProvider so opening search can
              end it; rendered by every shell, so it is present on each page the
              tour walks through. */}
          <TourOverlay role={account?.role ?? null} />
        </AccountPlanProvider>
      </SearchProvider>
    </NotificationsProvider>
  );
}
