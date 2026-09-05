"use client";

import { useActionState, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useActionToast } from "@/components/ui/Toast";
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
  secondaryButtonClass,
} from "@/components/ui/control-styles";
import { saveShippingPolicy } from "@/lib/settings/shipping-actions";
import type { SettingsActionState } from "@/lib/settings/actions";
import { EU_COUNTRIES } from "@/lib/settings/constants";
import { buildShippingProse } from "@/lib/shipping/policy-prose";
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

const INITIAL: SettingsActionState = {};

const FROM_OPTIONS: readonly SelectOption<string>[] = [
  { value: "", label: "Not set" },
  ...EU_COUNTRIES.map((country) => ({ value: country.code, label: country.name })),
];

/**
 * The returns window as a small set of answers rather than a free number.
 *
 * 14 is the EU statutory minimum for distance selling and the right default;
 * 30 is what most sellers who advertise returns actually offer. "None beyond
 * the statutory right" is a REAL and common answer, not a failure to fill the
 * form in, so it is on the list rather than something you express by leaving a
 * field blank. "Custom" is the escape hatch for the rest.
 */
const WINDOW_OPTIONS: readonly SelectOption<string>[] = [
  { value: "0", label: "None beyond the statutory right" },
  { value: "14", label: "14 days", description: "The EU statutory minimum" },
  { value: "30", label: "30 days" },
  { value: "custom", label: "Something else" },
];

const PAID_BY_OPTIONS: readonly SelectOption<string>[] = [
  { value: "buyer", label: "The buyer pays return postage" },
  { value: "seller", label: "We pay return postage" },
];

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
export function ShippingSection({ policy }: { policy: SellerShippingPolicy }) {
  const [state, formAction, isPending] = useActionState(saveShippingPolicy, INITIAL);
  useActionToast(state);

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

  const preview = useMemo(() => buildShippingProse(draft), [draft]);

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
        title="Shipping"
        description="Set once for your whole account. Shown on every product page you sell on, and used for every product that does not name an exception below."
        decoration="grid"
      >
        <div className="flex flex-col gap-4 [&>div]:scroll-mt-20">
          <div id="ships-from" className="flex flex-col gap-1.5">
            <Label htmlFor="ships_from">Ships from</Label>
            <Select
              id="ships_from"
              value={shipsFrom}
              options={FROM_OPTIONS}
              onChange={setShipsFrom}
              disabled={isPending}
            />
          </div>

          <div id="dispatch-time" className="flex flex-col gap-1.5">
            <span className="flex items-center gap-1.5">
              <Label htmlFor="dispatch">Dispatch time</Label>
              <InfoTip label="Why this is its own field">
                One line, printed beside the buy button. &ldquo;When does it leave?&rdquo; is the
                first thing buyers ask, and it should not need reading a paragraph to answer.
              </InfoTip>
            </span>
            <Input
              id="dispatch"
              value={dispatch}
              onChange={(event) => setDispatch(event.target.value)}
              placeholder="Ships within 1-3 business days"
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
              <Label>Where you ship, and how long it takes</Label>
              <InfoTip label="How much detail to give">
                Group destinations however you actually ship: one row for home, one for the
                rest of the EU, one for everywhere else is plenty. Leave the cost blank if it
                varies.
              </InfoTip>
            </span>
            {destinations.length === 0 ? (
              <p className={helpTextClass}>
                Nothing listed yet. Buyers see no delivery times until you add a row.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {destinations.map((row, index) => (
                  <li key={index} className="flex items-start gap-2">
                    <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[1fr_1fr_0.6fr]">
                      <Input
                        aria-label={`Destination ${index + 1}`}
                        value={row.area}
                        onChange={(event) => setDestination(index, { area: event.target.value })}
                        placeholder="Rest of EU"
                        maxLength={DESTINATION_AREA_MAX}
                      />
                      <Input
                        aria-label={`Delivery time ${index + 1}`}
                        value={row.time}
                        onChange={(event) => setDestination(index, { time: event.target.value })}
                        placeholder="5-7 business days"
                        maxLength={DESTINATION_TIME_MAX}
                      />
                      <Input
                        aria-label={`Shipping cost ${index + 1}`}
                        value={row.cost ?? ""}
                        onChange={(event) => setDestination(index, { cost: event.target.value })}
                        placeholder="€9.00"
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
                          ? `Remove the ${row.area.trim()} destination`
                          : `Remove destination ${index + 1}`
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
                Add a destination
              </button>
            ) : (
              <p className={helpTextClass}>
                That is all {SHIPPING_DESTINATIONS_MAX} destinations. Remove one to add another.
              </p>
            )}
          </div>

          <div id="shipping-notes" className="flex flex-col gap-1.5">
            <Label htmlFor="shipping_notes">Anything else about shipping</Label>
            <Textarea
              id="shipping_notes"
              value={shippingNotes}
              onChange={(event) => setShippingNotes(event.target.value)}
              rows={3}
              placeholder="Tracked as standard. We do not ship to PO boxes."
              maxLength={POLICY_TEXT_MAX}
            />
          </div>
        </div>
      </SettingsCard>

      <SettingsCard
        id="returns"
        title="Returns"
        description="What you offer on top of the statutory rights your product pages already state."
      >
        <div className="flex flex-col gap-4 [&>div]:scroll-mt-20">
          <div id="returns-window" className="flex flex-col gap-1.5">
            <span className="flex items-center gap-1.5">
              <Label htmlFor="returns_window">Returns window</Label>
              <InfoTip label="What the statutory right already covers">
                Selling to EU buyers at a distance gives them 14 days to change their mind and a
                two-year guarantee on faults, whatever you choose here. Your product pages state
                both already, so this is what you offer on top.
              </InfoTip>
            </span>
            <Select
              id="returns_window"
              value={windowChoice}
              options={WINDOW_OPTIONS}
              onChange={setWindowChoice}
              disabled={isPending}
            />
            {windowChoice === "custom" && (
              <div className="mt-2 flex items-center gap-2 sm:max-w-40">
                <Input
                  aria-label="Returns window in days"
                  value={customDays}
                  onChange={(event) => setCustomDays(event.target.value.replace(/[^0-9]/g, ""))}
                  inputMode="numeric"
                  placeholder="60"
                  maxLength={String(RETURNS_WINDOW_MAX_DAYS).length}
                  className="flex-1"
                />
                <span className="text-sm text-muted-foreground">days</span>
              </div>
            )}
          </div>

          {/* Only asked once a window exists: who pays the postage back for a
              window nobody has is not a fact about anything, and the save
              drops it for the same reason. */}
          {returnsWindowDays !== undefined && returnsWindowDays > 0 && (
            <div id="returns-postage" className="flex flex-col gap-1.5">
              <Label htmlFor="returns_paid_by">Return postage</Label>
              <Select
                id="returns_paid_by"
                value={paidBy}
                options={PAID_BY_OPTIONS}
                onChange={(value) => setPaidBy(value as "buyer" | "seller")}
                disabled={isPending}
              />
            </div>
          )}

          <div id="returns-notes" className="flex flex-col gap-1.5">
            <span className="flex items-center gap-1.5">
              <Label htmlFor="returns_notes">Exceptions</Label>
              <InfoTip label="What belongs here">
                Anything the window above does not cover: made-to-order pieces, hygiene items,
                opened software. Buyers read this before they buy, not after.
              </InfoTip>
            </span>
            <Textarea
              id="returns_notes"
              value={returnsNotes}
              onChange={(event) => setReturnsNotes(event.target.value)}
              rows={3}
              placeholder="Made-to-order pieces cannot be returned unless faulty."
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
        title="What buyers will read"
        description="Built from your answers above, and shown on every product page."
      >
        {preview.shipping || preview.returns ? (
          <div className="flex flex-col gap-4">
            {preview.shipping && (
              <div>
                <h3 className="font-inter text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Shipping
                </h3>
                <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-foreground">
                  {preview.shipping}
                </p>
              </div>
            )}
            {preview.returns && (
              <div>
                <h3 className="font-inter text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Returns
                </h3>
                <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-foreground">
                  {preview.returns}
                </p>
              </div>
            )}
          </div>
        ) : (
          <p className={helpTextClass}>
            Nothing yet. Until you answer something above, your product pages carry no shipping
            or returns section at all.
          </p>
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
        title="Write it yourself instead"
        description="Optional. Anything you put here replaces what was generated above, word for word."
      >
        <div className="flex flex-col gap-4 [&>div]:scroll-mt-20">
          <div id="shipping-text" className="flex flex-col gap-1.5">
            <Label htmlFor="shipping_text">Your shipping policy</Label>
            <Textarea
              id="shipping_text"
              value={shippingText}
              onChange={(event) => setShippingText(event.target.value)}
              rows={4}
              placeholder="Leave blank to use the answers above."
              maxLength={POLICY_TEXT_MAX}
            />
          </div>
          <div id="returns-text" className="flex flex-col gap-1.5">
            <Label htmlFor="returns_text">Your returns policy</Label>
            <Textarea
              id="returns_text"
              value={returnsText}
              onChange={(event) => setReturnsText(event.target.value)}
              rows={4}
              placeholder="Leave blank to use the answers above."
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
        title="Shipping profiles"
        description="For the few products that ship differently. Pick one on the product itself, under Shipping."
      >
        <div className="flex flex-col gap-3">
          {profiles.length === 0 ? (
            <p className={helpTextClass}>
              None yet. Add one only if some products ship differently from the terms above.
            </p>
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
                      <Label htmlFor={`profile-name-${profile.id}`}>Name</Label>
                      <Input
                        id={`profile-name-${profile.id}`}
                        value={profile.name}
                        onChange={(event) => setProfile(index, { name: event.target.value })}
                        placeholder="Bulky items"
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
                          ? `Remove the ${profile.name.trim()} shipping profile`
                          : "Remove this shipping profile"
                      }
                      className={cn(iconButtonClass, "mt-7 shrink-0")}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </button>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`profile-dispatch-${profile.id}`}>Dispatch time</Label>
                    <Input
                      id={`profile-dispatch-${profile.id}`}
                      value={profile.dispatch ?? ""}
                      onChange={(event) => setProfile(index, { dispatch: event.target.value })}
                      placeholder="Made to order, allow 3 weeks"
                      maxLength={SHIPPING_DISPATCH_MAX}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`profile-body-${profile.id}`}>Shipping</Label>
                    <Textarea
                      id={`profile-body-${profile.id}`}
                      value={profile.body}
                      onChange={(event) => setProfile(index, { body: event.target.value })}
                      rows={3}
                      placeholder="How these products ship, and what it costs"
                      maxLength={POLICY_TEXT_MAX}
                    />
                    {/* A profile with no terms is dropped on save rather than
                        stored as a name pointing at nothing, so this says so
                        before the seller finds out by saving. */}
                    {profile.body.trim() === "" && (
                      <p className={helpTextClass}>
                        Add terms, or this profile is dropped when you save.
                      </p>
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
              Add a profile
            </button>
          ) : (
            <p className={helpTextClass}>
              That is all {SHIPPING_PROFILES_MAX} profiles. Remove one to add another.
            </p>
          )}
        </div>
      </SettingsCard>

      <div>
        <SaveButton pending={isPending} state={state} />
      </div>
    </form>
  );
}
