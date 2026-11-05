# Suggestions: rules and AI

Two kinds of suggestion share one look and one contract:

- **Predictions** (every plan): plain rules over what the store already holds. "Same as Linen shirt", sizes for a shirt, the currency the last products use.
- **AI writing help** (Pro, the `aiSuggestions` perk): Claude Haiku 5.5 writes or improves a product description from what the seller entered, and suggests the next words in grey while they type it.

Drafts and rewrites appear as suggestion chips (`components/ui/SuggestionChip.tsx`). They have a flowing green rim and a hint on hover and focus. One tap applies a suggestion, and a curved arrow takes it back. The next words appear as grey text after the cursor (`components/ui/SuggestingTextarea.tsx`): Tab adds them, Esc hides them, and Ctrl+Z takes added words back out.

## Where things live

| Path | What | Runs in |
| --- | --- | --- |
| `src/lib/suggestions/rules.ts` | Domain-free rule primitives: `agreed`, `mostUsed`, `SameAs` | anywhere |
| `src/lib/suggestions/listing.ts` | What every listing task reads: title, text, facts, language, and their limits | anywhere |
| `src/lib/suggestions/describe.ts`, `complete.ts` | Each task's contract: request schema, outcomes, and `canDescribe` / `canComplete` | anywhere |
| `src/lib/suggestions/ai.ts` | The one model call (`askClaude`), its price list and what each reply cost, fencing and text cleanup | server |
| `src/lib/suggestions/listing-prompt.ts` | What every task tells the model in the same words: the listing is data, the claim rules, the fence | server |
| `src/lib/suggestions/describe-listing.ts`, `complete-listing.ts` | Each task's instructions, call, output cleanup and test stand-in | server |
| `src/lib/predictions.ts`, `src/lib/products/option-guesses.ts` | The Store's own rules | anywhere |
| `src/lib/billing/ai-credit.ts` | The AI credit: the margin, the month, what a call takes | anywhere |
| `src/lib/ai-suggestions.ts` | Store wiring: who gets AI, the credit read and charge, the person's switch, the client, the dev stand-in | server |
| `src/lib/products/describe-actions.ts` | The two actions: session, role, input, plan and credit, pace budgets, the model, then the charge | server |
| `src/components/products/DescriptionAiChip.tsx`, `description-facts.ts`, `use-description-completion.ts` | The chip and the Free plan's upsell chip, the form read as facts, and the field's next-words hook | browser |
| `src/components/ui/SuggestingTextarea.tsx` | A textarea with grey next words (domain-free) | browser |
| `src/components/settings/AiWritingCard.tsx` | Settings › Plan & billing: the credit, the switch, or the upsell | browser |
| `src/app/dev/predictions` | The predictions lab: every rule live against an editable store | `next dev` only |
| `src/app/dev/ai-writing` | The AI writing lab: the real chip and grey words on sample or typed listings, against the real model (or the stand-in), with each answer's time, cost and prompt | `next dev` only |

## The shared core is liftable

`src/lib/suggestions/` imports nothing but:
- its own files, by relative path with a `.ts` extension
- `zod`
- `@anthropic-ai/sdk`

It does not read `process.env`, and it does not import Next, next-intl or Supabase. The client is passed in, so each app makes its own from its own key. `tests/unit/suggestions.test.ts` fails the build if that boundary is crossed.

**Using it in the marketplace** (`App/`, a Hono Worker plus React):

1. Copy the folder into `SQ-system/packages/suggestions` the way `packages/pricing` was made, changing the import extensions to `.js`, or into `App/worker/lib/suggestions`.
2. In a Worker route: create the client with `new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })`, then call `describeListing(client, { mode, title, text, facts, language })` or `completeListing(client, { title, text, facts, language })`. Put it behind the marketplace's own sign-in, plan check, credit and rate limit, as `describe-actions.ts` does here. Every answer carries `cost` (micro-dollars) for the meter.
3. Turn an artifact into facts as label/value pairs (format, size, tags), in the creator's language.
4. Draw the chip in the marketplace's own UI, following the contract below.

Once both apps consume the package, make the Store depend on it and delete this working copy. Keep one copy only: the schemas package drifted while it had two.

## The chip contract

- **Offered only when it can help.** It is never applied by itself. Nothing is saved until the seller saves.
- **One tap in.** The done state says what happened ("✓ Written by AI"). A curved arrow with no text takes it back, for as long as the result is unchanged. Once the seller edits it, the arrow goes, because undoing would also undo their edit.
- **The hint is the button's description.** It shows on hover and focus, and is also the `aria-describedby`. Touch gets no hint.
- **Focus moves only after a keyboard press,** to the arrow once done and back to the chip once undone.
- **AI chips** add three things:
  - A busy state ("Writing…", a spinner, `aria-disabled` so focus stays).
  - A draft that arrives after the seller typed in the field is dropped.
  - A failure says why in a toast and leaves the field alone.
- **Grey next words** (SuggestingTextarea):
  - Asked only after a 500 ms pause, with the cursor at the end, right after a finished word.
  - Tab is taken only while words are on offer; otherwise it moves focus as always.
  - Typing the same letters keeps the rest on offer; anything else makes them go. An answer for text that changed since is dropped.
  - Added words go in through the browser's own editing, so Ctrl+Z works.
  - The line under the field says what Tab does, holds Tab as a button for touch, and has "Turn off". Failures are quiet, except a used-up credit, said once.
  - Screen readers hear the words through a polite live region; the field's description says what Tab does.
- **Lists never reorder** by prediction.

## Adding a rule

Add one pure function in `lib/predictions.ts`, built on `suggestions/rules.ts` where it fits. The page loads the facts and hands the answer down as a prop. Add a case to `tests/unit/predictions.test.ts` and to the lab.

## Adding an AI task

1. **Contract** (`suggestions/<task>.ts`): the request schema with limits, the outcomes, and a `can…` check the screen asks before it offers the task.
2. **Instructions** (`suggestions/<task>-listing.ts` or similar): the prompt, the answer schema, cleanup, and a stand-in for tests. It calls the model through `askClaude`.
3. **A server action** that checks, in this order:
   1. session
   2. role
   3. input
   4. "anything to do?"
   5. `startAiCall`: the plan (`aiPlanFor`) and the task's pace budgets side by side, then a hold on the credit (`holdAiCredit`) for the task's `…MaxCost` (built on `maxAskCost`)
   6. the model, then `settleAiCredit` with the answer's `cost`, whatever the outcome

   Classify it in `tests/unit/agent/registry.test.ts`.
4. **A live eval** (`tests/unit/<task>.live.test.ts`, helpers in `listing-eval.ts`). Write the cases before tuning, and read every answer by eye, not only the score.
5. **The screen,** using `SuggestionChip` with `busy`, or `SuggestingTextarea`.

## AI writing help (v1)

- **Write with AI** is offered when the description is empty and the form holds at least one fact besides the title: an option, a material, care, size or weight, contents, a spec, badges, or "a download". From a title alone, an honest draft only repeats the title, which was measured, so a bare title gets no chip and costs no call.
- **Improve with AI** is offered once the description has words. It fixes spelling, grammar and order. It keeps every fact and claim in the seller's own terms and adds nothing, not even from the facts beside it.
- **Sent to the model:** the title, the description, and the facts, labelled in the words the form shows the seller. The maker's and EU contact's names and addresses, the seller's identity and buyer data are never sent.
- **Model and settings:** `claude-haiku-5-5` at effort `low`, with a 10 s timeout. One more attempt only after an error answer that may pass (rate limited, overloaded), never after one that did not answer. Low wrote as well as medium on the eval, at the same speed.
- **Measured over the last runs** (33 cases, 10 languages):
  - median about 1.0 to 1.4 s, p90 about 1.6 s
  - about $0.00016 a draft
  - 0 failing in three consecutive runs
- **Budgets** (`lib/rate-limit.ts`): per person 60 an hour, per store 150 an hour. The platform's day is capped in money, not drafts (see "The AI credit").
- **Dev and e2e:** `AI_SUGGESTIONS_TEST_PROVIDER=1` gives a deterministic stand-in, in development builds only. The e2e stack sets it. A title with `[[declined]]` or `[[unavailable]]` drives that outcome.
- **Trying it by hand:** `/dev/ai-writing` on `next dev`. No sign-in or plan is needed. It calls the real model when `.env.local` has `ANTHROPIC_API_KEY`, and has a switch for the stand-in.

## Suggestions as you type (v1)

- **When it asks:** in the description field, after a 500 ms pause, with the cursor at the end, right after a finished word, once the description has two words and the listing a title (`canComplete`). Mid-word typing asks nothing and costs nothing.
- **What it may suggest:** the rest of the sentence from the title or a fact (the sizes, the material, the measurements), at most one short sentence. When nothing in the listing says how the sentence goes on, the answer is empty, which is the usual answer.
- **The backstop:** a suggestion that shares no word with the title or any fact is dropped (`isGrounded`), whatever the model meant. It catches "This scarf is made from" + "wool" when no material was given, which got past the instructions in 1 run of 3.
- **Model and settings:** effort `low`, thinking left on, `max_tokens` 2,000, a 5 s timeout. Thinking off was no faster (both about 1.2 s) and filled gaps with guesses: "made from wool", "warm and cosy", "on a gentle cycle", "suits all skin types".
- **Measured** (16 cases, 6 languages, 3 runs after tuning): median about 1.0 s, p90 about 1.6 s, about $0.00016 a suggestion. Two runs had 0 failing. One flagged "a PDF file to download and print" for a sewing pattern, a mild added use, not a claim.
- **Off switch:** `profiles.ai_suggest_as_you_type`, per person, on by default. "Turn off" sits under the field while it is in use; Settings › Plan & billing turns it back on.
- **The eval:** `COMPLETE_LIVE_TEST=1 ANTHROPIC_API_KEY=... npx vitest run --project unit tests/unit/complete-listing.live.test.ts`, with `COMPLETE_TABLE_FILE=<path>` and `COMPLETE_EVAL_THINKING=adaptive|off` like the draft's.

## The AI credit

AI writing help must never cost more than it earns, so every call is metered.

- **The allowance:** `PLANS.pro.aiCreditCents`, EUR 10 a month per store (UTC calendar month). Free and Starter have none.
- **The charge:** every call takes its real cost (from the reply's token usage and `SUGGESTION_PRICE`) plus `AI_CREDIT_MARGIN` (20%) from the credit. A dollar of cost is counted as a euro of credit, which rounds in the platform's favour while the dollar is worth less than the euro.
- **The ceiling:** EUR 10 of credit buys at most USD 8.33 of model calls, the most AI can cost per Pro store per month, against a EUR 40 plan. Real use is a few cents: a seller would need about 50,000 drafts or suggestions in a month to reach it.
- **Enforcement: hold, then settle.** Before the model is asked, the most the call can cost is held on the month, in one locked step (`ai_credit_hold`, service role only) that refuses when it does not fit ("This month's AI credit is used up"). After the call, `ai_credit_settle` gives back what was held and not spent. So:
  - calls fired together queue on the row lock and can never hold past the allowance: the credit cannot be overshot;
  - a call that never reports back (the Worker gone) stays charged the most, never nothing;
  - a settle that fails leaves the most charged, never nothing.
- **The most a call can cost** (`maxAskCost` in `suggestions/ai.ts`): the prompt's UTF-8 bytes plus 2,000 tokens of framing, every one at the dearest input rate, and the answer at `max_tokens`. A token is at least one byte, so this bounds every reply. The largest request there is holds about EUR 0.012, so a store is turned away with at most that much of its month unused. Checked against the real model by `AI_COST_LIVE_TEST=1 ANTHROPIC_API_KEY=... npx vitest run --project unit tests/unit/ai-cost-bound.live.test.ts` (run it when the model, tokenizer or price list changes): framing measured 223 to 243 tokens, the dearest text 0.88 tokens a byte, the largest request US$0.0046 against a hold of US$0.0088.
- **What each outcome costs** (`askClaude`):
  - a reply, including a refusal or one cut off or the wrong shape: its usage at the price list. `messages.create` is used rather than `parse`, which throws a mis-shaped reply's usage away;
  - an error answer (4xx, 5xx): nothing, since it is not billed. One more attempt for 408, 409, 429 and 5xx;
  - no answer (timed out, connection gone): the most it could have cost, since it may have run and been billed, and it is never retried. The SDK's own retries are off for the same reason. Without this, a script that made every call slow would have been answered for free.
- **Request size:** `LISTING_LIMITS.total`, 12,000 characters across title, text and facts, checked by every request schema. Each part's own limit allows 66,000, which once escaped for the fence could pass the 100,000 tokens where the price is five times higher (`LONG_PROMPT`). The screens fit what they send (`fitListing`: title and text kept, facts in order while they fit), so a long form is never refused. `replyCost` and `maxAskCost` apply the long-prompt rate anyway.
- **The platform's day:** `AI_PLATFORM_DAILY_CENTS`, EUR 100 of credit a day (UTC) across every store, so at most USD 83 of model calls. It is held in the same step as the month (`ai_platform_usage`) and only catches what nobody foresaw: a fault handing the perk to every plan, or plan grants by the hundred. Past it, AI reads as "not available right now" for everyone until midnight UTC, and logs an error. Raise it as Pro grows.
- **Where the seller sees it:** Settings › Plan & billing › AI writing help: used of EUR 10, when it renews, and the as-you-type switch. Below Pro the card says what Pro adds and links to the plans.
- **Pace budgets** for as-you-type (`lib/rate-limit.ts`): 30 a minute and 600 an hour per person, 1,500 an hour per store. They bound the pace; the credit and the platform's day bound the money.
- **Who can spend it:** the active store's owner or a teammate with `products.write`, re-checked server side on every call (the store comes from the session, never the screen). Assistants (MCP) cannot: both actions are person-only in the agent registry.
- **Staff-granted Pro** gets the same credit: the cost of a grant is staff's choice.
- **Migration:** `supabase/migrations/20261104_ai_credit.sql`, applied to production 2026-11-05. Any change now needs a new migration. Wherever the credit cannot be held (a database without it, or one that is down), AI writing help refuses (fail closed).

## The upsell

Below Pro, AI writing help is offered where it would help, and never pops up:
- The product form shows a muted "Write with AI · Pro" chip at the moment the real chip would appear. It opens the plans in a new tab, so the product being written is not left.
- Settings › Plan & billing shows what it does and a "See Pro" link.
- The plans page lists it first among Pro's perks, with the credit ("AI writing help, with €10 of AI credit a month"), and the comparison table shows "€10 credit a month" instead of a tick.
- Every one of these links carries `?from=ai_writing`, so the pricing funnel counts what the AI upsell converts.

### The eval

Run it with:

```
DESCRIBE_LIVE_TEST=1 ANTHROPIC_API_KEY=... npx vitest run --project unit tests/unit/describe-listing.live.test.ts
```

Add `DESCRIBE_TABLE_FILE=<path>` to dump every draft for reading, and `DESCRIBE_EVAL_EFFORT=medium` to compare efforts.

Each case lists, in its own language, the claims a careless writer would add. A draft containing one that the listing does not contain fails the case. The cases cover:
- materials, "handmade", eco, health and safety claims
- softness and other feel words, delivery and urgency
- placeholders and file names, which must come back as "too little"
- instructions planted in a fact
- the wrong output language
- sentences about the listing instead of the item ("no further details are given")
- Improve dropping the seller's own words, or adding to them

What the tuning found: three things the first prompt got wrong and only reading by eye caught.
- German titles came back in English.
- It wrote filler about missing details.
- It invented look and feel ("soft and enveloping", "nourishing").

The fixes:
- The answer names the listing's language before the description.
- The facts are labelled in the seller's language.
- Look and feel are forbidden.
- A single "how it is used" sentence is allowed, except for food, cosmetics, supplements and children's products.

## Legal notes

- **No invented claims.** The instructions forbid anything the listing does not say. That covers materials, origin, "handmade", certifications, health or safety claims, and environmental or ethical claims; generic environmental claims are unlawful under Directive (EU) 2024/825, applied since 27 September 2026. It also covers delivery, scarcity, reviews, competitor comparisons and superlatives. The eval checks this in ten languages.
- **The seller publishes it.** The chip says "with AI", the hint says it is an AI draft to check, and the done label says "Written by AI". Nothing reaches buyers until the seller saves. The Terms already make sellers solely responsible for their listings, and the save runs the usual automatic content check.
- **GDPR.**
  - Only the listing's own words are sent: when the seller taps a chip, and, with suggestions as you type on (the default on Pro), while they type a description. The line under the field says so whenever it has focus, and turns it off.
  - Nothing is stored by us beyond what the seller saves.
  - Anthropic is already our processor for the content check: commercial terms with a DPA and SCCs, deletion within 30 days, no training by default.
  - The legal basis is the contract with the Pro seller (Art. 6(1)(b)).
- **Before switching it on in production:** add the paragraph below to the privacy policy (`Home/src/content/legal/privacy.ts`, section 3 and the Anthropic row in the processor table), and have counsel confirm it.
- **Open question for counsel:** whether suggestions as you type may be on by default for Pro sellers (the reasoning here: the text is the seller's own product data, sent for the service they chose, with the switch beside the field), or should ask once first.
- **Open question for counsel:** AI Act Art. 50(2), machine-readable marking of AI-generated text. The "assistive function for standard editing" exemption likely covers Improve, but maybe not a first draft from facts. If marking is needed, the cheapest compliant form is a stored flag on the product and a metadata tag on the product page. That is not built.

### Draft privacy policy wording (not published)

Section 3, a new purpose:

> **AI writing help (Pro plan).** When a Seller on the Pro plan asks for a draft, or writes a product description with suggestions as you type switched on (they are on unless the Seller turns them off, under the field or in Settings), we send the product's title, its description so far and the details the Seller has entered on the product form (such as options, materials, care instructions, size and weight, but not the manufacturer's or EU contact's name and address) to our processor **Anthropic**, which writes a draft or suggests the next words. The answer is shown only to the Seller, who decides whether to keep, change or discard it, and we keep it only if the Seller saves it. We record how much AI each store has used in a month (an amount and a number of requests, not the text), to apply the plan's monthly AI allowance. This processing is necessary for the service the Seller has chosen (Art. 6(1)(b) GDPR).

The Anthropic row in the processor table, appended to its purpose:

> and, for Sellers on the Pro plan who ask for it, AI writing help for product descriptions (receives only the product's own text and details)
