# QuidEdge Recruitment

Live dashboard — https://levigamage06.github.io/quidedge-recruitment/

Public access with no visitor login. The dashboard includes open positions, candidate stages, interviews, scorecards, activity history and daily COO summaries.

## Source

- index.html contains the complete frontend, styles and interview guide.
- backend.js contains the deployed API worker and an initial database schema in its header comment.

## Hosting and storage

GitHub Pages publishes the main branch from the repository root.
Recruiting data is stored in the existing shared D1 database served at https://quidedge-recruitment.felinedough1.chatgpt.site/api/events.
The GitHub Pages interface and the original Sites interface use the same records.

The API accepts reads and append operations. Stage changes add events and preserve history. Database triggers reject update and delete operations.
Anyone can view and append public records. Use candidate codes and public-safe notes.

## Backend deployment

The existing backend is already running. Backend changes require a separate Worker deployment with the existing D1 database bound as DB.
GitHub Pages deployments update the frontend. The initial schema is for creating a fresh database only.
Do not rerun the initial schema against the existing database.

## Retention

Application controls preserve original entries. Database owners and hosting-provider retention can affect storage.
Maintain provider backups appropriate to the required retention period.
