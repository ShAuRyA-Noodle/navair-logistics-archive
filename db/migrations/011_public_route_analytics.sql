-- Public lane analytics. A visitor may read a public lane's aggregate price history and
-- aggregate punctuality, because that describes the lane, not a customer. Raw rows stay
-- unreadable: no source ids, no shipment ids, no per-shipment dates, no customer link.
-- Every function below refuses a route that is not flagged public, and each returns
-- grouped values only, so opening these grants cannot expose an individual shipment.

CREATE FUNCTION public.public_route_price_weeks(target uuid, want_unit text, want_currency text)
RETURNS TABLE(week_start date, selling_price numeric, samples integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT (date_trunc('week', p.observed_at) AT TIME ZONE 'UTC')::date AS week_start,
         round(avg(p.selling_price), 2) AS selling_price,
         count(*)::integer AS samples
  FROM public.price_observations p
  JOIN public.routes r ON r.id = p.route_id
  WHERE r.id = target AND r.is_public
    AND p.unit = want_unit AND p.currency = want_currency
    AND p.observed_at <= now()
  GROUP BY 1
  ORDER BY 1
$$;

CREATE FUNCTION public.public_route_price_units(target uuid)
RETURNS TABLE(unit text, currency text, weeks integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT p.unit, p.currency, count(DISTINCT date_trunc('week', p.observed_at))::integer AS weeks
  FROM public.price_observations p
  JOIN public.routes r ON r.id = p.route_id
  WHERE r.id = target AND r.is_public AND p.observed_at <= now()
  GROUP BY p.unit, p.currency
  ORDER BY count(*) DESC, p.unit
$$;

-- Punctuality is grouped by promise date, never returned per shipment: a caller learns
-- that a lane ran three late deliveries on a given day, not which shipments they were.
CREATE FUNCTION public.public_route_delivery_days(target uuid, since_days integer DEFAULT 120)
RETURNS TABLE(promised_on date, deliveries integer, late integer, early integer, unresolved integer, delay_days numeric, issues text[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT (d.promised_at AT TIME ZONE 'UTC')::date AS promised_on,
         count(*)::integer AS deliveries,
         count(*) FILTER (WHERE d.actual_at > d.promised_at)::integer AS late,
         count(*) FILTER (WHERE d.actual_at < d.promised_at)::integer AS early,
         count(*) FILTER (WHERE d.actual_at IS NULL AND d.promised_at < now())::integer AS unresolved,
         round(avg(EXTRACT(EPOCH FROM (d.actual_at - d.promised_at)) / 86400) FILTER (WHERE d.actual_at IS NOT NULL), 2) AS delay_days,
         coalesce(array_agg(DISTINCT d.issue) FILTER (WHERE d.issue IS NOT NULL), '{}') AS issues
  FROM public.delivery_evidence d
  JOIN public.routes r ON r.id = d.route_id
  WHERE r.id = target AND r.is_public
    AND d.promised_at >= now() - make_interval(days => greatest(1, least(400, since_days)))
  GROUP BY 1
  ORDER BY 1
$$;

REVOKE ALL ON FUNCTION public.public_route_price_weeks(uuid,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.public_route_price_units(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.public_route_delivery_days(uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_route_price_weeks(uuid,text,text) TO navair_app;
GRANT EXECUTE ON FUNCTION public.public_route_price_units(uuid) TO navair_app;
GRANT EXECUTE ON FUNCTION public.public_route_delivery_days(uuid,integer) TO navair_app;
