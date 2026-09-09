-- Lane geometry. Transit days and distance let the analyzer state a timeline and let the
-- planner stitch legs together when no direct service exists. Both stay nullable: a real
-- imported lane may not carry them, and an absent value must read as "not stated" rather
-- than as a promise of zero days.
ALTER TABLE public.routes ADD COLUMN distance_km integer CHECK (distance_km IS NULL OR distance_km >= 0);
ALTER TABLE public.routes ADD COLUMN transit_days integer CHECK (transit_days IS NULL OR (transit_days > 0 AND transit_days <= 120));

-- The public lane graph. Origin, destination, mode and headline timings are already
-- public catalog facts (routes.is_public); exposing them as one call lets the planner
-- build connecting itineraries without reading anything customer-specific.
CREATE FUNCTION public.public_lane_graph()
RETURNS TABLE(id uuid, origin text, destination text, mode text, unit text, service_coverage text, distance_km integer, transit_days integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT r.id, r.origin, r.destination, r.mode, r.unit, r.service_coverage, r.distance_km, r.transit_days
  FROM public.routes r
  WHERE r.is_public AND r.service_coverage <> 'not_supported'
  ORDER BY r.origin, r.destination, r.mode
$$;

REVOKE ALL ON FUNCTION public.public_lane_graph() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_lane_graph() TO navair_app;
