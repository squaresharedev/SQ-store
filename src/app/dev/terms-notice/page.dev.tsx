import { notFound } from "next/navigation";
import { getLocale } from "next-intl/server";
import { TermsChangeNotice } from "@/components/legal/TermsChangeNotice";
import { TermsNoticeBanner } from "@/components/settings/TermsNoticeBanner";
import { parseLocale, DEFAULT_LOCALE } from "@/i18n/locales";
import { buildTermsNotice } from "@/lib/legal/terms-notices";
import { LATEST_TERMS_VERSION, TERMS_VERSIONS } from "@/lib/legal/terms-versions";

/** Every state of a Terms notice: the banner, the Settings card and the email. */
export default async function TermsNoticeHarness() {
  if (process.env.NODE_ENV === "production") notFound();

  const older = TERMS_VERSIONS[0].version;
  const dated = { version: LATEST_TERMS_VERSION, effectiveAt: "2026-12-02T03:23:00Z" };
  const soon = { version: LATEST_TERMS_VERSION, effectiveAt: null };
  const email = await buildTermsNotice(
    parseLocale(await getLocale()) ?? DEFAULT_LOCALE,
    LATEST_TERMS_VERSION,
    dated.effectiveAt,
  );

  return (
    <main className="flex flex-col gap-6 pb-12">
      <div data-harness="banner-dated">
        <TermsNoticeBanner upcoming={dated} acceptedVersion={older} />
      </div>
      <div data-harness="banner-soon">
        <TermsNoticeBanner upcoming={soon} acceptedVersion={older} />
      </div>
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4">
        <TermsChangeNotice upcoming={dated} />
        <section className="border border-border p-4" data-harness="email">
          <p className="font-semibold">{email.subject}</p>
          <pre className="mt-3 whitespace-pre-wrap font-inter text-sm">{email.text}</pre>
        </section>
      </div>
    </main>
  );
}
