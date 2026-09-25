"use client";

import { useActionState, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, Plus, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useActionStateToast, useSaveResult } from "@/components/ui/ActionErrorNotice";
import { SaveButton } from "@/components/ui/SaveButton";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, type SelectOption } from "@/components/ui/select";
import { InfoTip } from "@/components/ui/InfoTip";
import { cn } from "@/lib/utils";
import {
  helpTextClass,
  iconButtonClass,
  iconNudgeRightClass,
  secondaryButtonClass,
} from "@/components/ui/control-styles";
import { saveShippingPolicy } from "@/lib/settings/shipping-actions";
import type { ActionState } from "@/lib/errors";
import { useEuCountries } from "@/components/settings/use-eu-countries";
import { buildShippingProse } from "@/lib/shipping/policy-prose";
import { useResolveMessage as useResolveProse } from "@/components/ui/ActionErrorNotice";
import {
  canAddShippingProfile,
  newShippingProfileId,
} from "@/lib/storefront/shipping";
import {
  DESTINATION_AREA_MAX,
  DESTINATION_COST_MAX,
  DESTINATION_TIME_MAX,
  RETURNS_WINDOW_DEFAULT_DAYS,
  RETURNS_WINDOW_MAX_DAYS,
  SHIPPING_DESTINATIONS_MAX,
  type SellerShippingPolicy,
  type ShippingDestination,
} from "@/types/shipping-policy";
import {
  POLICY_TEXT_MAX,
  SHIPPING_DISPATCH_MAX,
  SHIPPING_PROFILES_MAX,
  SHIPPING_PROFILE_NAME_MAX,
  type ShippingProfile,
} from "@/types/storefront";

const INITIAL: ActionState = {};

/**
 * The returns window as a small set of answers rather than a free number.
 *
 * 14 is the EU statutory minimum for distance selling and the right default;
 * 30 is what most sellers who advertise returns actually offer. "None beyond
 * the statutory right" is a REAL and common answer, not a failure to fill the
 * form in, so it is on the list rather than something you express by leaving a
 * field blank. "Custom" is the escape hatch for the rest.
 */
const WINDOW_CHOICES = ["0", "14", "30", "custom"] as const;

/**
 * SHIPPING & RETURNS, set once for the whole account.
 *
 * WHAT MOVED, AND WHY IT MOVED HERE. These terms used to be three textareas
 * and a profile list inside the storefront designer's side panel, stored per
 * storefront. A storefront is a presentation of one catalogue rather than a
 * separate business, so a seller with two of them retyped the same policy with
 * no second answer to give; and a design surface is the wrong place to be
 * writing legal text at all. Shopify, Etsy and Squarespace all put this in
 * settings. The designer keeps only the DISPLAY decision and a link here.
 *
 * STRUCTURED, BECAUSE BLANK TEXTAREAS DO NOT GET FILLED IN. The old shape
 * asked for prose and mostly got nothing. This asks for the four facts a buyer
 * wants and a seller already knows, and `buildShippingProse` turns them into
 * the paragraphs the product page prints — shown live below the fields, so
 * nobody has to save and go looking to find out what a buyer will read.
 *
 * ONE FORM, ONE SAVE, and the whole policy posts as a single JSON document
 * (see saveShippingPolicy for why). Everything here is controlled React state
 * for that reason: the document is built from state at submit time, so the
 * repeatable rows never have to survive a round trip through indexed field
 * names.
 */
export function ShippingSection({
  policy,
  continueHref,
}: {
  policy: SellerShippingPolicy;
  /** Where "Continue to your storefront" goes once terms are saved. Omitted
   *  when this form is embedded somewhere that isn't the settings page (e.g.
   *  the product form's shipping modal) — there is nowhere sensible for that
   *  link to go, so it is left out entirely rather than shown and disabled. */
  continueHref?: string;
}) {
  const t = useTranslations("Settings");
  const { countries } = useEuCountries();
  const fromOptions: readonly SelectOption<string>[] = useMemo(
    () => [
      { value: "", label: t("shipping.shipsFrom.notSet") },
      ...countries.map((country) => ({ value: country.code, label: country.name })),
    ],
    [countries, t],
  );
  const windowOptions: readonly SelectOption<string>[] = useMemo(
    () =>
      WINDOW_CHOICES.map((value) => {
        if (value === "0") return { value, label: t("shipping.returnsWindow.none") };
        if (value === "custom") return { value, label: t("shipping.returnsWindow.custom") };
        const days = Number(value);
        return days === 14
          ? {
              value,
              label: t("shipping.returnsWindow.days", { days }),
              description: t("shipping.returnsWindow.statutoryMinimum"),
            }
          : { value, label: t("shipping.returnsWindow.days", { days }) };
      }),
    [t],
  );
  const paidByOptions: readonly SelectOption<string>[] = useMemo(
    () => [
      { value: "buyer", label: t("shipping.returnsPaidBy.buyer") },
      { value: "seller", label: t("shipping.returnsPaidBy.seller") },
    ],
    [t],
  );
  const [state, formAction, isPending] = useActionState(saveShippingPolicy, INITIAL);
  useActionStateToast(state);
  const saveResult = useSaveResult(state);

  // Shown once a save lands, not just while SaveButton's own green flash is up
  // (that fades after a couple of seconds; the seller still needs a next step
  // after it does). Clears on the next submit's pending tick, and comes back
  // if that submit also succeeds.
  const justSaved = !isPending && Boolean(state.success);

  const [shipsFrom, setShipsFrom] = useState(policy.shipsFrom ?? "");
  const [dispatch, setDispatch] = useState(policy.dispatch ?? "");
  const [destinations, setDestinations] = useState<ShippingDestination[]>(
    policy.destinations ?? [],
  );
  const [shippingNotes, setShippingNotes] = useState(policy.shippingNotes ?? "");
  const [shippingText, setShippingText] = useState(policy.shippingText ?? "");

  const storedDays = policy.returnsWindowDays;
  // A SELLER WHO HAS SET NOTHING CLAIMS NOTHING. Defaulting this to 14 (the
  // statutory figure, and the tempting default) would have a brand-new account
  // publishing "Returns accepted within 14 days. Return postage is paid by the
  // buyer." on every product page before anyone had chosen it — putting words,
  // and a real claim about who pays, into a seller's mouth. Silence is the only
  // safe default for legal text, and the buyer's statutory right is stated by
  // the page regardless. RETURNS_WINDOW_DEFAULT_DAYS is what the OPTION LIST
  // recommends once the seller is actually answering the question.
  const [windowChoice, setWindowChoice] = useState(() => {
    if (storedDays === undefined) return "0";
    return storedDays === 0 || storedDays === RETURNS_WINDOW_DEFAULT_DAYS || storedDays === 30
      ? String(storedDays)
      : "custom";
  });
  const [customDays, setCustomDays] = useState(
    storedDays !== undefined && storedDays !== 0 && storedDays !== 14 && storedDays !== 30
      ? String(storedDays)
      : "",
  );
  const [paidBy, setPaidBy] = useState(policy.returnsPaidBy ?? "buyer");
  const [returnsNotes, setReturnsNotes] = useState(policy.returnsNotes ?? "");
  const [returnsText, setReturnsText] = useState(policy.returnsText ?? "");

  const [profiles, setProfiles] = useState<ShippingProfile[]>(policy.profiles ?? []);

  // The number the policy actually carries. A custom box mid-edit ("" or junk)
  // reads as undefined rather than 0: "not a number yet" is not the same
  // answer as "no returns", and treating it as the latter would quietly change
  // what the page says while someone is still typing.
  const returnsWindowDays = useMemo(() => {
    if (windowChoice !== "custom") return Number(windowChoice);
    const parsed = parseInt(customDays, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
  }, [windowChoice, customDays]);

  const draft: SellerShippingPolicy = useMemo(
    () => ({
      shipsFrom,
      dispatch,
      destinations,
      shippingNotes,
      shippingText,
      ...(returnsWindowDays === undefined ? {} : { returnsWindowDays }),
      returnsPaidBy: paidBy as SellerShippingPolicy["returnsPaidBy"],
      returnsNotes,
      returnsText,
      profiles,
    }),
    [
      shipsFrom,
      dispatch,
      destinations,
      shippingNotes,
      shippingText,
      returnsWindowDays,
      paidBy,
      returnsNotes,
      returnsText,
      profiles,
    ],
  );

  // What buyers will read, in the language this seller is reading in.
  const resolveProse = useResolveProse();
  const locale = useLocale();
  const preview = useMemo(
    () => buildShippingProse(draft, resolveProse, locale),
    [draft, resolveProse, locale],
  );

  function setDestination(index: number, patch: Partial<ShippingDestination>) {
    setDestinations((current) =>
      current.map((row, position) => (position === index ? { ...row, ...patch } : row)),
    );
  }

  function setProfile(index: number, patch: Partial<ShippingProfile>) {
    setProfiles((current) =>
      current.map((row, position) => (position === index ? { ...row, ...patch } : row)),
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-6" noValidate>
      {/* The whole policy, as one document. See saveShippingPolicy: the two
          repeatable lists are what make indexed field names the wrong shape
          here, and the strict schema on the other side is a tighter boundary
          than thirty named inputs would be. */}
      <input type="hidden" name="policy" value={JSON.stringify(draft)} />

      <SettingsCard
        id="shipping"
        title={t("shipping.shippingCard.title")}
        description={t("shipping.shippingCard.description")}
        decoration="grid"
      >
        <div className="flex flex-col gap-4 [&>div]:scroll-mt-20">
          <div id="ships-from" className="flex flex-col gap-1.5">
            <Label htmlFor="ships_from">{t("shipping.shipsFrom.label")}</Label>
            <Select
              id="ships_from"
              value={shipsFrom}
              options={fromOptions}
              onChange={setShipsFrom}
              disabled={isPending}
            />
          </div>

          <div id="dispatch-time" className="flex flex-col gap-1.5">
            <span className="flex items-center gap-1.5">
              <Label htmlFor="dispatch">{t("shipping.dispatch.label")}</Label>
              <InfoTip label={t("shipping.dispatch.tipLabel")}>
                {t("shipping.dispatch.tipBody")}
              </InfoTip>
            </span>
            <Input
              id="dispatch"
              value={dispatch}
              onChange={(event) => setDispatch(event.target.value)}
              placeholder={t("shipping.dispatch.placeholder")}
              maxLength={SHIPPING_DISPATCH_MAX}
            />
          </div>

          {/* WHERE AND HOW LONG, as rows rather than a paragraph. This is the
              part sellers reliably know and reliably never write down, and it
              is the part buyers scan for. Times are words, not numbers:
              sellers do not agree on whether the count includes dispatch, and
              a number field would make the page state something they did not
              mean. */}
          <div id="destinations" className="flex flex-col gap-2">
            <span className="flex items-center gap-1.5">
              <Label>{t("shipping.destinations.label")}</Label>
              <InfoTip label={t("shipping.destinations.tipLabel")}>
                {t("shipping.destinations.tipBody")}
              </InfoTip>
            </span>
            {destinations.length === 0 ? (
              <p className={helpTextClass}>{t("shipping.destinations.empty")}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {destinations.map((row, index) => (
                  <li key={index} className="flex items-start gap-2">
                    <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[1fr_1fr_0.6fr]">
                      <Input
                        aria-label={t("shipping.destinations.areaLabel", { number: index + 1 })}
                        value={row.area}
                        onChange={(event) => setDestination(index, { area: event.target.value })}
                        placeholder={t("shipping.destinations.areaPlaceholder")}
                        maxLength={DESTINATION_AREA_MAX}
                      />
                      <Input
                        aria-label={t("shipping.destinations.timeLabel", { number: index + 1 })}
                        value={row.time}
                        onChange={(event) => setDestination(index, { time: event.target.value })}
                        placeholder={t("shipping.destinations.timePlaceholder")}
                        maxLength={DESTINATION_TIME_MAX}
                      />
                      <Input
                        aria-label={t("shipping.destinations.costLabel", { number: index + 1 })}
                        value={row.cost ?? ""}
                        onChange={(event) => setDestination(index, { cost: event.target.value })}
                        placeholder={t("shipping.destinations.costPlaceholder")}
                        maxLength={DESTINATION_COST_MAX}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setDestinations((current) =>
                          current.filter((_, position) => position !== index),
                        )
                      }
                      aria-label={
                        row.area.trim()
                          ? t("shipping.destinations.removeNamed", { area: row.area.trim() })
                          : t("shipping.destinations.removeNumbered", { number: index + 1 })
                      }
                      className={cn(iconButtonClass, "shrink-0")}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {destinations.length < SHIPPING_DESTINATIONS_MAX ? (
              <button
                type="button"
                onClick={() =>
                  setDestinations((current) => [...current, { area: "", time: "" }])
                }
                className={cn(secondaryButtonClass, "w-fit")}
              >
                <Plus className="size-4" aria-hidden="true" />
                {t("shipping.destinations.add")}
              </button>
            ) : (
              <p className={helpTextClass}>
                {t("shipping.destinations.limitReached", { max: SHIPPING_DESTINATIONS_MAX })}
              </p>
            )}
          </div>

          <div id="shipping-notes" className="flex flex-col gap-1.5">
            <Label htmlFor="shipping_notes">{t("shipping.notes.label")}</Label>
            <Textarea
              id="shipping_notes"
              value={shippingNotes}
              onChange={(event) => setShippingNotes(event.target.value)}
              rows={3}
              placeholder={t("shipping.notes.placeholder")}
              maxLength={POLICY_TEXT_MAX}
            />
          </div>
        </div>
      </SettingsCard>

      <SettingsCard
        id="returns"
        title={t("shipping.returnsCard.title")}
        description={t("shipping.returnsCard.description")}
      >
        <div className="flex flex-col gap-4 [&>div]:scroll-mt-20">
          <div id="returns-window" className="flex flex-col gap-1.5">
            <span className="flex items-center gap-1.5">
              <Label htmlFor="returns_window">{t("shipping.returnsWindow.label")}</Label>
              <InfoTip label={t("shipping.returnsWindow.tipLabel")}>
                {t("shipping.returnsWindow.tipBody")}
              </InfoTip>
            </span>
            <Select
              id="returns_window"
              value={windowChoice}
              options={windowOptions}
              onChange={setWindowChoice}
              disabled={isPending}
            />
            {windowChoice === "custom" && (
              <div className="mt-2 flex items-center gap-2 sm:max-w-40">
                <Input
                  aria-label={t("shipping.returnsWindow.customLabel")}
                  value={customDays}
                  onChange={(event) => setCustomDays(event.target.value.replace(/[^0-9]/g, ""))}
                  inputMode="numeric"
                  placeholder="60"
                  maxLength={String(RETURNS_WINDOW_MAX_DAYS).length}
                  // Extra-faint on top of the field's own placeholder colour:
                  // "60" is too plausible a default to read as a real value at
                  // normal placeholder contrast (a seller mistook a similarly
                  // styled example price for a real one elsewhere in the app).
                  className="flex-1 placeholder:text-muted-foreground/50"
                />
                <span className="text-sm text-muted-foreground">
                  {t("shipping.returnsWindow.daysUnit")}
                </span>
              </div>
            )}
          </div>

          {/* Only asked once a window exists: who pays the postage back for a
              window nobody has is not a fact about anything, and the save
              drops it for the same reason. */}
          {returnsWindowDays !== undefined && returnsWindowDays > 0 && (
            <div id="returns-postage" className="flex flex-col gap-1.5">
              <Label htmlFor="returns_paid_by">{t("shipping.returnsPaidBy.label")}</Label>
              <Select
                id="returns_paid_by"
                value={paidBy}
                options={paidByOptions}
                onChange={(value) => setPaidBy(value as "buyer" | "seller")}
                disabled={isPending}
              />
            </div>
          )}

          <div id="returns-notes" className="flex flex-col gap-1.5">
            <span className="flex items-center gap-1.5">
              <Label htmlFor="returns_notes">{t("shipping.exceptions.label")}</Label>
              <InfoTip label={t("shipping.exceptions.tipLabel")}>
                {t("shipping.exceptions.tipBody")}
              </InfoTip>
            </span>
            <Textarea
              id="returns_notes"
              value={returnsNotes}
              onChange={(event) => setReturnsNotes(event.target.value)}
              rows={3}
              placeholder={t("shipping.exceptions.placeholder")}
              maxLength={POLICY_TEXT_MAX}
            />
          </div>
        </div>
      </SettingsCard>

      {/* WHAT BUYERS WILL READ, from the same generator the page uses. The
          point of a structured form is that nobody has to imagine the output,
          and the point of showing it HERE is that a seller can see the moment
          their answers stop saying anything useful. */}
      <SettingsCard
        id="preview"
        title={t("shipping.preview.title")}
        description={t("shipping.preview.description")}
      >
        {preview.shipping || preview.returns ? (
          <div className="flex flex-col gap-4">
            {preview.shipping && (
              <div>
                <h3 className="font-inter text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("shipping.preview.shippingHeading")}
                </h3>
                <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-foreground">
                  {preview.shipping}
                </p>
              </div>
            )}
            {preview.returns && (
              <div>
                <h3 className="font-inter text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("shipping.preview.returnsHeading")}
                </h3>
                <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-foreground">
                  {preview.returns}
                </p>
              </div>
            )}
          </div>
        ) : (
          <p className={helpTextClass}>{t("shipping.preview.empty")}</p>
        )}
      </SettingsCard>

      {/* THE ESCAPE HATCH, last and collapsed into its own card rather than
          sitting beside the fields it overrides. A seller who wants their own
          words gets exactly those words (the generator steps aside entirely),
          but putting the textarea next to the structured fields would make it
          look like the normal way through, which is how the old form ended up
          being three empty boxes nobody filled in. */}
      <SettingsCard
        id="own-words"
        title={t("shipping.ownWords.title")}
        description={t("shipping.ownWords.description")}
      >
        <div className="flex flex-col gap-4 [&>div]:scroll-mt-20">
          <div id="shipping-text" className="flex flex-col gap-1.5">
            <Label htmlFor="shipping_text">{t("shipping.ownWords.shippingLabel")}</Label>
            <Textarea
              id="shipping_text"
              value={shippingText}
              onChange={(event) => setShippingText(event.target.value)}
              rows={4}
              placeholder={t("shipping.ownWords.placeholder")}
              maxLength={POLICY_TEXT_MAX}
            />
          </div>
          <div id="returns-text" className="flex flex-col gap-1.5">
            <Label htmlFor="returns_text">{t("shipping.ownWords.returnsLabel")}</Label>
            <Textarea
              id="returns_text"
              value={returnsText}
              onChange={(event) => setReturnsText(event.target.value)}
              rows={4}
              placeholder={t("shipping.ownWords.placeholder")}
              maxLength={POLICY_TEXT_MAX}
            />
          </div>
        </div>
      </SettingsCard>

      {/* THE EXCEPTIONS, and only the exceptions. Shipping reads the same for
          nearly everything a seller lists, so the terms above are the answer
          for nearly every product and no product form should ask again. What a
          catalogue does need is somewhere to put the handful that ship
          differently, and that is a NAMED set of terms a product points at,
          never prose retyped on the product. Deliberately still free text: an
          exception is a sentence, not a structure worth five fields. */}
      <SettingsCard
        id="profiles"
        title={t("shipping.profiles.title")}
        description={t("shipping.profiles.description")}
      >
        <div className="flex flex-col gap-3">
          {profiles.length === 0 ? (
            <p className={helpTextClass}>{t("shipping.profiles.empty")}</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {profiles.map((profile, index) => (
                <li
                  key={profile.id}
                  className="flex flex-col gap-2 border border-border p-3"
                  data-shipping-profile={profile.id}
                >
                  <div className="flex items-start gap-2">
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                      <Label htmlFor={`profile-name-${profile.id}`}>
                        {t("shipping.profiles.nameLabel")}
                      </Label>
                      <Input
                        id={`profile-name-${profile.id}`}
                        value={profile.name}
                        onChange={(event) => setProfile(index, { name: event.target.value })}
                        placeholder={t("shipping.profiles.namePlaceholder")}
                        maxLength={SHIPPING_PROFILE_NAME_MAX}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setProfiles((current) =>
                          current.filter((_, position) => position !== index),
                        )
                      }
                      aria-label={
                        profile.name.trim()
                          ? t("shipping.profiles.removeNamed", { name: profile.name.trim() })
                          : t("shipping.profiles.removeUnnamed")
                      }
                      className={cn(iconButtonClass, "mt-7 shrink-0")}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </button>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`profile-dispatch-${profile.id}`}>
                      {t("shipping.profiles.dispatchLabel")}
                    </Label>
                    <Input
                      id={`profile-dispatch-${profile.id}`}
                      value={profile.dispatch ?? ""}
                      onChange={(event) => setProfile(index, { dispatch: event.target.value })}
                      placeholder={t("shipping.profiles.dispatchPlaceholder")}
                      maxLength={SHIPPING_DISPATCH_MAX}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`profile-body-${profile.id}`}>
                      {t("shipping.profiles.bodyLabel")}
                    </Label>
                    <Textarea
                      id={`profile-body-${profile.id}`}
                      value={profile.body}
                      onChange={(event) => setProfile(index, { body: event.target.value })}
                      rows={3}
                      placeholder={t("shipping.profiles.bodyPlaceholder")}
                      maxLength={POLICY_TEXT_MAX}
                    />
                    {/* A profile with no terms is dropped on save rather than
                        stored as a name pointing at nothing, so this says so
                        before the seller finds out by saving. */}
                    {profile.body.trim() === "" && (
                      <p className={helpTextClass}>{t("shipping.profiles.noTerms")}</p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {canAddShippingProfile(profiles) ? (
            <button
              type="button"
              onClick={() =>
                setProfiles((current) => [
                  ...current,
                  { id: newShippingProfileId(), name: "", body: "" },
                ])
              }
              className={cn(secondaryButtonClass, "w-fit")}
            >
              <Plus className="size-4" aria-hidden="true" />
              {t("shipping.profiles.add")}
            </button>
          ) : (
            <p className={helpTextClass}>
              {t("shipping.profiles.limitReached", { max: SHIPPING_PROFILES_MAX })}
            </p>
          )}
        </div>
      </SettingsCard>

      <div className="flex flex-wrap items-center gap-3">
        <SaveButton pending={isPending} state={saveResult} />
        {/* THE NEXT STEP, not just the confirmation. SaveButton already says
            "saved"; a seller who came here to set shipping terms still needs
            to be told where to go next rather than left on a settings page
            wondering. Persists past SaveButton's own flash so the answer
            doesn't vanish before it's used. */}
        {justSaved && continueHref && (
          <Link href={continueHref} className={cn(secondaryButtonClass, "w-fit")}>
            {t("continueToStorefront")}
            <ArrowRight
              className={cn("size-4", iconNudgeRightClass)}
              strokeWidth={2}
              aria-hidden
            />
          </Link>
        )}
      </div>
    </form>
  );
}
