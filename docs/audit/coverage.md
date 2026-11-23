# Audit coverage and access boundaries

## Functional surface

| Module | Routes / entry points | Authoritative data | Mutation validation |
|---|---|---|---|
| Overview | `#overview`, brand, metrics, priority/positions/recent tables | Event projection | Existing form and Worker suites |
| COO | `#coo`, terms, document checklist, handover, maintenance | Effective events; `/api/maintenance` | Synthetic local records |
| Roles | `#role`, `#role/:id`, create/edit, template activation | Job events | Revision/status/required fields |
| Pipeline | `#pipeline`, search, position/stage/owner/attention/sort, pagination, CSV | Candidate projection | Unique historical codes; job association |
| Candidate record | Readiness; suggested action; all actions; checklist/history disclosures | Subject feed plus operation controls | Versioned activity/stage/score records |
| Entry forms | Candidate, position, stage, milestone, correction, score, checklist, commission, summary | `/api/events` | Frontend validity; server allowlists; revision CAS |
| Daily activity | `#activity`, date, summary, edit/delete history | Effective events by SL date | Append-only replacements and control events |
| Interviews | `#interviews`, schedule/reschedule/cancel, ICS, Zoom/reminders | Stage events plus operational settings | Slot conflicts; stale version; fixed recipient |
| Guide | `#guide`, role track, disclosures | Static prompts and role templates | No mutation |
| Trash | `#trash`, restore, per-item purge, empty Trash, cleanup status | Record states; cleanup plans | Dependency graph; typed phrase; expected head; freeze/lease |
| Private documents | Name/files, availability, health, upload retry | Drive bridge and D1 outbox | Format/size bounds; HMAC fingerprint; private folder ancestry |
| Public JD | Dedicated careers `/jobs/:id` | `/api/public-job` field allowlist | GET/HEAD only; open jobs; no staff proxy |
| System controls | Refresh; navigation; skip link; mobile menu; notices; draft resume/discard | Session drafts and ordered feed | Pending-save identity; focus return |
| Operations | Build, CI, deploy, minute dispatcher, 10-minute maintenance, backups, restore SQL | GitHub/Worker/D1/Drive | Reproducible outputs; local recovery DB |

## API trust classification

| Route | Intended category | Current authority and safeguards | Residual issue |
|---|---|---|---|
| Careers pages, `/api/public-job` | Public read-only | Explicit allowlist; no script/API proxy; open positions only | Staff URL remains independently reachable |
| `/api/events` GET, `/api/bootstrap` | Public-safe reads | Codes/public-safe notes; no-store | No user identity; notes require human privacy discipline |
| `/api/events` POST | Public-safe operational submission | Bounded JSON; enums; privacy patterns; revision CAS; rate limits | Self-reported staff/reviewer roles, no authorization proof |
| `/api/documents` | Sensitive document operation | Private names/bytes forwarded only to owner-configured bridge; receipt-only response | Public endpoint can trigger uploads; no trusted user identity |
| `/api/document-status`, `/api/integrations` | Sensitive/operational status | Safe availability/health projection; bounded requests | Unauthenticated operations can consume integration quota |
| `/api/interviews` | Sensitive operational metadata | Valid Zoom URLs, scheduling/version checks, fixed email recipient | Meeting links can be read/changed without staff identity |
| `/api/trash` POST | Privileged destructive operation | Validated Trash selection, typed phrase, head CAS, dependencies, private cleanup receipts | Confirmation phrase is not authorization; unacceptable as staff-only control |
| `/api/maintenance` | Operational read | Safe counters, no secret values | Public counter exposure |

No destructive test, real applicant upload, hiring decision, permission expansion or real reminder email is authorized as a verification shortcut. Browser observations and local/mocked operational tests are recorded separately.
