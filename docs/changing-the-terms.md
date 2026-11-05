# Changing the Terms of Service

You never pick a date, and you cannot give too little notice. Follow the steps and the rest runs itself.

## The steps

1. **Start a new version.** In the Home repo, run `npm run terms:new`. It copies the newest Terms to `src/content/legal/terms/tos-<today>.ts`.
2. **Edit that new file**, and update its `lastUpdated`. Never edit an older one: the build refuses, because people agreed to those exact words.
3. **Freeze it.** In Home, run `npm run terms:freeze`.
4. **Register it.** In the Store repo:
   - add the version to `TERMS_VERSIONS` in `src/lib/legal/terms-versions.ts`;
   - say what is changing in `src/lib/legal/terms-changes.ts`, with the wording in `messages/*/settings.json` under `legal.notice.changes`;
   - update the short version of the Terms if it no longer matches (`src/lib/legal/terms-summary.ts`).
5. **Deploy Home first, then Store.**

## What happens by itself

| When | What |
| ---- | ---- |
| The next daily run (`.github/workflows/scheduled.yml`, 03:23 UTC) | Everyone with a confirmed email is emailed in their language: what is changing, both versions, the date, and that they can leave for free. A banner appears in the dashboard. |
| The last email has gone | The 30 days start. The date is written to `terms_versions`, and can only be later than the one the emails stated. |
| During the 30 days | `/terms/` still shows the old Terms, with a note about the new ones. New sign-ups agree to the new Terms straight away. Anyone can agree early in Settings › Legal. |
| After 30 days | `/terms/` switches by itself, and the Overview asks anyone who has not agreed yet. |

Every version stays readable at `/terms/v/<version>/`, so you can always prove what someone agreed to.

## What stops a mistake

- **Too short a notice:** a database rule refuses a date under 30 days after the last email, and a date cannot be changed once written.
- **Editing Terms already published:** Home's build fails and says what to do.
- **Forgetting to register a new version:** it never takes effect, and `/terms/` keeps showing the old one.
- **Forgetting the summary of changes:** a Store test fails.
- **Mail off, or Home not deployed yet:** the job refuses to start the clock and the `terms-notices` scheduled job goes red. Nothing takes effect until it is fixed.

## If the job is red

Open the failed run in GitHub Actions. The error names the reason:

- `mail_off`: production mail is switched off. Set `TRANSACTIONAL_EMAIL_ENABLED` to `"true"` in `wrangler.jsonc`.
- `terms_page_missing`: the new version is not live on Home. Deploy Home.

The next run carries on. Nobody who was already emailed gets a second copy.

## The one exception: no 30 days

Only if the law forces the change, or it stops an unforeseen and imminent danger, set `urgentReason` to `"law"` or `"danger"` on the version in `terms-versions.ts`. Emails still go out, then it takes effect at once. Ask a lawyer first. Being in a hurry is not a reason.

## Not covered

- The Privacy Policy and Cookie Policy are notices, not contracts, so they do not use this. Tell users about material changes anyway.
- Quebec needs a French version given first, so a new version needs its French text before Quebec opens.
