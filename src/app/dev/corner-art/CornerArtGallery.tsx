import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { ArrivingTeam } from "@/components/settings/corner-art/ArrivingTeam";
import { CodeReels } from "@/components/settings/corner-art/CodeReels";
import { PrintingReceipt } from "@/components/settings/corner-art/PrintingReceipt";
import { RingingBell } from "@/components/settings/corner-art/RingingBell";
import { WritingSignature } from "@/components/settings/corner-art/WritingSignature";
import { TransitFlow } from "@/components/ui/TransitFlow";
import { pageShellClass } from "@/components/ui/surface-styles";

function Fixture({ id, name, children }: { id: string; name: string; children: ReactNode }) {
  return (
    <section data-fixture={id} className="space-y-3">
      <h2 className="font-inter text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {name}
      </h2>
      {children}
    </section>
  );
}

/** Where the card's own fields would be. */
function Body() {
  return <div className="h-16 border border-dashed border-border" />;
}

export function CornerArtGallery() {
  const t = useTranslations("Settings");
  const tBilling = useTranslations("Billing.settings");
  return (
    <main className={`${pageShellClass} max-w-4xl space-y-12`}>
      <h1 className="text-2xl font-semibold text-foreground">Corner art</h1>

      <Fixture id="security" name="Security: two-factor (/settings/security)">
        <SettingsCard
          title={t("security.twoFactor.cardTitle")}
          description={t("security.twoFactor.descriptionOff")}
          art={<CodeReels />}
        >
          <Body />
        </SettingsCard>
      </Fixture>

      <Fixture id="notifications" name="Notifications (/settings/notifications)">
        <SettingsCard
          title={t("notifications.cardTitle")}
          description={t("notifications.cardDescription")}
          art={<RingingBell />}
        >
          <Body />
        </SettingsCard>
      </Fixture>

      <Fixture id="team" name="Team (/settings/team)">
        <SettingsCard
          title={t("team.cardTitle")}
          description={t("team.cardDescription")}
          art={<ArrivingTeam />}
        >
          <Body />
        </SettingsCard>
      </Fixture>

      <Fixture id="billing" name="Plan & billing (/settings/billing)">
        <SettingsCard
          title={tBilling("planTitle")}
          description={tBilling("planDescription")}
          art={<PrintingReceipt />}
        >
          <Body />
        </SettingsCard>
      </Fixture>

      <Fixture id="legal" name="Legal: terms (/settings/legal)">
        <SettingsCard
          title={t("legal.termsTitle")}
          description={t("legal.termsDescription")}
          art={<WritingSignature />}
        >
          <Body />
        </SettingsCard>
      </Fixture>

      <Fixture id="shipping" name="Shipping, for comparison (live on /settings/shipping)">
        <SettingsCard
          title={t("shipping.shippingCard.title")}
          description={t("shipping.shippingCard.description")}
          art={<TransitFlow />}
        >
          <Body />
        </SettingsCard>
      </Fixture>
    </main>
  );
}
