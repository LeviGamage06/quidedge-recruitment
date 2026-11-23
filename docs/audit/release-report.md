# QuidEdge comprehensive engineering release report

Date: 23 November 2026. Scope: instructions in Pasted text(10).txt.

## A. Executive summary

This follow-up extends the earlier UI release into a source, API, event-history, integration, security, accessibility, performance and deployment review. It preserves the current no-login usage model, existing infrastructure, URLs, database binding, minute scheduler and historical records. No database migration or production candidate mutation is included.

Sixteen scoped defects/engineering findings were fixed or refined in the deployed update, including inconsistent sync histories, role-profile progression, retained role behaviour for active candidates linked to trashed positions, newly created public job descriptions, offline startup, unsupported document controls, input contrast, build reproducibility and deployment of the existing careers Worker. All 73 local automated tests pass. The detailed inventory contains 284 control entries across rendered and conditional contexts; conditional source-only entries are explicitly marked.

**Full production-grade acceptance remains blocked** by the unauthenticated trust model and the separately managed Google/document configuration. Successful tests and deployment of compatible fixes do not close these blockers.

The compatible fix release was deployed and independently checked; final evidence and acceptance statuses are recorded below. The starting production revision is `95d3608530719f0a881e84faa8733257c4710429`.

## B. Audit coverage

The source review covered frontend routes and dialogs, shared validation/projection, API allowlists and concurrency checks, all three migrations, private upload/receipt recovery, Google bridge authentication/ancestry checks, reminders, permanent-cleanup planning/leases, static/public responses, event-backup restoration, build configuration and workflows. No real applicant data appears in these artifacts.

- [Functionality inventory](functionality-inventory.csv): labels, locations, handlers/API, requirements, choices, loading/error/success behaviour, mobile/keyboard/security considerations and evidence limits.
- [Functional surface and API trust classification](coverage.md).
- [Defect register](defect-register.md): severity, reproduction, root cause, code location, fix, regression and blocker status.
- [Build hashes](build-reproducibility.json), [performance measurements](performance.json), [test output](test-results.txt).

The production browser baseline checked all eight routes at 320, 360, 375, 390, 414, 430, 768, 820, 1024, 1280, 1440 and 1920 CSS pixels, plus 700/701 and 1100/1101 breakpoint boundaries: 128 route/width combinations. No page overflow, clipped table region or duplicated position JD action was found. Final post-deployment checks are recorded separately below.

## C. Defect summary

| Severity | Fixed / implemented | Open / blocked |
|---|---:|---:|
| P0 architectural risk | 0 | 1 |
| P1 | 7 | 2 |
| P2 | 9 | 1 |

Eight failing regression cases reproduced sync/validation/progression/offline and public-JD defects before the relevant fixes. Additional source/runtime findings include the redundant projection, inaccurate error message, 1.58:1 control border, documentation drift and missing careers deployment. The register groups related failure modes rather than counting each assertion as another defect.

## D. UI/UX and accessibility

Offline startup now explains recovery rather than remaining on a loading screen. General-position document actions open an honest setup explanation, without suggesting an upload completed. Overlong JD errors state the correct 12,000-character limit. Public JD sections retain their numbering and semantic bullets, matching the staff view.

Form borders now use a reusable control token with 3.27:1 contrast against the input fill; sampled muted text is 6.61:1, primary-button text 11.19:1 and warning text 6.61:1 against their specified backgrounds. These are scoped colour measurements, not blanket WCAG certification. Existing focus indicators, semantic controls, labelled mobile record cards, native modal behaviour and reduced-motion rules remain.

Live baseline keyboard testing confirmed that Escape closes the candidate modal and returns focus to Add candidate. Validation, menu, modal focus and resized layouts are rechecked after deployment. Physical devices, Safari/Firefox/Edge, real screen readers and actual browser 200% zoom are not certified by CSS-width testing. Small-width reflow is tested separately from browser zoom.

## E. Functionality verification

The automated suite uses synthetic SQLite-backed API records, simulated DOM interactions and mocked Google services. It covers create/edit/save/reload projections, required fields, preserved identities, historical duplicate-code reservation, stale writes, overlapping interviews, scoring/checklist/commission gates, soft deletion, dependent restoration, replacement history, partial external failures, receipt retries, cleanup and backup restore.

New export tests inspect actual generated JSON, filtered CSV and ICS bytes. JSON contains the stored synthetic history; CSV respects the selected Hired filter and escapes formula-like fields; a 09:00 Sri Lanka interview exports as 03:30 UTC with the expected 30-minute duration. No external messages are sent.

Commission percentages and the ambiguous AUD 1,000 boundary were not changed. The system records agreed terms rather than inventing a calculation. Weekly/monthly payroll or revenue calculations and semantic CV matching are not implemented in this repository baseline; this review does not pretend to certify them.

## F. Security assessment

Existing and verified defences include server field/date/enum validation, bounded JSON/upload sizes, SQL parameter binding, event revisions and compare-and-swap writes, idempotent event/document IDs, formula-safe CSV, escaped rich text, private document receipts, configured-owner bridge authentication, no-store operational responses, browser-origin checks, request throttling and strict careers field projection/CSP. The previous staff security headers remain intact.

Stronger client feed validation now prevents mixed cleanup epochs or malformed snapshots from silently entering state. Profile-based server validation closes a business-rule bypass for additional Client Acquisition positions.

**SEC-01 remains open:** CORS, request limits, candidate codes and a typed deletion phrase do not establish staff authority. Public staff endpoints can expose/change operational records and meeting metadata, and privileged cleanup cannot be certified as staff-only. No destructive production exploit was performed to demonstrate this source-confirmed boundary.

A practical option requiring an explicit product decision is identity protection on the recruitment origin and its APIs, while leaving the separate careers origin public. An email-OTP staff allowlist is one possible low-friction design; approved staff identity/session enforcement would change the current no-login requirement. No new access policy, credential or sharing permission was silently introduced.

Upload structure checks are not antivirus scanning. DOCX expansion bounds and macro/path checks were reviewed and existing malformed-format tests pass. No applicant files are sent to a new analysis service.

Dependency auditing could not reach the npm registry from the local restricted environment (DNS failure). A full `npm audit --audit-level=high` gate has been added to CI and deployment; its actual result is recorded with CI evidence rather than assumed.

The assessment follows the principles in [OWASP Authorization](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html) and [OWASP File Upload](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html). These references are guidance, not a security certification.

## G. Integration status

| Integration | Evidence | Limit |
|---|---|---|
| Cloudflare D1 | Shared production views load; local SQL-backed mutation, trigger and replay tests pass | Genuine production candidate writes were deliberately not tested |
| Google Drive | Live health reported a verified private destination; private-folder/receipt/retry/backup tests pass locally | Exact active script version and owner deployment are not available in the browser session |
| Document uploads | Supported-profile upload/receipt tests, original-version preservation and availability handling pass | Other profiles lack a configured destination; no real applicant upload was used as a probe |
| Scheduled work | Configuration dispatches each minute; source runs maintenance every ten minutes; live maintenance status was available | No production schedule change; operational logs are separate from browser console observations |
| Interview reminders | Fixed-recipient/idempotent/ambiguous-failure tests and role-profile tests pass | No real email sent; separately deployed Google role correction still requires owner access |
| Backups/recovery | Synthetic private event chunks restored to a new SQLite DB with original IDs/timestamps and append-only protections | Event backups are not a complete copy of private files or operational Zoom/reminder settings |
| Public careers | Read-only allowlist, closed/deleted/invalid job behaviour, redirect rejection, no staff routes/scripts tested | Independent knowledge of the public staff URL still reaches the existing staff app |

Opening the Google Apps Script home in the available browser redirected to public developer documentation with a Sign in link, not an authenticated owner project. Updating that separate deployment requires the owner session and the correct existing project/deployment. Existing secrets should stay in their current encrypted locations; none need to be pasted into chat.

## H. Test results and performance

Executed locally:

```text
npm run build --prefix cloudflare
npm test --prefix cloudflare
node cloudflare/scripts/audit_inventory.mjs
node cloudflare/scripts/audit_benchmark.mjs
node cloudflare/build.mjs                  # from repository root
node build.mjs                            # from cloudflare directory
```

The 73-test suite passed with zero skipped/cancelled tests. Generated outputs from both working directories have identical SHA-256 values. The benchmark projects 10,001 synthetic events / 1,000 candidates in a 2.81 ms median over seven local samples, against a local 50 ms target. Baseline median was also 2.81 ms; no user-visible speed-up is claimed. Removing duplicated ingest work and repeated job-history queries is a source-level efficiency improvement, not a measured live Worker latency result.

CI performs a clean `npm ci`, advisory audit, build, full tests and generated-snapshot comparison before production deployment. Live browser and service checks are independent evidence recorded after deployment.

## I. Deployment and rollback

Changes use the dedicated `codex/comprehensive-recruitment-audit` branch and a reviewable pull request. The existing deployment workflow preserves the D1 binding and dashboard variables, tests the source, and deploys the existing recruitment and careers Workers. It compares recruitment HTML/JS/CSS and the careers home page to the tested build. It never applies migrations during this release.

Rollback reference: `95d3608530719f0a881e84faa8733257c4710429`. The updated workflow supports a manual `revision` input: selecting the known-good revision checks out, rebuilds, tests and deploys that source for both existing Workers without changing the database. This path is prepared and build-tested; no production rollback drill was executed. The alternate GitHub Pages frontend must also be returned to the matching source revision if a rollback is required.

Deployment token values are not read or displayed. Successful prior deployments establish that repository credentials function; their exact account-side permission scopes/expiry cannot be independently attested through the available connection. Do not infer least privilege from a successful deploy alone.

## J. Final deployment evidence and acceptance

Code release: `22adfb9dde14f1829ba609f181cf4666f97bff69`; reviewed source head: `22038a0d322f61202837b63ee3d885d241986577`.

- [Merged pull request #3](https://github.com/LeviGamage06/quidedge-recruitment/pull/3).
- [Final source review CI](https://github.com/LeviGamage06/quidedge-recruitment/actions/runs/45181326016): clean install, advisory audit, 73 tests and generated-file consistency passed.
- [Production deployment](https://github.com/LeviGamage06/quidedge-recruitment/actions/runs/45181628868): dependency audit reported zero known vulnerabilities; all 73 tests passed; both existing Workers deployed; built/live asset comparisons passed.
- Recruitment Worker version: `17748790-df14-4c42-9b36-b953e949c65f`.
- Careers Worker version: `0c46364d-995d-4fa4-b09d-3ab665b15a8d`.
- [Recruitment production](https://quidedge-recruitment.inquiries-quidedge-au.workers.dev/#overview).
- [Careers production](https://quidedge-careers.inquiries-quidedge-au.workers.dev/).

The careers deployment completed at approximately 18:43 Sri Lanka time on 23 November 2026. The existing D1 binding was retained; no migration command ran. The alternate Pages deployment is checked separately in the final action status.

Post-deployment browser verification covered 8 staff routes, 3 direct role-detail routes and 3 public JD pages at all 16 specified/boundary widths: **224 combinations, zero measured overflow/clipped-table/duplicate-action failures**, with the actual viewport width checked against each requested width. All three candidate pages rendered; no staff links, forms or scripts appeared. The careers `/api/events` and invalid-job paths showed Page unavailable.

Live interaction checks confirmed copy-link success feedback, default-sort restoration and search focus after Reset filters, mobile-menu Escape handling, candidate-modal Escape/focus return, the new input-border RGB, private Drive readiness and a successful maintenance status with no pending document confirmations. No browser errors/warnings were observed. Native preview was clicked; its destination was verified through a directly controlled candidate-page tab because no controllable popup tab was exposed by this browser surface. Tab-boundary focus wrapping, screen-reader behaviour and actual browser zoom remain uncertified.

Browser screenshots were captured during visual review. Screenshots containing operational records were not published into this public repository. Cloudflare Worker exception-stream access was not exposed by the available account tooling; deployment logs and the browser console were reviewed, not misrepresented as a full production log audit.

### Additional content finding

DATA-05: the Worldwide partnerships JD is already stored at exactly 12,000 characters and ends mid-word. The same ending appears in the editor and the public page, so this is an existing content-integrity problem. A related Library document was read, but it contains the Sri Lanka/AUD variant and is not an authoritative replacement for the Worldwide/USD text. The approved complete Worldwide copy is required to restore the missing content safely. Existing text was not silently rewritten.

### Final acceptance matrix

| Area | Status | Actual evidence / remaining boundary |
|---|---|---|
| Frontend UI/UX | Pass for reviewed scope | 284-entry inventory, UI/export tests and visual inspection |
| Mobile responsiveness | Pass for tested CSS viewports | All requested narrow widths and breakpoint boundaries; physical devices untested |
| Desktop responsiveness | Pass for tested CSS viewports | 1280/1440/1920 and intermediate boundaries; no clipped table actions |
| Buttons and forms | Pass for covered journeys | Local mutation tests plus live safe validation/navigation/menu/reset/copy checks |
| Candidate pipeline | Pass in controlled tests | SQL-backed lifecycle, duplicate/revision/profile gates and retained parent-role behaviour |
| Interviews | Pass in controlled tests | Booking/conflict/cancel/scorecard/reminder/ICS checks; no real email sent |
| Job-description sharing | Blocked for complete content | Routing/isolation passed on all 3 live public pages and isolated invalid/API routes; DATA-05 copy incomplete |
| CV/document management | Blocked for whole-platform acceptance | Supported profile tested; other profiles need private destination setup |
| Google Drive integration | Blocked for owner-deployment sign-off | Live readiness plus local bridge tests; exact active Google version unconfirmed |
| Database integrity | Pass in controlled tests | Trigger/CAS/replay/restore tests; no genuine production candidate mutation |
| Application security | Blocked | SEC-01: no trusted staff identity for sensitive/privileged operations |
| Automated testing | Pass | 73 tests; clean review/deployment CI; registry audit reported zero known vulnerabilities |
| Cloudflare deployment | Pass | Both Worker version IDs and exact live/build comparisons |
| Production live verification | Pass for non-destructive smoke scope | 224 responsive checks and listed live interactions; no real file/email/destructive probes |

The scoped compatible fixes are live. Full enterprise/security/content acceptance is **blocked**, requiring: a trust-model decision, authenticated owner Apps Script deployment, private-upload setup for additional profiles, and complete approved Worldwide JD copy. These conditions are not hidden behind a green test count.
