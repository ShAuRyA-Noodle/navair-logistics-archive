-- Three changes, all about not losing news.
--
-- 1. Every event carries a short India note, whatever its score. A minor tariff filing
--    still deserves one line saying what it means here, rather than being invisible.
-- 2. The feed reads chronologically and includes archived events, so nothing drops off
--    the page as newer items arrive. Archiving now only means "older", not "hidden".
-- 3. Pagination replaces the silent truncation that was cutting the tail off the list.

ALTER TABLE public.news_events ADD COLUMN india_note text;
ALTER TABLE public.news_events ADD COLUMN india_note_model text;
ALTER TABLE public.news_events ADD COLUMN india_note_at timestamptz;

COMMENT ON COLUMN public.news_events.india_note IS 'One or two plain sentences on what this means for Indian trade. Written for every event regardless of importance.';

CREATE INDEX news_event_recent_idx ON public.news_events(last_seen DESC);

-- Replaces public_event_teasers. Chronological, includes archived, and paginates rather
-- than truncating. The old function is kept so nothing breaks mid-deploy.
CREATE FUNCTION public.public_news_feed(limit_count integer DEFAULT 40, offset_count integer DEFAULT 0)
RETURNS TABLE(event_id uuid, slug text, title text, summary text, importance smallint,
              topics text[], corridors text[], chokepoints text[], last_seen timestamptz,
              status text, india_note text, worst_severity text, corridor_count integer,
              teaser text, source_count integer, total_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT e.id, e.slug, e.title, e.summary, e.importance, e.topics, e.corridors, e.chokepoints,
         e.last_seen, e.status, e.india_note,
         (SELECT i.severity FROM public.event_impacts i WHERE i.event_id = e.id
           ORDER BY array_position(ARRAY['severe','elevated','watch','none'], i.severity) LIMIT 1),
         (SELECT count(*)::integer FROM public.event_impacts i WHERE i.event_id = e.id),
         (SELECT i.teaser FROM public.event_impacts i WHERE i.event_id = e.id
           ORDER BY array_position(ARRAY['severe','elevated','watch','none'], i.severity) LIMIT 1),
         e.item_count,
         count(*) OVER ()
  FROM public.news_events e
  ORDER BY e.last_seen DESC, e.importance DESC
  LIMIT greatest(1, least(100, limit_count)) OFFSET greatest(0, offset_count)
$$;

REVOKE ALL ON FUNCTION public.public_news_feed(integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_news_feed(integer,integer) TO navair_app;
