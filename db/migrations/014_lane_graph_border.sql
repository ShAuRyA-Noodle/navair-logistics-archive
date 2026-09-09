-- The public lane graph now carries the border flag, because the journey planner needs it
-- to decide whether a customs stage belongs in a timeline shown before booking. Postgres
-- refuses to replace a function whose OUT row type changes, so the old one is dropped
-- first; nothing depends on it but application code, which ships with this migration.
DROP FUNCTION IF EXISTS public.public_lane_graph();

CREATE FUNCTION public.public_lane_graph()
RETURNS TABLE(id uuid, origin text, destination text, mode text, unit text, service_coverage text, distance_km integer, transit_days integer, cross_border boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT r.id, r.origin, r.destination, r.mode, r.unit, r.service_coverage, r.distance_km, r.transit_days, r.cross_border
  FROM public.routes r
  WHERE r.is_public AND r.service_coverage <> 'not_supported'
  ORDER BY r.origin, r.destination, r.mode
$$;

REVOKE ALL ON FUNCTION public.public_lane_graph() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_lane_graph() TO navair_app;
