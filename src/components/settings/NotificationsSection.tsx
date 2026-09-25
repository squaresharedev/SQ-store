"use client";

import * as React from "react";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { useActionStateToast, useSaveResult } from "@/components/ui/ActionErrorNotice";
import { SaveButton } from "@/components/ui/SaveButton";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { Switch } from "@/components/ui/switch";
import {
  saveNotifications,
} from "@/lib/settings/actions";
import type { ActionState } from "@/lib/errors";

const INITIAL: ActionState = {};

/** Each preference's form field, and where its copy lives under Settings.notifications.prefs. */
const PREFS = [
  { name: "notify_sales", copy: "sales" },
  { name: "notify_product_updates", copy: "productUpdates" },
  { name: "notify_marketing", copy: "marketing" },
] as const;

type PrefName = (typeof PREFS)[number]["name"];

export function NotificationsSection({
  defaults,
}: {
  defaults: Record<PrefName, boolean>;
}) {
  const t = useTranslations("Settings.notifications");
  const [state, formAction, isPending] = useActionState(
    saveNotifications,
    INITIAL,
  );
  useActionStateToast(state);
  const saveResult = useSaveResult(state);
  const [prefs, setPrefs] = React.useState(defaults);

  return (
    <SettingsCard
      // Universal search's landing point for "sales emails", "newsletter", etc.
      id="preferences"
      title={t("cardTitle")}
      description={t("cardDescription")}
    >
      <form action={formAction} className="flex flex-col gap-4">
        <div className="flex flex-col divide-y divide-border">
          {PREFS.map((pref) => (
            <div
              key={pref.name}
              className="flex items-center justify-between gap-4 py-4 first:pt-0 last:pb-0 sm:gap-6"
            >
              <div className="min-w-0">
                <p
                  id={`${pref.name}-label`}
                  className="text-sm font-medium text-foreground"
                >
                  {t(`prefs.${pref.copy}.label`)}
                </p>
                <p className="mt-0.5 font-inter text-sm text-muted-foreground">
                  {t(`prefs.${pref.copy}.blurb`)}
                </p>
              </div>
              <Switch
                id={pref.name}
                aria-labelledby={`${pref.name}-label`}
                checked={prefs[pref.name]}
                onCheckedChange={(checked) =>
                  setPrefs((p) => ({ ...p, [pref.name]: checked }))
                }
              />
              {/* Carries the toggle's value in the form submission. */}
              <input
                type="hidden"
                name={pref.name}
                value={prefs[pref.name] ? "on" : "off"}
              />
            </div>
          ))}
        </div>
        <div>
          <SaveButton pending={isPending} state={saveResult} />
        </div>
      </form>
    </SettingsCard>
  );
}
