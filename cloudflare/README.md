# QuidEdge Recruitment

Live app: https://quidedge-recruitment.inquiries-quidedge-au.workers.dev/#coo

Alternate frontend: https://levigamage06.github.io/quidedge-recruitment/

The Worker, database and scheduled maintenance run in the owner's Cloudflare account, independently of ChatGPT. Private documents and event backups use the owner's Google Drive bridge. No visitor login is required. Public readers can also append public-safe recruitment records: this is intentional, rate-limited public access, not verified staff access. Reviewer roles are self-reported.

## Source and verification

The complete source is in `cloudflare/src`, Google Apps Script in `cloudflare/integrations`, database migrations in `cloudflare/migrations`, restore tooling in `cloudflare/scripts`, and regression tests in `cloudflare/tests`.

With Node 24 and Python 3 installed:

```
npm ci --prefix cloudflare
npm run build --prefix cloudflare
npm test --prefix cloudflare
```

GitHub Actions runs these checks and verifies generated outputs. `index.html` is generated for GitHub Pages; `backend.js` and `cloudflare/worker.js` are the bundled Worker. Edit source files and rebuild. The frontend loads the ordered audit history so deleted and edited entries can be reconstructed correctly. Candidate history, daily activity and full exports remain available.

## Deployments

Keep the existing DB binding and encrypted `DRIVE_WEB_APP_SECRET`, and the `DRIVE_WEB_APP_URL` runtime variable. Never put credentials in source. `npm run deploy --prefix cloudflare` builds and deploys code; apply new tracked database migrations separately. Production's original schema and operations migration have been recorded in `d1_migrations`; do not rerun schema SQL manually.

A GitHub Pages commit deploys the alternate frontend only. Worker and Google Apps Script deployments are separate. Update the existing Apps Script deployment to protocol 3, executing as the owner, with the existing secret. Preserve restricted sharing. When the schedule from `wrangler.jsonc` is applied, the cron `*/10 * * * *` reconciles pending Drive receipts and saves incremental private event backups. Maintenance state is visible in the COO workspace.

## Data and privacy

Recruitment events remain append-only and SQL triggers reject UPDATE/DELETE. Candidate corrections add events. Candidate names and application bytes never enter public event records. Keep names and contact details out of all public notes; automated pattern checks do not recognize every kind of personal information.

Uploads accept PDF, DOC and DOCX up to 5 MB, with structural checks and bounded DOCX expansion. These checks are not antivirus scanning. The private named folder can be renamed when the full name is corrected during an upload; original application files remain preserved. Receipts record prior storage; use Verify current file availability for an up-to-date check. The latest displayed availability remains a statement about the recorded check time.

## Backups and recovery

Private incremental JSON event backups are stored under the recruitment root's `_System backups` folder. Original CVs/cover letters stay in their candidate folders; they are not duplicated into event backups. Download all event backup chunks privately and run:

```
python3 cloudflare/scripts/restore_backup.py /private/backup-directory --output /private/recovery.sql
```

The tool validates chunks and emits SQL for a NEW, separate recovery database. It never connects to production. Test recovery before switching any live binding. Owner actions, account access, provider quotas and retention still affect availability; the app cannot guarantee permanent retention against owner/provider actions.

## Commission terms

The supplied 10% / 20% / 30% ranges overlap at exactly AUD 1,000. Amounts below AUD 300 and decimal boundary amounts need a business decision. Commission review records the actual agreed boundaries and exceptional terms. The app does not invent a rate or replace the signed agreement.

## Reversible record management

Candidates, positions, milestones, scorecards, checklists, commission reviews, candidate corrections and daily summaries support reversible deletion through Trash. No SQL row or private application file is permanently deleted. Restore the candidate before restoring its child history. System-generated document receipts remain read-only.

Editable history entries append a replacement linked with `supersedes`; the original audit evidence remains in exports. Deletion and restoration append control records using the existing event schema, so this update needs no new database migration. Candidate codes remain reserved by historical records. Booking conflicts and stale edits are checked before saving; restored bookings cannot overlap another active interview.

The interview page provides Schedule R1, Schedule R2, Reschedule and Cancel interview. Closed candidates remain outside the scheduling list. Clearing pipeline filters shows every active record; adding a candidate clears stale filters automatically. Successful saves are never recreated as unsaved drafts.

`npm test --prefix cloudflare` includes a synthetic DOM interaction test covering forms, edits, scheduling, cancellation, Trash/restore and draft preservation, plus database and private-document regression tests. These tests do not create production candidate records.

### Permanent Trash cleanup

Apply `migrations/0003_permanent_trash.sql` after the first two migrations. Enable the **Drive API v3** advanced service (identifier `Drive`) in the existing owner Apps Script project, then deploy a new version of that existing web app. Existing Drive ownership and private-folder checks remain required.

Trash provides **Delete permanently** for one record and **Empty Trash** for all current Trash records. The confirmation phrase is `DELETE PERMANENTLY`. Cleanup removes the selected records and their version/control history, candidate documents, document receipts and interview settings. Managed event backups are rewritten without the removed events and the old backup files are permanently deleted. Other active candidates are preserved; a position with active linked candidates cannot be purged.

A server job pauses writes while cleanup runs. Private-file failure leaves the job pending, retries through the minute scheduler and never reports success prematurely. Completed jobs retain only a generic request receipt/count/time, and browser feeds refresh after the deletion epoch changes. Hashed candidate revocation markers prevent delayed document uploads from recreating removed files. Already-sent email, exported/downloaded copies and hosting-provider recovery retention are outside the app's deletion controls.
