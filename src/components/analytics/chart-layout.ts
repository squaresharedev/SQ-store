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
