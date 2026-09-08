# Navair Logistics

Local backend-first freight application with a minimal working frontend. Uses Next.js/TypeScript, PostgreSQL, server-validated sessions, a durable email outbox, and explicitly synthetic demonstration records. This is a local implementation, not a production deployment.

## Start locally

Requirements: Node 22.14+, npm, and PostgreSQL 16 binaries. On this machine PostgreSQL is installed at `/opt/homebrew/opt/postgresql@16/bin`. Set `PG_BIN` if your installation is elsewhere.

```sh
npm ci
npm run local
```

The setup creates an isolated PostgreSQL cluster in `.local/postgres`, binds it to `127.0.0.1:55439`, generates credentials in ignored `.env.local`, applies migrations, and inserts demo fixtures without clearing existing customer work. It does not use the machine's other PostgreSQL database. `npm run local` then starts both the application and mail worker; Ctrl+C stops both cleanly.

Open [the local application](http://127.0.0.1:3000). The worker moves queued messages to the local preview inbox. It never sends email with `MAIL_MODE=preview`. The owner can also process queued mail from the workspace. `npm run dev` and `npm run worker` remain available when either process needs to run separately.

To stop only this project's database:

```sh
/opt/homebrew/opt/postgresql@16/bin/pg_ctl -D .local/postgres stop
```

## Demonstrate the workflow

1. On Enquire, submit name, email, route, transport mode, and shipment details. Phone is optional. A successful response means the enquiry and email intentions are committed to the database.
2. Sign in using **Navair Owner** from the clearly labelled local demo profiles. Select the enquiry, assign it if needed, set the customer selling rate, private buying rate, charge unit, quantity, and promised date, then accept it.
3. Sign out and choose the matching demo customer profile. A newly submitted demo enquiry creates its customer profile automatically. Before acceptance the customer sees only a receipt/pending state. After acceptance they can open the journey, agreed customer price, forecast, and route conditions.
4. Use **Rishi Jain** for an already accepted sample air shipment; use **Saurabh Mehta** for an enquiry awaiting acceptance. Operations and sales profiles demonstrate restricted staff access.
5. The owner can grant/revoke staff permissions and disable staff. Staff access depends on both permission and assignment. Owner accounts cannot be altered through the staff-permission editor.
6. Update a shipment through its valid sequence. Actual delivery requires an actual date; the original promised date is retained. Delivery evidence is recorded by a database trigger and used in subsequent route summaries.

Demo profiles deliberately simulate identity for local review. They are not Google authentication. The endpoint is restricted to local hosts/development mode, demo sessions are rejected outside demo mode, and production API requests refuse `LOCAL_DEMO_MODE=true`.

## What is implemented

- Guest enquiries with server validation, request-size/rate controls, origin checks, transactional idempotency, and email intentions.
- Customer/staff/owner sessions with opaque random tokens, hashed database storage, HttpOnly cookies, expiration and logout.
- Google authorization-code/PKCE adapter through Supabase for a separately configured real environment. The callback verifies the user and provisions customer access only.
- Enquiry acceptance, assignments, restricted team permissions, shipment milestones, customer journeys, and staff commitments.
- Database row policies plus a separate private finance table. Customer-facing response contracts never include buying cost or margin.
- Sell-price and internal buy-cost forecast calculation from comparable dated records, with freshness/minimum-evidence gates, per-horizon residual ranges, and chronological holdout metrics. All model outputs remain experimental.
- Route summaries from deduplicated shipment evidence: delays, early arrivals, unresolved overdue shipments, stale/insufficient information, and allowlisted issue categories.
- Durable mail queue with preview mode, Resend adapter, stable send identifiers, retry/backoff, lease fencing, uncertain-send cutoff, raw signed webhook verification, deduplication and event reconciliation.
- Validated owner-only imports with private buying costs, idempotent source IDs, atomic batches and an audit entry.

## Bring in business records

Use the owner-only `POST /api/data/import` endpoint with the same-origin session or the local CLI:

```sh
npm run data:import -- /absolute/path/to/records.json
```

The CLI uses a configured `ACTOR_ID`; local demo mode may use the demo owner. Imports in demo mode remain labelled demo. Do not toggle a demo database into a live customer environment: create a separate database and apply migrations there.

Example JSON shape (replace the route ID with an ID from `/api/routes`; the dates and amounts below only demonstrate the format):

```json
{
  "routeId": "20000000-0000-4000-8000-000000000001",
  "prices": [
    { "sourceId": "import:invoice-001", "observedAt": "2026-09-01T10:00:00Z", "sellingPrice": 150, "buyingCost": 100, "currency": "INR", "unit": "kg" }
  ],
  "deliveries": [
    { "sourceId": "import:delivery-001", "promisedAt": "2026-08-28T10:00:00Z", "actualAt": "2026-08-30T10:00:00Z", "observedAt": "2026-08-30T12:00:00Z", "issue": "capacity" }
  ]
}
```

Supported initial modes: air, sea, road, courier, other; enquiries additionally accept unsure. Seeded routes are Delhi–Dubai, Mumbai–Jebel Ali, Delhi–Mumbai, and Bengaluru–Singapore. New routes can be created by accepting an enquiry. Comparability includes route, mode, unit and currency; real-world service/equipment/commodity normalization needs the actual dataset specification before operational forecast use.

## Verification

```sh
npm run typecheck
npm test
npm run build
# Requires the running local app and seeded data:
npm run test:smoke
```

Each `npm test` invocation creates a fresh temporary database, applies all migrations, runs the suite, and removes the database. It cannot process the application's email queue. The HTTP smoke walkthrough deliberately adds a labelled local demonstration customer/shipment to the running app.

Tests cover persistence, retry conflicts, acceptance gating, cross-customer access, private finance RLS, staff revocation, origin protection, forecast chronology/freshness and range behavior, radar deduplication/privacy, mail permission boundaries/leases/retries/webhooks, and import boundaries.

Dependency scripts are disabled by `.npmrc`. Installed packages are pinned and the lockfile is committed. Review any dependency script before enabling it; do not blanket-enable installation scripts.

## Real services and remaining launch work

The company still needs to supply actual records, domain and email identity, service accounts, staff ownership details, and shipment workflows. No real Google sign-in, carrier feed, or live email delivery has been verified.

For real email, verify a Navair-owned sending domain in Resend, configure its sender plus API/webhook keys and worker principal, and select `MAIL_MODE=resend`. The business inbox can be Gmail and need not match the sender domain. Review recipients/templates before enabling delivery. Preview jobs remain previews; they are not silently resent when live mode is enabled.

For Google, configure the provider/client in Supabase with exact callback destinations, set the server-side Supabase URL/publishable key, and test `/api/auth/google` through callback/logout against a fresh real-data environment. This application uses Supabase for identity and direct PostgreSQL connections for its data. A hosted Supabase database can be evaluated later; direct database roles/policies and connections must be migrated/tested explicitly.

Before production: implement and verify owner/staff onboarding and MFA/recovery, approve data retention and privacy text, protect the public email-triggering form against observed abuse, settle customer organization membership, validate real forecast performance, confirm carrier permissions, test backup restoration/load/monitoring, and select deployment infrastructure. The current local demo owner selector is deliberately not a production owner login.

The initial forecasts are transparent linear baselines, not validated market pricing. The interval level expresses uncertainty coverage and does not change the central estimate. A quote remains the agreed selling rate; a forecast does not change it. Historical fixtures age naturally, and stale data intentionally disables forecasts. Empty and sparse routes do not receive invented warnings or prices.

Architecture and earlier decisions: [project plan](tasks/plan.md), [local implementation scope](tasks/local-implementation.md).
