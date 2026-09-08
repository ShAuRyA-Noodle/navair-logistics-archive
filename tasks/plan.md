# Navair Logistics — proposed backend-first product plan

Prepared 8 September 2026 as the original research proposal. The user subsequently approved a local core with labelled synthetic data; that implementation now exists. See `local-implementation.md`, `todo.md`, and the root README for the accepted scope, current status, verification, and remaining production work. The proposals below are preserved as decision context, not a claim that every proposed feature is delivered.

## What we are building

A visitor can ask for export help quickly. Navair receives the enquiry, assigns it to a teammate, prepares a quote, records a confirmed shipment, and follows through on delivery and customer commitments. Customers can sign in to see their own information. Real shipment and price history will power route warnings and price forecasts. The first interface will be simple, mobile-friendly, accessible, and fully connected to the backend; visual design comes later.

The interpretation of the user's repeated instruction is: no fabricated operational results presented as real. Test fixtures may contain invented records only in isolated, visibly labelled test environments. Code necessarily contains business rules; operational prices, alerts, users, orders, and statistics come from stored records and versioned calculations.

## Proposed choices and alternatives

| Approach | What it means | Trade-off |
|---|---|---|
| Recommended: Next.js/TypeScript + Supabase Postgres/Auth + Resend | One application with clear feature boundaries, managed database and identity, background processing for email and analytics | Fewer systems to maintain; we still own permissions, validation, monitoring, and recovery |
| Next.js + Clerk + Supabase database | Dedicated identity product plus a separate database integration | Useful if its account-management experience is a business requirement; more integration and configuration |
| Self-hosted application/database | Operate the application and infrastructure on a suitable server | More control, but also patching, backups, monitoring, scaling, and incident work |

Supabase supports [Google sign-in](https://supabase.com/docs/guides/auth/social-login/auth-google) and a [Clerk integration](https://supabase.com/docs/guides/auth/third-party/clerk). My recommendation is one identity provider for the first release. Hosting remains subject to budget, existing arrangements, region, and runtime requirements. A Hostinger domain can remain where it is; assess the actual hosting product before selecting its application runtime. Next.js supports [Node.js and Docker deployment](https://nextjs.org/docs/app/getting-started/deploying).

Use a modular monolith: one product whose identity, enquiries, shipments, notifications, and analytics modules have explicit contracts. Add a separate long-running computation worker only if forecast workload needs it. Avoid choosing multiple databases, orchestration products, or an AI model before there is a demonstrated requirement. Pin supported library/runtime versions when implementation starts, against current official documentation.

## Capability map and dependency order

| Module ID | Owns | Depends on |
|---|---|---|
| identity-access | Accounts, staff invitations, permissions, sessions | Foundation |
| enquiries | Guest form, saved leads, assignment | Foundation; identity-access for staff views |
| notifications | Durable delivery jobs, email status | Foundation; receives committed events from other modules |
| operations | Quotes, accepted bookings, shipment events, commitments | identity-access, enquiries |
| data-ingestion | Import batches, normalization, provenance | operations |
| route-radar | Evidence summaries and route advisories | data-ingestion, identity-access |
| price-forecast | Comparable price histories, evaluated forecasts | data-ingestion, identity-access |

Build complete user journeys one at a time: foundation → sign-in/permissions → enquiry-to-dashboard-to-email → operational tracking/import → radar → forecast → launch verification. Forecast and radar analysis can proceed independently after their shared data contract is settled. Database migrations and shared-contract changes have one coordinating owner.

## 1. First-time exporter mode

Proposed required fields: name, email, origin city/country, destination city/country, and a short “What do you want to send?” description. Phone, company, mode, approximate quantity/weight, and ready date are optional initially; mode includes “Not sure.” Visitors asking for help may leave route details as “Not decided yet.” Confirm final required fields with Navair. Do not require an account or export-document expertise to ask for assistance.

Support browser autofill for name/email/phone/company, appropriate phone keyboards, visible labels, helpful errors, keyboard access, and preservation of entries after validation failures. A website cannot silently read an iPhone or Android's saved personal details. The browser may offer them to the visitor through [standard autocomplete fields](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/autocomplete). Shipment routes must not accidentally be autofilled with the visitor's home address.

Submission flow:

1. Validate allowed fields, sizes, email structure, and abuse signals on the server.
2. Atomically save the enquiry and two email intentions: one for Navair, one for the visitor.
3. Show a reference and confirmation only after the database commit succeeds.
4. A background worker sends a structured, personalized summary to the configured business inbox and a receipt acknowledgment to the visitor.
5. Staff see the lead even if email fails. Failed deliveries have a visible retry/review state.

Personalization uses the submitted name, route, and cargo details in reviewed templates. A text-generation service is unnecessary for this first workflow. The acknowledgment confirms receipt, never a booking, a price, customs clearance, or an unapproved response-time promise. Navair can edit its acknowledgment template and business contact settings with appropriate permissions and an audit record.

Use a Navair-owned, verified sending domain. Gmail can be the recipient. For staff notifications, Reply-To can be the validated visitor email; for visitor acknowledgments, Reply-To is Navair's business inbox. [Resend domain documentation](https://resend.com/docs/dashboard/domains/introduction) describes the required DNS setup. Receiving these messages does not require access to Navair's Gmail mailbox.

Reliability contract: one submission intent has one stable idempotency key, atomically claimed with a payload hash. Replays return the original result; conflicting payloads are rejected. Distinct genuine enquiries remain distinct. Email jobs have separate stable keys, retry limits, backoff, and durable state. [Resend's provider deduplication lasts 24 hours](https://resend.com/docs/dashboard/emails/idempotency-keys); an ambiguous send beyond that window must be reconciled or reviewed instead of blindly resent. Do not promise mathematically exact-once delivery across external systems.

Verify provider webhook signatures on the raw body, deduplicate events, tolerate out-of-order notifications, and distinguish submitted/sent/delivered/bounced/failed. Delivered means the recipient mail server accepted it, not that a human read it. Follow [Resend verification](https://resend.com/docs/webhooks/verify-webhooks-requests) and [delivery semantics](https://resend.com/docs/webhooks/introduction).

Layer abuse controls: request/body limits, shared rate-limit storage, per-recipient throttling, honeypot as a signal, and adaptive bot challenges. Fast autofill alone must not cause rejection. A public acknowledgment endpoint must not become an email-spam relay. Avoid echoing arbitrary long visitor text into an unsolicited acknowledgment. Show a clear privacy notice; marketing permission is separate.

Measure form starts, successful submissions, staff first response, qualified leads, and accepted bookings using minimized analytics. Establish a baseline before setting a conversion-improvement target.

## 2. Accounts and access

Google sign-in identifies a person; it does not grant staff access. A public signup creates a customer identity with no staff membership. Staff join through an expiring, single-use invitation issued by an authorized administrator. Bootstrap the initial owner explicitly; never make the first public signup an administrator.

Recommended starting roles:

| Role | Default scope |
|---|---|
| Owner | Business settings, team access, all authorized records, ownership transfer |
| Manager | Operational oversight and assignment, with separately granted financial access |
| Operations | Assigned shipments and commitments; no buying costs/margins by default |
| Sales | Assigned enquiries, customer contact, and permitted selling quotes |
| Customer | Their linked organization's permitted enquiries/shipments only |

Navair can configure approved permission options: view, create, update, assign, financial access, and export. Record scope can be assigned records, a branch/team, or all authorized business records. Start with this bounded permission matrix rather than an arbitrary policy programming interface. Limit who may grant access, prevent self-promotion and removal of the last owner, and audit changes.

Enforce permissions in every backend operation and in database policies. [OWASP recommends denial by default and checking each request](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html). Database [row policies](https://supabase.com/docs/guides/database/postgres/row-level-security) determine whose records are accessible; restricted finance fields need separate tables or [column privileges](https://supabase.com/docs/guides/database/postgres/column-level-security), plus allowlisted response fields. Hiding a frontend column is insufficient.

Use current membership/assignment records for authorization so a revoked teammate loses access without waiting for old role claims to expire. Never trust roles from editable profile metadata. Check activity status for all protected requests. Private files, if added later, require matching permission checks and short-lived links. Raw community records never become publicly readable.

Use Google's documented authorization-code/PKCE flow, strict callback destinations, and verified identities. Follow [Supabase's server authentication guidance](https://supabase.com/docs/guides/auth/server-side/creating-a-client): validate identity with getClaims/getUser as appropriate; do not authorize from an unverified getSession user object. Decide the cookie/session pattern in the identity specification: standard browser-assisted Supabase SSR and a server-only HttpOnly session have different refresh mechanics, so their examples must not be combined casually. Require a tested provider-supported flow, HTTPS, safe cookie settings, CSRF protection, session-expiry handling, and no caching of private responses across users.

Require [MFA](https://supabase.com/docs/guides/auth/auth-mfa) for privileged staff, with a documented recovery process. Service credentials stay server-side and are limited to narrow background/administrative work. Normal user operations retain the user's database context. A guest enquiry insert must use a narrowly scoped operation and must not grant anonymous read/update access. A guest reference number or matching unverified email is not sufficient proof to claim historical enquiries.

## 3. Staff dashboard and customer area

The simple dashboard shows new/unassigned leads, today's follow-ups, upcoming promised actions, overdue commitments, active shipments, and items needing attention. Lists support filters and pagination. Every commitment has an owner, a due time, status, and related lead/shipment.

Proposed commercial journey: new enquiry → contacted → quote prepared → quote sent → accepted/declined → booked shipment. A quote is versioned and has a validity date, currency, charge basis, and exclusions. Acceptance records the exact version. A booking and a carrier-confirmed shipment are separate states; do not imply carrier confirmation from a staff button alone.

Shipment progress records planned, estimated, and actual events. Preserve the original promised delivery date when estimates change, otherwise a delayed shipment can misleadingly appear on time. Preserve cancellations, corrections, and who changed each item. Use concurrency checks so two teammates cannot silently overwrite each other.

Customers see only their linked records and approved customer-facing updates. Internal notes, staff workload, carrier buying rates, and other customers' activity remain private. Payments, invoicing, document uploads, WhatsApp, and customs-document automation require scope confirmation and are proposed later additions.

## 4. Data foundation

Start with validated staff entry and previewable imports from Navair's actual records. Carrier APIs are added when account access, permitted use, and coverage are known. Manual data remains a valid source, explicitly labelled with who supplied it and when; it is not described as a live carrier feed.

| Record family | Facts to retain |
|---|---|
| Identities and memberships | User, organization, staff/customer relationship, activity, permissions, invitations |
| Commercial records | Enquiry, assignment, quote versions, accepted booking, next action |
| Shipments | Stable source ID, customer, directional route, mode, carrier/service, cargo category, quantity and unit |
| Events | Original promise, planned/estimated/actual event times, timezone, occurrence and receipt times, source, corrections |
| Prices | Buy/sell distinction, quoted/booked/final status, amount, currency, charge unit, surcharges, inclusion/exclusion basis, effective date |
| Reliability and analytics | Import batch/errors, reports/evidence, alert snapshots, model runs, email jobs/events, audit trail |

Do not mix a price per kilogram with a price per container, reverse routes, air and sea, or quoted and paid prices. Keep customer selling prices separate from carrier buying costs. Use exact decimal monetary storage and explicit rounding rules. Convert currencies only with a dated, recorded exchange-rate source; otherwise segment by currency.

Imports must show a preview and validation failures, enforce deduplication, identify ambiguous locations, and retain provenance. Raw imports may contain personal data, so access and retention apply. For future ocean integrations, consult [DCSA Track & Trace](https://developer.dcsa.org/implementing-track-and-trace). For air, [IATA ONE Record](https://www.iata.org/one-record) supplies an interoperability model, not automatic access to carrier data.

## 5. Community congestion radar

When someone selects a route, the server retrieves a recent evidence summary for that directional route and compatible transport/service category. The summary can describe delays, unusually early deliveries, or corroborated operational issues. An on-time destination arrival is different from customs clearance or final delivery.

Use verified shipment milestones first. Customer reports must be tied to a shipment they are entitled to report on. Count each underlying shipment once even if both its carrier feed and its customer report mention the same delay. Review conflicting or unsupported allegations; keep reported causes separate from confirmed causes.

Compute delayed counts against all comparable, sufficiently observed shipments in the chosen period, not only people who complained. In-progress overdue shipments have a separate unresolved state: they must not vanish from the analysis or be assigned a made-up final delay. Separate missing tracking updates from proven delay. Two complaints can prompt an internal watch; they do not automatically justify a broad public two-day prediction.

Display the issue, recent evidence window, freshness, and a privacy-safe evidence count/band. Where supported, show a typical observed delay range and explain that it describes recent shipments. Suppress small cohorts and restrictive filters that could reveal individuals. Never publish names, shipment IDs, raw reports, customer prices, or free text.

Thresholds, lookback periods, independent-source requirements, expiration, and change hysteresis are versioned configuration chosen after reviewing actual volumes. Scheduled reconciliation corrects missed events; committed new evidence triggers recalculation. A proposed initial freshness target is recalculation within five minutes of data reaching our system, measured in staging. External reporting can still be delayed, and that age must be visible.

Alerts expire, resolve, and can be corrected. No evidence means “insufficient recent information,” not “route is safe.” Staff-authored operational advisories are separately labelled, attributable, and time-limited. Generalize the rules across supported routes; do not write route-specific fictional outcomes.

## 6. Trend forecast analyzer

The user chooses route, mode/service, comparable shipment size or rate unit, and a horizon up to eight weeks. The chart shows actual historical observations followed by estimated future rates, with an uncertainty band. It states whether it is estimating Navair buying cost or customer selling price, and whether the target is a typical weekly rate or an individual shipment price. These targets are not interchangeable.

A confidence selector chooses interval coverage, initially 80% or 95%. Higher coverage normally widens the band while preserving the central estimate for the same model run. It does not make the underlying model more accurate. Forecast ranges express uncertainty, as described in [Forecasting: Principles and Practice](https://otexts.com/fpp3/prediction-intervals.html). Show current comparable reference rate, estimated amount/percentage change, currency/unit, included charges, data-through date, and available horizon. A forecast is not a binding quote.

Start with transparent last-observed/seasonal baselines, then evaluate suitable statistical candidates. Select the model after the data audit; do not prescribe complex machine learning just to produce a chart. Compare forecasts against later real outcomes using [rolling-origin evaluation](https://otexts.com/fpp3/tscv.html), separately for each forecast horizon. Features must be limited to what was actually known at the time; final invoices or revised tracking events received later cannot leak into an earlier forecast.

Measure absolute error, improvement against the baseline, interval coverage and width, missingness, and freshness. Record the model/rule version, training cutoff, source snapshot, and evaluation results. Model release requires agreed accuracy and interval-calibration tolerances, enough independent time periods to evaluate them, and acceptable performance for each enabled segment. A universal shipment count does not establish readiness.

If evidence is insufficient or performance deteriorates, show historical observations and an unavailable/experimental state as appropriate. Broader corridor benchmarks, if later introduced, must be labelled as such. External market data needs verified coverage and licensing; it is not interchangeable with Navair's prices. Do not publish confidential buying rates through a public forecast.

## 7. Engineering and launch standard

Define typed request/response contracts before implementation, consistent error codes, bounded pagination, input limits, and retry semantics. Validate both user input and third-party responses. Keep business logic in focused server modules. Follow the [Next.js data-security guide](https://nextjs.org/docs/app/guides/data-security): page visibility alone does not protect an action; every action verifies authorization and ownership.

Use reviewed database migrations, separate development/staging/production, isolated test data and email sinks, secret management, reproducible dependency installs, and CI checks. Background processing can use [Supabase Queues](https://supabase.com/docs/guides/queues) and [Cron](https://supabase.com/docs/guides/cron) after worker/runtime limits are verified. Queue delivery does not remove the need for idempotent side effects.

Threat cases and launch proofs:

| Risk | Required evidence |
|---|---|
| Customer opens another customer's shipment | Direct API, database-policy, and attachment checks reject access |
| Staff role or assignment is revoked | The next protected request loses that access, including direct API reads |
| Restricted finance leaks | Read, export, search, aggregate, and error responses exclude prohibited fields |
| Form retries or mail outage | One saved enquiry per intent; restart/retry tests retain jobs and expose failures |
| Forged or repeated webhook | Signature validation and event uniqueness reject spoof/replay effects |
| False route signal | Duplicate, stale, small-cohort, conflicting, corrected, and incomplete data cases tested |
| Misleading forecast | Future-data leakage tests and horizon-specific backtest report pass publication gates |
| Data loss or failed release | Restore drill and application/database rollback or forward-recovery rehearsal succeed |

Add privacy-safe error logs and alerts for failed jobs, stale data feeds, permission failures, and unhealthy endpoints. Audit sensitive business changes without recording credentials or dumping personal data. Agree retention, deletion/export procedures, data-storage region, and backup treatment with the business before launch; no jurisdictional compliance claim is made by this plan.

Agree expected traffic, availability, maximum acceptable data loss, and recovery time before selecting the paid deployment/backup setup. [Supabase's production checklist](https://supabase.com/docs/guides/deployment/going-into-prod) and [backup documentation](https://supabase.com/docs/guides/platform/backups) are release inputs. Database backups do not substitute for separately verifying uploaded-file recovery if files are later added.

## 8. Delivery phases and verification

| Phase | Working outcome | Verification and documentation guard |
|---|---|---|
| 0 — discovery | Reviewed scope, actual data sample, access map, provider choices | Official docs above; no invented APIs, credentials, or model-readiness claims |
| 1 — identity | Customer can sign in; invited staff can enter permitted area | Google PKCE/SSR patterns; isolation, escalation, revocation, MFA and expiry tests |
| 2 — conversion | Guest enquiry appears in dashboard and creates reliable emails | Resend send/webhook docs; real staging delivery, duplicate/crash/outage tests |
| 3 — operations | Staff manages follow-ups, quote versions, bookings, actual shipment history | Contract-first API and ingestion specs; valid transitions, import deduplication, concurrent-edit tests |
| 4 — radar | Supported routes show evidence-backed, expiring notices | Event normalization docs; observed data, privacy and refresh gates |
| 5 — forecast | Qualified segments show evaluated estimates and intervals | OTexts evaluation methodology; leakage, baseline and coverage checks |
| 6 — release | Simple complete frontend on operationally supported infrastructure | Build/static checks, browser journeys, load tests at agreed scale, recovery drill, runbook |

Each phase will be decomposed into small implementation tasks once its specification and concrete stack are settled. Proposed work is tracked in `tasks/todo.md`. No command names or file-level implementation claims are invented for an empty repository.

## 9. Installed skills and delegation

Three Terra agents performed bounded research: forecast/radar sources, exporter/email sources, and local skill inventory. The primary agent authored the architecture, access design, trade-offs, and this plan.

Relevant existing Claude skills are in `/Users/shauryapunj/.claude/skills/`: `api-and-interface-design`, `security-and-hardening`, `spec-driven-development`, `planning-and-task-breakdown`, `tdd-agent-skills`, `incremental-implementation`, `source-driven-development`, `code-review-and-quality`, and `documentation-and-adrs`. The first four were read for this proposal. Their contributions include contract-first APIs, threat cases, atomic idempotency, small verifiable slices, and explicit reviewable assumptions.

Codex's installed `brainstorming` and `make-plan` were used for discovery and synthesis. During implementation, use the relevant testing, debugging, review, and verification skills when their work starts. Avoid duplicate competing workflows, irrelevant design tools, or copying unverified snippets as production code. Existing skills can be read and applied without reinstalling them. New skill sources have not yet been provided, so nothing new was installed. Inspect supplied skills and dependencies before installation, then verify their availability.

## 10. Questions and setup information

All questions were sent together; this proposal uses stated defaults until answered:

1. Current website, actual services/modes, launch countries and routes.
2. Existing records/source systems, shipment counts, history duration, prices and promised/actual date completeness.
3. Forecast buying cost or selling price; staff or customer audience; rate unit and shipment basis.
4. Current enquiry-to-delivery workflow, first-release quote/booking/tracking/payment scope, and who supplies status updates.
5. Initial owner, team roles, record/field/export restrictions, and customer-account scope.
6. Required form fields, destination business inbox, approved acknowledgment and realistic response commitment.
7. Launch date, budget, traffic/team size, domain/hosting arrangements, data region and recovery needs.
8. Names/links for additional skills to install.

Implementation setup will need client-owned hosting and Supabase projects, a Google OAuth project/client configuration, a Resend account and scoped sending key, webhook secret, verified sender-domain DNS, and configured business inbox. Carrier/data-provider credentials are needed only for selected integrations. Put secrets into local ignored configuration or the provider's secret manager, not the plan or conversation. No API key is needed to approve the product direction.
