# Logistics Control Tower — design

Date: 2026-09-10
Status: approved to build, sequential stages

## Goal

Turn a visitor into a customer who contacts Navair, and give both sides one honest view of
a shipment: what will happen, when, and what actually happened. Three audiences share one
data model — a guest asking a question, a customer tracking cargo, and the desk running it.

## Decisions taken

| Decision | Choice | Why |
|---|---|---|
| Direct booking | All three tiers built: returning customer, any signed-in customer, guest with email confirmation | Client wants every path demonstrable; tier is recorded per booking so policy can tighten later without a rewrite |
| Lifecycle storage | Widen `shipments.status` enum | Chosen over a stage-plan overlay despite migration cost; one source of truth |
| Simulator | None. Staff advance stages from the control tower | Real operations update progress themselves; no fabricated events |

## Lifecycle

Canonical order, additive to the existing enum so historical rows stay valid:

```
accepted → booked → collected → at_origin_warehouse → packing
        → in_transit → hub_transfer → customs → out_for_delivery → delivered
cancelled: reachable from any non-terminal stage
```

Not every stage applies to every lane. `customs` is cross-border only; `hub_transfer`
applies where the itinerary has more than one leg. Staff may skip forward to any later
applicable stage rather than stepping strictly one at a time — an inapplicable stage must
never block a real shipment.

## Journey plan engine

One pure function serves the pre-booking timeline, the customer tracker and the desk view.

- **Input**: mode, transit days, cross-border flag, leg count, plus an anchor.
- **Anchor before booking**: the cargo-ready date; the plan ends where the durations land.
- **Anchor after booking**: `created_at` to `promised_at`, distributing stage weights
  proportionally, so the plan always ends on the date the customer was actually promised.
- **Output**: ordered applicable stages, each with an estimated date and plain-English label.
- **Overlay**: real `shipment_events` mark stages done, and the difference between a stage's
  event date and its planned date is reported as early or late.

Nothing is stored. The plan is recomputed and always agrees with the contract dates.

## Booking tiers

`public.booking_tier(email)` returns:

- `returning` — signed in, at least one previously accepted shipment
- `account` — signed in, no accepted history
- `guest` — not signed in

A guest booking is invisible to the desk until confirmed through a single-use, hashed,
48-hour token sent by email. Signed-in bookings are live immediately. A booking never sets
its own price: it records intent, the indicative figure the customer saw, and the tier, and
the desk confirms the real price. Money decisions stay human.

## Stages of work

1. Lifecycle enum migration + journey plan engine (pure, tested)
2. Pre-booking timeline in the exporter wizard and the forecast cockpit
3. Customer control tower: profile, every enquiry, journey tracker with plan and actuals
4. Admin control tower: portfolio KPIs, per-customer view, lane delay radar, stage controls
5. Booking paths for all three tiers, including guest confirmation
6. Guest-to-account claim, testable in demo mode, with feedback on what was linked
7. Conversion layer (contact prompts) and CLAUDE.md

## Constraints carried from the existing system

- Aggregates may leave the public functions; raw observation rows may not.
- RLS decides visibility. A new surface adds a policy or a `SECURITY DEFINER` aggregate,
  never a broad grant.
- Demo data stays labelled demo, and the demo deployment guard stays in place.
- The forecast is experimental and says so; a plan is an estimate, never a guarantee.
