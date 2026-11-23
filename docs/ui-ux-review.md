# Recruitment UI/UX review — 23 November 2026

The live recruitment workspace now displays each saved position's own requirements and full job description. Candidate sharing opens a separate careers origin, without staff navigation or candidate records.

## Reviewed journeys

1. Overview: metrics, priorities, positions and direct links to the correct JD.
2. COO workspace: priorities and review queues across all saved positions.
3. Hiring roles: expandable details, long descriptions, edit controls and candidate sharing.
4. Pipeline: search, filters, candidate table and record actions.
5. Daily activity: entry controls and activity history.
6. Interviews: calendar, scheduling form and action controls.
7. Interview guide: long-form reading and navigation.
8. Trash: empty state, recovery controls and existing destructive-action wording.

Candidate records, new-candidate forms, new-position forms and interview scheduling dialogs were also inspected. Live checks did not create applicants, alter hiring decisions, send email or delete records.

## Findings and changes

| Priority | Finding | Result |
| --- | --- | --- |
| High | New positions did not display their own JD | Every role has its own expandable requirements and description |
| High | Sharing the workspace exposed the staff interface | Dedicated candidate page on a separate Worker/origin |
| High | Small-screen navigation and tables were difficult to use | Accessible menu; labelled table cards; no page-width overflow at tested sizes |
| Medium | Tablet tables broke stage names and headings into fragments | Tables become readable label/value records through 1100px |
| Medium | Long forms and modal actions were difficult to reach | Sticky heading/actions, viewport-bounded dialogs, larger inputs and touch targets |
| Medium | Invalid fields inside collapsed groups were hard to find | Groups reveal invalid fields with associated inline errors |
| Medium | Dense text, JD formatting and focus cues hindered reading | Safer Markdown formatting, stronger contrast, visible focus, reduced-motion and print styles |
| Medium | COO position scope remained tied to the original role | Workspace includes all saved hiring positions |

## Candidate sharing

In Hiring role, expand the position, select **Share JD with candidate**, then **Copy link**. Preview checks the same candidate-facing page.

The candidate page exposes only the role title, department, location, engagement, headcount, requirements and public-safe JD. It has no dashboard links, client scripts, forms, CV access or staff API proxy. Only Open positions are published; paused, closed and deleted roles return an unavailable page. Edits to the saved public-safe JD appear on refresh. Never put confidential information in either public JD field.

The careers Worker uses the `RECRUITMENT` service binding to request the narrowly projected `/api/public-job` endpoint. It does not bind the recruitment database. Redirects are handled manually and rejected rather than followed. CSP blocks scripts, connections, forms and framing. Responses are not cached.

**Access boundary:** the original recruitment workspace remains public under its existing configuration. The shared careers link does not grant access or link to it, but it does not add authentication to an independently known recruitment URL. Complete staff-only protection would require authentication, which was outside this release and was previously declined.

## Verification

- Build and 58 automated tests passed, including existing hiring, storage, document, interview and recovery tests.
- Added tests cover accessible navigation, enhancement idempotency, unsafe JD markup, public field allowlisting, closed/deleted roles, HTTP methods, redirect rejection and absent staff routes.
- All eight live routes were checked at 320, 390, 768, 1024 and 1440 CSS pixels: 40 route/width combinations, without document-width overflow.
- The live candidate JD loaded at all five widths without overflow, dashboard links or scripts. The careers `/api/events` route displayed Page unavailable.
- Mobile menu open/close/Escape, the copy confirmation, and empty-job-form validation were checked live. Drafts were discarded.
- Before/after screenshots were captured during this session. Candidate information screenshots were kept out of this public repository.

These are Chromium viewport checks, not physical-device, Safari, Firefox or screen-reader certification. No release can guarantee every device or every future content combination.

## Deployment notes

Production recruitment was updated by appending the reviewed presentation/public-job changes to the existing live Worker, preserving its additional live CV/name features. The careers Worker was deployed separately with the approved service binding. The repository contains the modular UI changes, careers source/configuration and generated assets.

The deployed recruitment Worker already contained features absent from the repository baseline. Reconcile those pre-existing live changes before replacing production wholesale with a new source build. Do not overwrite the deployed Worker blindly. Candidate sharing requires both the recruitment public-job handler and the careers service binding.
