// WHAT COLOUR MEANS ON THE ANALYTICS PAGE.
//
// The chart kit is monochrome-first by default: ink for the primary series,
// greys for context, and green/red only when they are PINNED, so nothing turns
// red just for being third in a list. This file is where the analytics page
// does that pinning, in one place, so the meaning is reviewable rather than
// scattered across a dozen `colorIndex: 4` literals.
//
// The scheme is three roles, and every chart on the page picks one:
//
//   MONEY      green. Revenue, order value, the paid state. Green is the
//              colour of the number a seller opens this page for.
//   LOSS       red. Refunds, and only refunds. Never used for "third series",
//              never for a low bar, never for emphasis. If it is red, money
//              went backwards.
//   TRAFFIC    blue. Views, clicks, and the other counts that are activity
//              rather than income. Distinct from money at a glance, which is
//              the whole point: a spike in views and a spike in revenue are
//              different news.
//
// Neutrals stay neutral: ink and greys carry the states that are neither good
// nor bad (pending, disputed, a channel split), because giving those a hue
// would spend the reader's attention on something that does not need it.
//
// The values are CATEGORICAL slot indices from components/charts/theme.ts, not
// colours. Slots resolve to tokens, tokens re-step per theme, and green in
// particular is a different green in dark mode (see --chart-positive).

export const TONE = {
  /** Ink. The default weight, for a lone neutral series. */
  neutral: 0,
  /** Mid grey. Context beside something louder. */
  quiet: 1,
  /** Light grey. The faintest tier that still reads as a mark. */
  faint: 2,
  /** Blue. Traffic and engagement counts. */
  traffic: 3,
  /** Green. Money earned, and the healthy state. */
  money: 4,
  /** Red. Money lost. Refunds only. */
  loss: 5,
} as const;
