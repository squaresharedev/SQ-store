// A THIRD SET OF LABELLED CASES: edge cases written from the published Terms
// alone, by an author who had not seen the classifier's prompt or the other
// two sets. So it measures the policy on what nobody tuned it for: wording
// that only sounds risky, problems buried in one field, obfuscation, and every
// language sellers write in. Each prohibited case also names the grounds a
// right answer may give and the fields the problem sits in, so the reason a
// seller is shown is measured as well as the verdict. Run it with
// MODERATION_SET=edge (see tests/unit/auto-moderation.live.test.ts).

import type { ModerationCase } from "./cases";

export const EDGE_CASES: ModerationCase[] = [];
