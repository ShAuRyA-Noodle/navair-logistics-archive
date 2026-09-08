CREATE TABLE public.city_aliases(alias text PRIMARY KEY,canonical_name text NOT NULL);
ALTER TABLE public.city_aliases ENABLE ROW LEVEL SECURITY;
CREATE POLICY aliases_read ON public.city_aliases FOR SELECT USING(true);
GRANT SELECT ON public.city_aliases TO navair_app;
INSERT INTO public.city_aliases(alias,canonical_name) VALUES('bombay','Mumbai'),('bangalore','Bengaluru');

-- The only anonymous evidence interface returns aggregates for published routes.
-- Source rows retain their existing RLS; small/stale cohorts expose no detailed statistics.
CREATE FUNCTION public.public_route_conditions(target uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH evidence AS (
  SELECT d.* FROM public.delivery_evidence d JOIN public.routes r ON r.id=d.route_id
  WHERE r.id=target AND r.is_public AND d.observed_at<=now()
    AND (d.observed_at>=now()-interval '30 days' OR d.promised_at>=now()-interval '30 days')
    AND ((d.actual_at IS NOT NULL AND d.actual_at<=now()) OR (d.actual_at IS NULL AND d.promised_at<now()))
 ), summary AS (
  SELECT count(*) AS total,
    count(*) FILTER(WHERE actual_at>promised_at) AS delayed,
    count(*) FILTER(WHERE actual_at<promised_at) AS early,
    count(*) FILTER(WHERE actual_at IS NULL) AS unresolved,
    percentile_cont(0.5) WITHIN GROUP(ORDER BY extract(epoch FROM actual_at-promised_at)/86400)
      FILTER(WHERE actual_at>promised_at) AS delay,
    bool_or(is_demo) AS demo,max(observed_at) AS latest,
    array_agg(DISTINCT lower(trim(issue))) FILTER(WHERE lower(trim(issue)) IN ('awaiting update','carrier capacity','customs hold','documentation','weather')) AS issues
  FROM evidence
 )
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM public.routes WHERE id=target AND is_public) THEN NULL
 WHEN total<5 OR latest<now()-interval '14 days' THEN jsonb_build_object(
  'status','insufficient_data','isDemo',coalesce(demo,false),'message','Not enough recent shared evidence to assess this route.','sampleCount',0,'delayedCount',0,'earlyCount',0,'unresolvedCount',0,'typicalDelayDays',NULL,'dataThrough',NULL,'issues','[]'::jsonb)
 ELSE jsonb_build_object(
  'status',CASE WHEN unresolved>0 OR delayed::numeric/total>=0.5 THEN 'elevated' WHEN delayed>0 THEN 'watch' ELSE 'clear' END,
  'isDemo',coalesce(demo,false),'sampleCount',total,'delayedCount',delayed,'earlyCount',early,'unresolvedCount',unresolved,
  'typicalDelayDays',round(delay::numeric,2),'dataThrough',to_char(latest AT TIME ZONE 'UTC','YYYY-MM-DD'),
  'issues',to_jsonb(coalesce(issues,ARRAY[]::text[])),
  'message',CASE WHEN unresolved>0 THEN 'Overdue shipments have been reported on this route.' WHEN delayed>0 THEN 'Recent shipments on this route have faced delays.' ELSE 'No delays were observed in the recent shared records; delivery timing is not guaranteed.' END)
 END FROM summary;
$$;
REVOKE ALL ON FUNCTION public.public_route_conditions(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_route_conditions(uuid) TO navair_app;
