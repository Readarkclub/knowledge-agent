# Security operations

## Required environment variables

Public pages do not require authentication. Expensive AI and embedding endpoints
fail closed until these protection values are configured:

```ini
VISITOR_SESSION_SECRET=<at least 32 random characters>
UPSTASH_REDIS_REST_URL=<Vercel Marketplace Upstash URL>
UPSTASH_REDIS_REST_TOKEN=<Vercel Marketplace Upstash token>
API_SECRET_KEY=<newly issued model gateway key>
```

Generate the session secret locally:

```powershell
[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(48))
```

Never reuse `API_SECRET_KEY` as the visitor session secret.

## Secret rotation checklist

1. Revoke the exposed model gateway key with the gateway administrator.
2. Issue a new key and update `API_SECRET_KEY` in local and Vercel environments.
3. Generate a new `VISITOR_SESSION_SECRET`; existing anonymous visitor cookies
   will be replaced automatically.
4. Re-authenticate the Vercel CLI only when deploying.
5. Rotate the Upstash REST token from the Marketplace integration if it may
   have been exposed.
6. Deploy, then verify that `/` and `/resources` remain public while automated
   or over-quota `/api/chat` requests are rejected.

The local `.vercel-cli-auth` directory and all `.env*` files are excluded from
Vercel uploads.

## Citation scope

Weekly-report citations are followed only when their token is already present
in the configured Wiki tree. Exceptional external documents must be reviewed
and added explicitly:

```ini
KNOWLEDGE_ALLOWED_CITATION_DOC_IDS=doc-token-1,doc-token-2
```

Keep this list minimal. A new external citation is rejected by default.

## Abuse protection

- BotID Basic runs invisibly on `/api/chat` and `/api/search`.
- A signed, HttpOnly anonymous visitor cookie supplies a stable quota identity.
- Upstash Redis enforces visitor, network fingerprint, and global daily limits
  across Vercel instances.
- Vercel Firewall applies a 10 requests/minute burst limit to `/api/chat`,
  keyed by IP and JA4 before the request reaches the function.
- Chat output is capped at 2048 tokens.
- Production fails closed when Redis or BotID verification is unavailable.

## Decision log

- Knowledge pages, resources, status, and content are intentionally public.
- Authentication routes and the login proxy were removed.
- Anonymous identity is used only for abuse quotas, not access authorization.
- The sync route remains unavailable on Vercel and is accepted only from a
  local development server.
- Request bodies are type-checked and size-limited before retrieval or model
  calls.
- Query traces are opt-in and store hashes and lengths rather than raw content.
- Rollback is code-only; no database or index migration is required.
