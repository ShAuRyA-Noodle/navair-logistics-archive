-- Analysis is public for the demo. Rather than loosening the row policy - which would make
-- re-gating a second migration - the rows leave through a SECURITY DEFINER function that
-- the application calls only while NEWS_PUBLIC_ANALYSIS is on. The restrictive policy on
-- event_impacts stays exactly as it was, so turning the paywall back on is an env change.
CREATE FUNCTION public.public_event_impacts(event_slug text)
RETURNS TABLE(corridor text, severity text, headline text, teaser text, body text,
              actions jsonb, confidence text, detail jsonb, model text, generated_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT i.corridor, i.severity, i.headline, i.teaser, i.body,
         i.actions, i.confidence, i.detail, i.model, i.generated_at
  FROM public.event_impacts i
  JOIN public.news_events e ON e.id = i.event_id
  WHERE e.slug = event_slug AND e.status = 'active'
$$;

REVOKE ALL ON FUNCTION public.public_event_impacts(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_event_impacts(text) TO navair_app;
