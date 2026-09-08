# Navair Logistics — local delivery checklist

Updated 8 September 2026. The local core is implemented against the user's follow-up decisions. The original proposal in `plan.md` remains background research; `local-implementation.md` defines this delivery. No production deployment or real-provider verification is claimed.

## Completed locally

- [x] Inspect the empty workspace, installed Claude/Codex skills, and current primary documentation; use bounded Terra research and implementation agents with primary-agent architecture/authentication review.
- [x] Incorporate the user's freight modes, guest enquiry, owner acceptance, private pricing, synthetic demonstration, and local-first decisions.
- [x] Pin dependencies and establish an isolated PostgreSQL database, migrations, constrained runtime role, and reproducible setup.
- [x] Implement hashed opaque sessions, local-only demo identities, customer-only Google adapter, revocation checks, same-origin mutations, and database record restrictions.
- [x] Build a short guest form with optional phone and browser autofill, durable idempotent enquiries, assignments, and staff access controls.
- [x] Implement acceptance, immutable original promised dates, selling rates/quantity, separately stored private costs, valid shipment transitions, actual delivery, and commitments.
- [x] Implement durable email jobs, preview mode, retry/lease fencing, provider idempotency boundary, and signed/deduplicated webhook reconciliation.
- [x] Add owner-only atomic historical imports with explicit provenance and separate private buying costs.
- [x] Implement experimental selling and buying forecasts with comparable records, freshness/evidence gates, chronological evaluation, and uncertainty ranges.
- [x] Implement route radar from deduplicated delivery evidence, with early/late/unresolved states and honest insufficient-data behavior.
- [x] Build the minimal enquiry form, customer portal, owner/staff workspace, permission editor, and local mail previews.
- [x] Run independent specification and quality/security review; resolve confirmed findings and add focused regression coverage.
- [x] Verify database-backed tests, type checking, production compilation, and HTTP enquiry-to-delivery walkthrough.

## Requires company records or live configuration

- [ ] Obtain representative records and confirm route/service/equipment/commodity normalization, prices, units, and operational workflows.
- [ ] Configure and verify real Google OAuth in a fresh real-data environment.
- [ ] Implement and verify production owner bootstrap, staff invitation/onboarding, privileged MFA, and recovery.
- [ ] Verify a business sending domain, configure Resend credentials, and test real delivery/webhooks.
- [ ] Confirm customer organization membership, privacy/retention rules, enquiry wording, and abuse controls.
- [ ] Calibrate/validate forecasts and route evidence thresholds using real data before operational use.
- [ ] Connect approved carrier/tracking feeds if required; current evidence comes from saved events and imports.

## Later production/release scope

- [ ] Agree infrastructure, deployment budget, and operational ownership.
- [ ] Add CI, supported-browser/mobile testing, load tests, monitoring, and alerting.
- [ ] Verify backups and restore/release recovery drills.
- [ ] Implement any required quote revisions, document handling, invoices/payments, and conversion analytics as separately agreed features.
- [ ] Design the premium public frontend after the core workflow is reviewed.
