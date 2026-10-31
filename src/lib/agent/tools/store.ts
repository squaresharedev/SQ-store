import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { READ, WRITE, defineTool, formDataFrom, unwrapState, ToolFailure } from "@/lib/agent/tool";
import { fileFromImageInput, imageInputShape } from "@/lib/agent/image-input";
import { appUrl } from "@/lib/app-url";
import { getProfile } from "@/lib/auth/session";
import { PLAN_IDS } from "@/lib/billing/plans";
import { planPrice } from "@/lib/billing/fees";
import { getAccountBilling } from "@/lib/billing/account-plan";
import { readPlanPrices } from "@/lib/billing/catalog";
import { getExistingProductIds, getProductsSummary } from "@/lib/dashboard/queries";
import { invalidInput, serverError } from "@/lib/errors";
import { msg, type MessageRef } from "@/i18n/types";
import { buildSetupSteps } from "@/lib/onboarding/steps";
import { removeAvatar, uploadAvatar } from "@/lib/settings/avatar";
import { saveNotifications, updateBio, updateUsername } from "@/lib/settings/actions";
import { getTraderIdentityStatus } from "@/lib/settings/seller-identity";
import { listStorefronts } from "@/lib/storefront/queries";
import { getTeamRoster } from "@/lib/team/queries";

/** The store and the person: what is true, what is left to do. */

/** Form actions that act on the person's own profile, not on the store. */
const NOTHING = z.strictObject({});

export const storeTools = [
  defineTool({
    name: "get_store",
    title: "Get store overview",
    description:
      "Start here. The store this connection acts on, your role on it, its plan, and for the owner the setup checklist. " +
      "traderIdentityMissing lists what EU law requires before anything can go on sale. Those details can only be filled in by the seller, in the settings page each step links to, so report them and do not try to work around them. " +
      "A contact email or phone also has to be proven by a code sent to the seller. Never ask the seller for that code: it proves the person reads that inbox.",
    scope: "store:read",
    permission: "store.read",
    annotations: READ,
    input: NOTHING,
    handler: async (_input, { account }) => {
      const t = await getTranslations();
      const text = (ref: MessageRef) => t(ref.key, ref.values);
      const [billing, identity] = await Promise.all([
        getAccountBilling(account.accountId),
        getTraderIdentityStatus(account.accountId),
      ]);

      let setup = null;
      if (account.isOwner && identity.ok) {
        const [products, storefronts] = await Promise.all([getProductsSummary(), listStorefronts()]);
        const referenced = storefronts.rows.flatMap((storefront) =>
          storefront.config.blocks.flatMap((block) => (block.type === "product" ? [block.productId] : [])),
        );
        const checklist = buildSetupSteps({
          traderMissing: identity.missing,
          productCount: products.total,
          activeProductIds: products.activeProductIds,
          checkingProductIds: products.checkingProductIds,
          pausedProductIds: products.pausedProductIds,
          existingProductIds: await getExistingProductIds(referenced),
          storefronts: storefronts.rows,
        });
        setup = {
          complete: checklist.complete,
          steps: checklist.steps.map((step) => ({
            id: step.id,
            done: step.done,
            label: text(step.label),
            detail: text(step.detail),
            ...(step.action ? { url: appUrl(step.action.href) } : {}),
          })),
          livePageUrl: checklist.livePage ? appUrl(checklist.livePage.path) : null,
        };
      }

      return {
        accountId: account.accountId,
        role: account.role,
        isOwnStore: account.isOwner,
        plan: billing.ok ? billing.billing.plan : null,
        planPaidUntil: billing.ok ? billing.billing.paidUntil : null,
        traderIdentityMissing: identity.ok ? identity.missing : null,
        setup,
      };
    },
  }),

  defineTool({
    name: "get_profile",
    title: "Get your profile",
    description: "The connected person's own profile: username, bio, and which notifications they receive.",
    scope: "store:read",
    permission: "store.read",
    annotations: READ,
    input: NOTHING,
    handler: async () => {
      const profile = await getProfile();
      if (!profile) throw new ToolFailure(serverError("agentTools"));
      return {
        id: profile.id,
        username: profile.username,
        bio: profile.seller_bio,
        avatarUrl: profile.avatar_url,
        notifySales: profile.notify_sales,
        notifyReviews: profile.notify_reviews,
        notifyProductUpdates: profile.notify_product_updates,
        notifyMarketing: profile.notify_marketing,
      };
    },
  }),

  defineTool({
    name: "list_team",
    title: "List team members",
    description:
      "Who has access to this store and with which role, including pending invites. Read only: inviting, changing a role and removing someone need a fresh two-factor check, so the seller does those in Settings > Team.",
    scope: "store:read",
    permission: "team.read",
    annotations: READ,
    input: NOTHING,
    handler: async (_input, { account }) => {
      const rows = await getTeamRoster(account.accountId);
      return {
        members: rows.map((row) => ({
          id: row.id,
          email: row.invited_email,
          username: row.username,
          role: row.role,
          status: row.status,
          invitedAt: row.invited_at,
          acceptedAt: row.accepted_at,
        })),
        manageUrl: appUrl("/settings/team"),
      };
    },
  }),

  defineTool({
    name: "list_plan_prices",
    title: "List plan prices",
    description:
      "What each Square Share plan costs per month and its fee per direct sale in basis points (300 = 3%). Changing a plan is the owner's decision and happens on the plans page, so link them there.",
    scope: "store:read",
    permission: "store.read",
    annotations: READ,
    input: NOTHING,
    handler: async () => {
      const prices = await readPlanPrices();
      if (!prices) throw new ToolFailure(serverError("agentTools"));
      return {
        plans: PLAN_IDS.map((plan) => {
          const price = planPrice(prices, plan, "month");
          return { id: plan, monthlyPriceCents: price.priceCents, directFeeBps: price.directFeeBps };
        }),
        plansUrl: appUrl("/plans"),
      };
    },
  }),

  defineTool({
    name: "update_username",
    title: "Change your username",
    description: "Change the connected person's public username. 3 to 30 letters, digits or underscores.",
    scope: "profile:write",
    permission: "store.read",
    ownerOnly: true,
    annotations: WRITE,
    input: z.strictObject({ username: z.string().max(30) }),
    handler: async ({ username }) => unwrapState(await updateUsername({}, formDataFrom({ username }))),
  }),

  defineTool({
    name: "update_bio",
    title: "Change your seller bio",
    description: "The one line shown beside the seller on product pages. At most 100 characters. Empty clears it.",
    scope: "profile:write",
    permission: "store.read",
    ownerOnly: true,
    annotations: WRITE,
    input: z.strictObject({ bio: z.string().max(100) }),
    handler: async ({ bio }) => unwrapState(await updateBio({}, formDataFrom({ seller_bio: bio }))),
  }),

  defineTool({
    name: "save_notification_settings",
    title: "Save notification settings",
    description: "Which emails the connected person receives. Send all four: anything left out is turned off.",
    scope: "profile:write",
    permission: "store.read",
    ownerOnly: true,
    annotations: WRITE,
    input: z.strictObject({
      notifySales: z.boolean(),
      notifyReviews: z.boolean(),
      notifyProductUpdates: z.boolean(),
      notifyMarketing: z.boolean(),
    }),
    handler: async (input) =>
      unwrapState(
        await saveNotifications(
          {},
          formDataFrom({
            notify_sales: input.notifySales,
            notify_reviews: input.notifyReviews,
            notify_product_updates: input.notifyProductUpdates,
            notify_marketing: input.notifyMarketing,
          }),
        ),
      ),
  }),

  defineTool({
    name: "set_avatar",
    title: "Set your profile photo",
    description: "Set the connected person's profile photo from an HTTPS URL or base64 data. JPEG, PNG or WebP, at most 2 MB.",
    scope: "profile:write",
    permission: "store.read",
    ownerOnly: true,
    annotations: { ...WRITE, openWorldHint: true },
    input: z.strictObject(imageInputShape),
    handler: async (input) => {
      const file = await fileFromImageInput(input, 2 * 1024 * 1024);
      if (!file) throw new ToolFailure(invalidInput(msg("Errors.agent.imageUnreadable"), msg("Errors.agent.imageUnreadableFix")));
      return unwrapState(await uploadAvatar({}, formDataFrom({ avatar: file })));
    },
  }),

  defineTool({
    name: "remove_avatar",
    title: "Remove your profile photo",
    description: "Remove the connected person's profile photo.",
    scope: "profile:write",
    permission: "store.read",
    ownerOnly: true,
    annotations: WRITE,
    input: NOTHING,
    handler: async () => unwrapState(await removeAvatar({}, new FormData())),
  }),
];
