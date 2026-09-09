# First-time exporter enquiry

`POST /api/enquiries` remains the public submission endpoint. The existing enquiry fields and `description` stay required, so existing integrations continue to work. A new optional `enquiry.shipment` object captures structured exporter information. When supplied, it requires a cargo type and package type; all specialist information is optional.

```ts
shipment?: {
  cargoType: 'general_merchandise' | 'food_beverage' | 'textiles' | 'electronics' |
    'machinery' | 'automotive' | 'chemicals' | 'pharmaceuticals' | 'perishables' |
    'samples' | 'personal_effects' | 'other' | 'not_sure';
  goodsDescription?: string;
  packageType: 'boxes' | 'pallets' | 'container' | 'not_sure';
  quantity?: number;
  handling?: 'normal' | 'dangerous' | 'temperature_controlled' | 'not_sure';
  weight?: { value: number; unit: 'kg' | 'lb' } | { unknown: true };
  dimensions?: { length: number; width: number; height: number; unit: 'cm' | 'in' } | { unknown: true };
  seaContainer?: '20ft' | '40ft' | '40highcube' | 'not_sure';
  readiness?: { date: 'YYYY-MM-DD' } | { flexible: true };
  notes?: string;
}
```

The validated canonical values are stored in `shipment_details`. The owner mail maps them to cargo type, goods, package type/count, handling, total weight, dimensions per package, sea container, readiness, and notes. The customer acknowledgement contains the same summary with the reference and an explicit statement that it is neither a booking nor a price confirmation.

The server accepts only the documented cargo, package, handling, unit, container, and readiness values. It rejects unknown fields, invalid calendar dates, non-positive weight or dimensions, overlong text, unsupported control characters, and a sea-container selection for a non-sea move. Total weight refers to the complete shipment. Dimensions describe one package when packages are identical; different package sizes belong in notes. The request body remains capped at 16 KB, `description` at 2,000 characters, each structured text field at 1,000 characters, and package count at 1,000,000.

The validated structured value is saved in PostgreSQL as `enquiries.shipment_details` inside the same transaction as the enquiry, idempotency record, and two email-outbox jobs. This is durable server-side storage, not browser-only form state. The public route retains same-origin enforcement, its empty honeypot, UUID idempotency key, and global and per-email rate limits. A repeated key with the same validated payload returns the original reference; a changed payload returns a conflict and creates no further outbox work.

The owner notification and customer acknowledgement both include a clear structured shipment summary. Customer content is sent only to the submitted customer email; the owner message replies to the customer, and the acknowledgement replies to the configured business inbox. The mail transport always uses `MAIL_FROM` as the verified Navair sender, never the customer address. Templates are deterministic and personalized; no AI service or API key is needed.

## Route availability review

`routes.service_coverage` is an operations-maintained declaration with `supported`, `on_request`, `not_supported`, and `unknown` values. It is intentionally separate from `is_public`, route history, and the synthetic seed catalogue: none of those prove a route can be booked. New enquiries are classified inside `public.submit_enquiry`, so the browser cannot choose the result. Any coverage other than `supported`, including an unlisted route, is accepted and marked `route_availability_review`; the two existing outbox jobs are still created, with an explicit owner review flag and a customer acknowledgement that no service, booking, quote, or availability is confirmed. Operations should update `service_coverage` as their actual service list changes.

## Mail setup

Keep `MAIL_MODE=preview` for local review. Preview mode changes durable outbox jobs to `preview` and never calls Resend. To prepare a real environment, use a separate real-data database, verify a Navair-owned sending domain in Resend, then provide these server-only variables through the deployment secret store:

```text
MAIL_MODE=resend
RESEND_API_KEY=...
MAIL_FROM=Navair Logistics <operations@your-verified-navair-domain>
BUSINESS_EMAIL=operations@your-business-inbox
RESEND_WEBHOOK_SECRET=...
WORKER_ACTOR_ID=...
APP_URL=http://127.0.0.1:3001
```

`APP_URL` is the local runtime override for port 3001. `MAIL_TEST_RECIPIENT` is no longer set, so both enquiry emails reach their real recipients: the staff notification goes to `BUSINESS_EMAIL` with the enquirer as reply-to, and the acknowledgment goes to the address submitted in the form with `BUSINESS_EMAIL` as reply-to. Setting `MAIL_TEST_RECIPIENT` again restricts live delivery to that one inbox and fails every other recipient before transport, which suppresses customer acknowledgments. Preview jobs remain previews when the mode changes.

The initial questions follow common carrier quote flows: DHL requests shipment and package details before producing a quote, while Maersk explains that quote information is gathered around the shipment. See [DHL](https://www.dhl.com/discover/en-gb/ship-with-dhl/shipping-solutions/shipping-tools/mydhl-user-guides/get-rate-and-time-quote) and [Maersk](https://www.maersk.com/support/faqs/how-can-i-get-a-rate-quote).
