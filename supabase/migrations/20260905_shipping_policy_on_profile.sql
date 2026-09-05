-- Shipping and returns terms move to the ACCOUNT, off the storefront.
--
-- THE PROBLEM. `storefronts.config.policies` (shipping / dispatch / returns)
-- and `storefronts.config.shippingProfiles` were seller-editable jsonb members
-- of a STOREFRONT, written in the designer's side panel. A storefront in this
-- product is a presentation of one catalogue, not a separate business: the
-- same products appear on several, and `lib/storefront/shipping.ts` already
-- said out loud that "shipping terms really are a property of the store doing
-- the shipping". So a seller with two storefronts retyped the same returns
-- policy into both, with no second answer to give, and a product placed on a
-- second storefront could silently lose the profile it named. The design
-- surface was also simply the wrong place to write legal text: three textareas
-- plus up to eight profile cards was the largest thing in that panel by a wide
-- margin, and nobody arranging a page wants to stop and decide who pays return
-- postage.
--
-- THE FIX. One jsonb column on `profiles`, beside the trader identity that
-- moved the same day (20260905_seller_identity_on_profile), set once in
-- Settings › Shipping & returns and read by every storefront and every product
-- the account has. `lib/settings/shipping-policy.ts` is the one place that
-- builds the reader-facing shape from this column.
--
-- WHY JSONB AND NOT COLUMNS. Unlike the trader identity, this is not a flat
-- handful of scalars: it carries a destinations LIST and the shipping-profile
-- list that `products.shipping_profile_id` points into. Splitting those across
-- a child table would buy nothing (nothing queries them; they are only ever
-- read whole, for one account, to render a page) and cost a join on the public
-- product page's hot path. The real write boundary is
-- `lib/validation/shipping-policy.ts`, a strict Zod schema that rejects
-- unknown keys — the same arrangement `storefronts.config` has always had, and
-- the CHECK below is the backstop for a write that never went through it.
--
-- WHY NOT A NEW TABLE, THE OTHER REASON. RLS is already right here: `profiles`
-- is select/update-your-own-row-only (20260706081542), which is exactly the
-- rule these terms need for Settings. The two readers who legitimately need
-- someone ELSE's terms (a buyer with no session, a team member previewing a
-- store) go through a gated service-role helper, the same pattern the trader
-- identity and everything else on the public product page already uses.

alter table public.profiles
  add column shipping_policy jsonb;

-- The backstop, not the boundary (Zod is the boundary — see above). An object
-- and nothing else: an array or a scalar in here would break every reader, and
-- the size cap bounds what a service-role write can put on the public product
-- page's hot path. 16 KB is roughly eight times the largest policy the form
-- can produce.
alter table public.profiles
  add constraint profiles_shipping_policy_shape
    check (
      shipping_policy is null
      or (
        jsonb_typeof(shipping_policy) = 'object'
        and pg_column_size(shipping_policy) <= 16384
      )
    );

comment on column public.profiles.shipping_policy is
  'Account-level shipping and returns terms: structured answers (ships from, destinations, returns window, who pays return postage) plus the named shipping profiles products point at by products.shipping_profile_id. Bounded by lib/validation/shipping-policy.ts; rendered to prose by lib/shipping/policy-prose.ts. Replaces storefronts.config.policies and .shippingProfiles.';

-- BACKFILL, and it is a real one this time (unlike the seller-identity move,
-- where no stored config carried the member). Any storefront that has terms
-- hands them to its owner's profile.
--
-- ONE STOREFRONT WINS PER OWNER, deliberately: `distinct on (owner_id)` with
-- the most recently updated storefront first. An owner with two storefronts
-- carrying different terms has no correct merge available — concatenating two
-- returns policies would produce a paragraph that contradicts itself — so the
-- newest is taken as the one they most recently meant. Only rows that actually
-- hold something are considered, so an owner whose newest storefront never had
-- terms still inherits from the one that did.
--
-- Shapes are translated, not copied: `policies.shipping`/`returns` become the
-- seller's own words (`shippingText`/`returnsText`), which is exactly what
-- they are — free prose the generator must step aside for. `dispatch` and the
-- profiles keep their names and shape.
with source as (
  select distinct on (owner_id)
    owner_id,
    config -> 'policies' as policies,
    config -> 'shippingProfiles' as profiles
  from public.storefronts
  where (config ? 'policies' and jsonb_typeof(config -> 'policies') = 'object')
     or (config ? 'shippingProfiles' and jsonb_typeof(config -> 'shippingProfiles') = 'array'
         and jsonb_array_length(config -> 'shippingProfiles') > 0)
  order by owner_id, updated_at desc nulls last, id
)
update public.profiles p
set shipping_policy = (
  select jsonb_strip_nulls(
    jsonb_build_object(
      'shippingText', nullif(source.policies ->> 'shipping', ''),
      'returnsText',  nullif(source.policies ->> 'returns', ''),
      'dispatch',     nullif(source.policies ->> 'dispatch', ''),
      'profiles',     case
                        when jsonb_typeof(source.profiles) = 'array'
                         and jsonb_array_length(source.profiles) > 0
                        then source.profiles
                      end
    )
  )
),
updated_at = now()
from source
where source.owner_id = p.id
  and p.shipping_policy is null;

-- An account whose storefront carried an empty `policies: {}` and no profiles
-- lands on `{}` above, which is indistinguishable from "never set" to every
-- reader but not to a `is null` check. Normalise so "has this seller written
-- anything" has one answer.
update public.profiles
set shipping_policy = null
where shipping_policy = '{}'::jsonb;

-- The config members are retired, not read any more: see the
-- RETIRED_TOP_LEVEL_FIELDS strip in lib/validation/storefront.ts, which drops
-- them from any old stored or posted config before the strict parse. Stripped
-- here too so the stored jsonb matches what the schema now admits, and a
-- future reader of the raw column is not misled by a member nothing consults.
update public.storefronts
set config = config - 'policies' - 'shippingProfiles'
where config ? 'policies' or config ? 'shippingProfiles';
