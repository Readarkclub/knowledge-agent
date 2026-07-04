# Public access with layered abuse protection

## Background

- The knowledge base content may be public.
- The previous single-user password added friction mainly to protect the model
  gateway token from automated abuse.
- Success means public browsing without credentials while expensive endpoints
  retain cross-instance quotas and a hard daily circuit breaker.

## Previous behavior

- A fixed username and password issued a 12-hour signed session cookie.
- Proxy redirected all pages and APIs to `/login`.
- API limits lived in an in-memory map and were reset by Vercel cold starts or
  spread across instances.

## Decision

- Remove password login, logout, page guards, and the global auth proxy.
- Keep `/`, `/resources`, `/api/status`, and their content publicly readable.
- Protect `/api/chat` and `/api/search` with Vercel BotID Basic.
- Issue a signed 30-day anonymous visitor cookie for quota identity.
- Use Upstash Redis for visitor, IP/user-agent fingerprint, and global daily
  quotas.
- Apply a Vercel Firewall burst rule to `POST /api/chat`: 10 requests per
  60 seconds keyed by IP and JA4.
- Default chat quotas: 5/minute, 30/day per visitor, 60/day per fingerprint,
  and 500/day globally.
- Cap generated answers at 2048 output tokens.
- Fail closed for costly APIs when BotID, Redis, or the visitor secret is not
  available in production.

## Rejected alternatives

- CAPTCHA only: real users, solver services, and distributed browsers can still
  drain the model budget.
- In-memory rate limiting only: it is not global across Vercel instances and
  resets on cold starts.
- Public unrestricted API: simplest UX, but no reliable cost ceiling.

## Risks and mitigation

- Shared networks may hit fingerprint limits: visitor quotas are primary and
  fingerprint limits are intentionally wider.
- Redis outage blocks chat and search: browsing remains available and the
  failure is explicit rather than silently exposing the model key.
- Cookie clearing rotates visitor identity: fingerprint and global quotas plus
  the Vercel IP/JA4 rule provide additional layers.

## Rollback

- Revert the code change to restore password authentication.
- Remove the `Knowledge Chat Burst Limit` rule from Vercel Firewall.
- Disconnect the Upstash Marketplace resource if it is no longer needed.
- No database or knowledge-index migration is involved.
