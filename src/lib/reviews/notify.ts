// SERVER ONLY. Telling a seller a buyer reviewed one of their products.
//
// Called once per review, when the automatic check settles it
// (lib/reviews/moderation.ts): a passed review is news, a held one is a
// decision waiting on them, a blocked one is neither and is not announced.
//
// Same shape as a new order (lib/orders/record.ts tellSeller): the bell row is
// always written, it is the one the seller cannot miss; the email is theirs to
// switch off (Settings › Notifications, profiles.notify_reviews). Never
// throws: a notification problem must not undo a recorded review.

import { createAdminClient } from "@/lib/supabase/admin";
import { createNotification } from "@/lib/notifications/create";
import { sendEmail } from "@/lib/email/send";
import { appUrl } from "@/lib/app-url";
import { signInPath } from "@/lib/auth/paths";
import { translatorFor } from "@/i18n/translator";
import { DEFAULT_LOCALE, parseLocale } from "@/i18n/locales";
import { REVIEWS_PATH, reviewsFilterPath } from "@/lib/reviews/paths";

export type NewReviewNotice = {
  reviewId: string;
  productId: string;
  sellerId: string;
  rating: number;
  /** The check was unsure: the review waits for the seller to publish it. */
  held: boolean;
};

export async function notifyNewReview(notice: NewReviewNotice): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data: product } = await admin.from("products").select("title").eq("id", notice.productId).maybeSingle();
    const title = product?.title ?? "";
    const href = notice.held ? reviewsFilterPath("held") : REVIEWS_PATH;

    await createNotification({
      userId: notice.sellerId,
      type: "review",
      message: notice.held
        ? {
            title: { key: "Notifications.messages.review.held.title", values: { title } },
            body: { key: "Notifications.messages.review.held.body" },
          }
        : {
            title: { key: "Notifications.messages.review.new.title", values: { rating: notice.rating, title } },
            body: { key: "Notifications.messages.review.new.body" },
          },
      data: { href, reviewId: notice.reviewId },
    });

    const [{ data: profile }, { data: user }] = await Promise.all([
      admin.from("profiles").select("notify_reviews, locale").eq("id", notice.sellerId).maybeSingle(),
      admin.auth.admin.getUserById(notice.sellerId),
    ]);
    // Review emails are on unless the seller turned them off.
    if (profile?.notify_reviews === false) return;
    const to = user?.user?.email;
    if (!to) return;

    const t = await translatorFor(parseLocale(profile?.locale) ?? DEFAULT_LOCALE);
    const variant = notice.held ? "held" : "new";
    const result = await sendEmail({
      to,
      subject: t(`Products.reviewModeration.email.${variant}.subject`, { rating: notice.rating, title }),
      text: [
        t(`Products.reviewModeration.email.${variant}.intro`, { rating: notice.rating, title }),
        "",
        // Through sign-in, so a signed-out seller lands on the page after it.
        t("Products.reviewModeration.email.open", { url: appUrl(signInPath(href)) }),
        "",
        t("Products.reviewModeration.email.settings"),
        "",
        t("Orders.email.signOff"),
      ].join("\n"),
    });
    if (!result.sent && result.reason === "failed") {
      console.error("[reviews] review email failed:", result.detail);
    }
  } catch (error) {
    console.error("[reviews] could not tell the seller about a review:", error instanceof Error ? error.message : error);
  }
}
