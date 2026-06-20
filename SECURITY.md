# Security operations

## Required environment variables

The application fails closed until these values are configured:

```ini
AUTH_USERNAME=admin
AUTH_PASSWORD=<a unique high-entropy password>
AUTH_SESSION_SECRET=<at least 32 random characters>
API_SECRET_KEY=<newly issued model gateway key>
```

Generate the session secret locally:

```powershell
[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(48))
```

Never reuse `API_SECRET_KEY` as the login password or session secret.

## Credential rotation checklist

1. Revoke the exposed model gateway key with the gateway administrator.
2. Issue a new key and update `API_SECRET_KEY` in local and Vercel environments.
3. Generate new `AUTH_PASSWORD` and `AUTH_SESSION_SECRET` values.
4. Re-authenticate the Vercel CLI only when deploying.
5. Deploy, then verify that unauthenticated `/`, `/resources`, and `/api/*`
   requests are rejected.

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

## Rate limiting

The built-in limiter is per application instance and protects common abuse
without another service. For strict global quotas across multiple Vercel
instances, add a managed distributed limiter or Vercel Firewall rule.

## Decision log

- Authentication uses a single-user password and an HMAC-signed, HttpOnly,
  SameSite=Strict session cookie.
- Proxy redirects are only the first check; every protected API validates the
  session again.
- Request bodies are type-checked and size-limited before retrieval or model
  calls.
- Query traces are opt-in and store hashes and lengths rather than raw content.
- Rollback is code-only; no database or index migration is required.
