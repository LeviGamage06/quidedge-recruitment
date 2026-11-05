# QuidEdge Recruitment

Live app: https://quidedge-recruitment.inquiries-quidedge-au.workers.dev/

Alternative frontend: https://levigamage06.github.io/quidedge-recruitment/

## Independent hosting

Both frontends now use the Cloudflare Worker API at https://quidedge-recruitment.inquiries-quidedge-au.workers.dev/api/events.
The Worker and D1 database belong to the owner's Cloudflare account. Running this app does not require a ChatGPT account or subscription.

The previous chatgpt.site deployment is an old separate copy. Do not enter new records there; use either live link above.

## Source and deployment

- index.html is the GitHub Pages frontend.
- backend.js is the complete deployed Cloudflare Worker, including same-origin frontend assets.
- The initial database schema is in the header comment of backend.js. Apply it only when creating a new database.

The production D1 database is named quidedge-recruitment, bound as DB.
Its database ID is d0cf193c-eef2-46eb-8be3-2c73fa21e9e9.
This ID is an identifier, not an authentication credential.

For Wrangler deployments, save this as wrangler.jsonc beside backend.js:

```json
{
  "name": "quidedge-recruitment",
  "main": "backend.js",
  "compatibility_date": "2026-11-05",
  "workers_dev": true,
  "d1_databases": [{
    "binding": "DB",
    "database_name": "quidedge-recruitment",
    "database_id": "d0cf193c-eef2-46eb-8be3-2c73fa21e9e9"
  }]
}
```

Authenticate with your Cloudflare account, then run `npx wrangler deploy`.
Do not recreate the production database or rerun the initial schema.
GitHub Pages automatically publishes the repository's main branch.

## Records and verification

The old database contained zero records at cutover. The new deployment and GitHub frontend were both verified as Synced. The independent Worker passed six local tests and a Wrangler deployment dry run before publication.

The API permits reads and appends. Stage changes add events and retain original history. Database triggers reject UPDATE and DELETE. Owners and the hosting provider still control the underlying database and retention.

Public access has no visitor login. Anyone can view and append records. Use candidate codes and public-safe notes.

## Backups

Use `npx wrangler d1 export DB --remote --output recruitment-backup.sql` with the configuration above.
Store backups privately outside this public repository, and test restores in a separate database.
Cloudflare Free plan limits apply.
