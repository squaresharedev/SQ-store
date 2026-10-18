// ONE plot height for every card on the analytics page.
//
// The chart kit takes `height` as a pixel number (it drives an inline style on
// the ResponsiveContainer wrapper), so this cannot be a Tailwind breakpoint
// class the way the rest of the page's responsiveness is. That is fine, and the
// single value is deliberate rather than a limitation:
//
//   - 256px is comfortable on a phone (roughly a third of a 700px viewport)
//     and on a desktop two-up row alike, so no chart needs a second size.
//   - It matches ChartCard's empty and awaiting placeholders exactly, so a card
//     switching between "no data in this range" and a populated chart does not
//     resize the page under the reader's cursor.
//   - Every card being the same height is what lets the two-up rows line up
//     without each pair having to agree separately.
//
// Width is where the real responsiveness lives, and the kit's
// ResponsiveContainer already owns that: axis ticks thin out via minTickGap
// rather than overlapping as the column narrows.
export const CHART_HEIGHT = 256;

// The revenue hero is the one chart that is not a card and not this height:
// it is the page's headline, in a frame of its own, so it gets more room, and
// more of it where there is a screen to spend it on (352px on a phone, 448px
// from a tablet up). A class, because its height follows the screen; the chart
// fills the box the class makes (the kit's height="fill"). The same class
// holds the hero's box where there is no chart in it (its empty state and the
// loading skeleton), so neither resizes the page when the chart arrives.
export const heroChartHeightClass = "h-88 md:h-112";

// The air above and below a section's lead (the hero), on top of the
// section's own spacing, so it reads as the headline and not as the first
// card. Shared with the loading skeleton, so the page does not shift when the
// hero arrives.
export const leadLaneClass = "py-2 md:py-6";

// The room the hero keeps between its corner marks and its chart, top and
// bottom. Shared with the loading skeleton for the same reason.
export const heroFrameClass = "relative py-7";
