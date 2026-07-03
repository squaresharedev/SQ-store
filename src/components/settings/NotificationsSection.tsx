"use client";

import * as React from "react";
import { useActionState } from "react";
import { FormStatus } from "@/components/settings/FormStatus";
import { SaveButton } from "@/components/settings/SaveButton";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { Switch } from "@/components/ui/switch";
import {
  saveNotifications,
  type SettingsActionState,
} from "@/lib/settings/actions";

const INITIAL: SettingsActionState = {};

const PREFS = [
  {
    name: "notify_sales",
    label: "Sales",
    blurb: "Email me every time something sells. The good kind of inbox noise.",
  },
  {
    name: "notify_product_updates",
    label: "Product updates",
    blurb: "New dashboard features and improvements, as soon as they're ready to ship.",
  },
  {
    name: "notify_marketing",
    label: "Tips & marketplace news",
    blurb: "Occasional ideas to help you sell more. We keep it light, no spam.",
  },
] as const;

type PrefName = (typeof PREFS)[number]["name"];

export function NotificationsSection({
  defaults,
}: {
  defaults: Record<PrefName, boolean>;
}) {
  const [state, formAction, isPending] = useActionState(
    saveNotifications,
    INITIAL,
  );
  const [prefs, setPrefs] = React.useState(defaults);

  return (
    <SettingsCard
      title="Email notifications"
      description="Pick what lands in your inbox. Security and payment emails sneak through regardless, we can't let those go quiet."
    >
      <form action={formAction} className="flex flex-col gap-4">
        <div className="flex flex-col divide-y divide-neutral-200">
          {PREFS.map((pref) => (
            <div
              key={pref.name}
              className="flex items-center justify-between gap-4 py-4 first:pt-0 last:pb-0 sm:gap-6"
            >
              <div className="min-w-0">
                <p
                  id={`${pref.name}-label`}
                  className="text-sm font-medium text-neutral-900"
                >
                  {pref.label}
                </p>
                <p className="mt-0.5 font-inter text-sm text-neutral-500">
                  {pref.blurb}
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
        <FormStatus state={state} />
        <div>
          <SaveButton pending={isPending} state={state} />
        </div>
      </form>
    </SettingsCard>
  );
}
