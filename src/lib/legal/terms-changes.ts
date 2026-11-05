/**
 * What each new Terms version changes, in plain words: the bullets in the notice
 * email and in Settings › Legal. tests/unit/terms-versions.test.ts fails on a
 * version with none, because a notice has to say what is changing.
 *
 * Separate from lib/legal/terms-versions.ts because that file reaches every
 * bundle, and this copy only belongs on the pages that show it.
 */
import type { MessageKey } from "@/i18n/types";

export const TERMS_CHANGES: Readonly<Record<string, readonly MessageKey[]>> = {
  "tos-2026-10-31": [
    "Settings.legal.notice.changes.regions",
    "Settings.legal.notice.changes.disputes",
    "Settings.legal.notice.changes.plans",
    "Settings.legal.notice.changes.moderation",
    "Settings.legal.notice.changes.notice",
  ],
};
