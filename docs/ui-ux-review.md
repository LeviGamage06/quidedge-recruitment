# Recruitment review — 23 November 2026

## Changes in this release

- Reset filters restores the default sort as well as search, stage, position, owner and attention.
- The COO handover reads effective, visible summaries: edited and deleted entries and Trash operations cannot replace the current handover.
- Active candidates remain in COO queues when their position is moved to Trash. Missing commission boundaries also appear in the terms queue.
- Table sections inside split layouts occupy the full row so desktop actions and content remain readable.
- Empty queues explain their state without suggesting another candidate must be added.
- Closed candidates receive an appropriate record-review action before document or commission suggestions.
- Save receipts must match the submitted event date and complete payload before the draft is cleared.
- Trashed candidates cannot receive new interview settings or document-status writes. Existing reminder revision checks remain in place.
- The Worker supplies the saved position title for reminder emails. The updated Google email bridge source also uses this value; updating the separately deployed Google script is required for this text change to take effect.
- Meeting saves and maintenance reads have timeouts.
- Job descriptions retain numbered-list starting values, recognise bullet characters and render separators.
- Worker responses deny framing, suppress referrers, restrict scripts/connections and disable unneeded camera, microphone and location permissions.
- Production deployment now runs on source and generated-asset changes, with build, tests, snapshot consistency and live asset comparisons.

## Verification

The local build and all 63 automated tests passed. The suite covers create/edit workflows, independent drafts, scheduling, cancellations, overlaps, commission and hiring gates, private document validation, upload recovery, backups, soft deletion, restoration, permanent cleanup and isolated candidate-facing job pages. New regression tests exercise the changes above.

All eight live routes loaded at 320, 390, 768, 1024 and 1440 CSS pixels without page-width overflow. Desktop screenshots also identified a compressed COO table; the responsive stylesheet now gives split-layout tables the full row. Live inspection confirmed the mobile menu, role descriptions, candidate form, pipeline filters and COO workspace load. Google Drive reported its private destination ready; the maintenance view reported a successful backup and zero pending document confirmations. Live destructive operations, applicant uploads, hiring decisions and outgoing email were not performed. Automated operational checks use synthetic local records and mocked external services.

## Access and integration limits

The staff workspace retains its existing public access configuration. Candidate codes and public-safe notes are required. Security headers and origin restrictions do not provide staff authentication; knowing the staff URL still permits access under the existing product design.

The separately deployed Google Apps Script could not be updated through the available connection. Its reminder-role change is prepared in `cloudflare/integrations/GoogleDrive.gs` and tested locally; deployment and real email delivery remain unverified.

The private document-upload workflow currently supports positions with the Client Acquisition profile. Other positions do not gain document-upload support in this release. CV semantic matching is not present in this repository baseline and was not added or certified by this review.

Candidate JD sharing uses the separate careers origin and an allowlisted public projection. Closed, paused and deleted roles remain unavailable to applicants.

A successful test run establishes the tested behaviour, not a guarantee of zero defects. Physical devices, Safari, Firefox, screen readers and real external email delivery require separate validation.
