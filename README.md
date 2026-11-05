# QuidEdge Recruitment

Live app: https://quidedge-recruitment.inquiries-quidedge-au.workers.dev/

Alternate frontend: https://levigamage06.github.io/quidedge-recruitment/

The Cloudflare Worker and D1 database are hosted in the owner’s Cloudflare account, independently of ChatGPT. Both frontends use the Worker API at `/api/events`. The old ChatGPT Sites API is no longer used.

`index.html` is the standalone GitHub Pages frontend. `backend.js` is the complete deployable Worker with frontend assets. Backend updates require a separate Cloudflare deployment retaining the existing DB binding and encrypted runtime secrets; a GitHub Pages commit only deploys the frontend.

Public access has no visitor login. Anyone can view and append public recruitment records. Use candidate codes and public-safe notes. Names, CVs and cover letters are sent only to the private Google Drive workflow; public records contain upload receipts, not private file URLs or document bytes.

Recruitment events are append-only. Updates add history; the database rejects UPDATE and DELETE. Do not rerun the initial schema against the existing database. Provider and owner retention settings remain relevant; maintain private backups.

The active role is Client Acquisition & Client Relations Specialist, remote independent contractor, with no fixed salary and agreed recurring commission terms. Exactly AUD 1,000 overlaps in the supplied tier descriptions and must be confirmed in the agreement.

Verification: 20 automated regression tests passed, covering storage, retries, validation, commission gates, Drive bridge privacy, folder recovery, response integrity and calendar encoding. Tests use a disposable local database. Passing checks do not establish that all possible bugs have been eliminated.
