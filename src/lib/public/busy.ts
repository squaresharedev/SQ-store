// "We could not answer just now", as opposed to "no".
//
// Every buyer-facing loader used to have one way to say it had nothing to
// show: `null`, which its page turns into a 404. That is right for a refusal
// (unknown id, a draft, a takedown: all deliberately indistinguishable), and
// wrong for the two cases that are nobody's refusal at all: the database did
// not answer, or this visitor has spent their rate limit. Telling a buyer who
// has just paid that their order "isn't available" because of a blip is the
// worst sentence the app could show them.
//
// So a loader returns PAGE_BUSY for those two, and its page renders a "try
// again" (components/product-page/BuyerNotice) instead of the 404.
//
// IT LEAKS NOTHING. The rate limit is spent before the first read, so it
// answers the same for a product that exists and one that never did; a failed
// read is a failure of ours, not a fact about the row.

export const PAGE_BUSY = "busy" as const;
export type PageBusy = typeof PAGE_BUSY;
