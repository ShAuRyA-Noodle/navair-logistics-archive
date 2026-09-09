-- Widen the shipment lifecycle so a customer can follow real progress: warehouse intake,
-- packing, a transfer hop and the final delivery run become first-class states rather than
-- prose inside an update note. Purely additive — every historical status stays legal, so
-- existing shipments and their evidence rows are untouched.
ALTER TABLE public.shipments DROP CONSTRAINT shipments_status_check;
ALTER TABLE public.shipments ADD CONSTRAINT shipments_status_check CHECK (status IN (
  'accepted','booked','collected','at_origin_warehouse','packing',
  'in_transit','hub_transfer','customs','out_for_delivery','delivered','cancelled'
));

-- Whether a lane crosses a border decides whether customs clearance belongs in its plan.
-- Nullable on purpose: an unstated flag means "nobody has declared this yet", which the
-- planner treats as "do not promise a customs step", not as "domestic".
ALTER TABLE public.routes ADD COLUMN cross_border boolean;

COMMENT ON COLUMN public.routes.cross_border IS 'True when the lane crosses a customs border. NULL means not yet declared by operations.';
COMMENT ON CONSTRAINT shipments_status_check ON public.shipments IS 'Lifecycle order lives in src/lib/lifecycle.ts; cancelled is reachable from any non-terminal stage.';
