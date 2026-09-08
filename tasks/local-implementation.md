# Local core implementation plan

> For agentic workers: use subagent-driven-development with bounded Terra implementation tasks; the primary agent owns identity, authorization, contracts, and integration review.

Goal: run the complete enquiry-to-accepted-customer journey locally using real PostgreSQL persistence and explicitly synthetic data.

Architecture: Next.js/TypeScript application with server-only domain services and PostgreSQL. Application sessions are opaque, hashed at rest, HttpOnly, and backed by active users. Local demo identities are a development-only adapter. Google OAuth uses Supabase when configured. Emails use a durable outbox and default to local preview; Resend requires explicit live configuration. No external emails are sent during development.

User decisions, 8 September 2026:
- No existing website; air, sea, road, courier and other/not-sure supported.
- Synthetic fixtures authorized for demonstrations; labels must be visible.
- Owner acceptance unlocks a customer's journey and selling-price forecast.
- Buying cost and profit information never appear in customer responses.
- Guest enquiry requires email and concise shipment details; phone optional.
- Owner manages a basic permission set and staff assignments.
- Local only; deployment and real records are future configuration work.

## File boundaries

`src/lib/db.ts`, `db/migrations/001_core.sql`: database access, transactional actor context and schema.
`src/lib/auth.ts`, `src/lib/http.ts`, `src/app/api/auth/**`: primary-agent-owned identity, sessions, origin checks and authorization.
`src/lib/operations.ts`, `src/app/api/**`: validated enquiry acceptance, customer journey, operational events and team updates.
`src/lib/analytics.ts`, `tests/analytics.test.ts`: pure sell-price forecasts and evidence-based radar.
`src/lib/mail.ts`, `scripts/worker.ts`, `tests/mail.test.ts`: outbox claim/send/retry and signed webhook processing.
`src/app/**`, `src/components/**`: simple functional form, customer portal and staff dashboard.
`scripts/local-db.ts`, `scripts/migrate.ts`, `scripts/seed.ts`: isolated local setup and explicitly demo seed data.
`tests/**`: behavior, integration and access-boundary tests.

## Ordered work

1. Foundation: pin packages, create an isolated local PostgreSQL cluster, migrations and a documented one-command startup. Verify database persistence and constrained application access.
2. Domain tests first: public enquiry persistence/idempotency, pending/accepted gating, customer cross-record denial, financial-field exclusion, role revocation and invalid state changes. Run `npm test` to observe failure before implementation.
3. Primary agent implements identity/auth HTTP guards and operations contracts. Demo identity endpoints must reject non-demo mode and non-local origins; real Google callback provisions customer identities only.
4. Terra implements analytics from an explicit contract with tests first. Forecast only comparable selling-price observations; 95% intervals wider than 80%; sparse data unavailable; radar deduplicates, expires and separates early, delayed and unresolved observations.
5. Terra implements email worker from an explicit contract with tests first. Save intent transactionally with enquiry; preview default; lock jobs; bounded retry; do not resend uncertain mail beyond provider idempotency window.
6. Terra implements the simple UI against settled API contracts. Form, local sign-in, owner acceptance, customer journey, selling-price chart, route evidence and owner permission editor must work with loading/error/empty states.
7. Primary agent integrates and runs `npm run typecheck`, `npm test`, `npm run build`, HTTP user journeys and direct database access tests. Independent spec review precedes quality/security review. Resolve material findings, then rerun affected checks.
8. Save README setup instructions, demo limitations, environment template and live-integration checklist. Show the running local URL, report actual evidence and outstanding company configuration.

## Acceptance examples

```ts
expect(customerResponse).not.toHaveProperty('buyingCost');
expect(pendingForecast.status).toBe(403);
expect(replayedEnquiry.id).toBe(originalEnquiry.id);
expect(otherCustomerJourney.status).toBe(404);
expect(forecast95.points[0].upper).toBeGreaterThan(forecast80.points[0].upper);
```

Use current primary documentation from `tasks/plan.md`, including Google PKCE, Next.js action authorization, Resend idempotency/webhooks and time-ordered forecast evaluation. Decisions supersede the earlier proposal where they differ. Real carrier feeds, production deployment, real Google OAuth completion and live mail deliverability cannot be claimed verified with mock data.
