-- Trade intelligence: world events that change how cargo moves, and what they mean for the
-- corridors Navair actually serves.
--
-- Three layers, deliberately separate:
--   news_items    raw fetched records, one row per article or measurement
--   news_events   items clustered into one real-world occurrence
--   event_impacts one AI analysis per (event, corridor) - the cache that keeps cost sane
--
-- The analysis layer never touches price_observations or the forecast. A model's opinion
-- about the world must not silently move a number that was earned by backtesting.

CREATE TABLE public.news_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_key text NOT NULL,
  external_id text NOT NULL,
  url text,
  title text NOT NULL,
  summary text,
  published_at timestamptz NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  topics text[] NOT NULL DEFAULT '{}',
  regions text[] NOT NULL DEFAULT '{}',
  chokepoints text[] NOT NULL DEFAULT '{}',
  relevance numeric(5,2) NOT NULL CHECK (relevance >= 0),
  trust smallint NOT NULL CHECK (trust BETWEEN 1 AND 5),
  event_id uuid,
  measurement jsonb,
  UNIQUE (source_key, external_id)
);

CREATE TABLE public.news_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  title text NOT NULL,
  summary text NOT NULL,
  topics text[] NOT NULL DEFAULT '{}',
  regions text[] NOT NULL DEFAULT '{}',
  chokepoints text[] NOT NULL DEFAULT '{}',
  corridors text[] NOT NULL DEFAULT '{}',
  importance smallint NOT NULL CHECK (importance BETWEEN 1 AND 10),
  item_count integer NOT NULL DEFAULT 0,
  first_seen timestamptz NOT NULL,
  last_seen timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.news_items ADD CONSTRAINT news_items_event_fk FOREIGN KEY (event_id) REFERENCES public.news_events(id) ON DELETE SET NULL;

-- One analysis per event and corridor, never per user. An event affecting the India-to-Gulf
-- sea corridor is analysed once and read by everyone whose cargo moves on it.
CREATE TABLE public.event_impacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.news_events(id) ON DELETE CASCADE,
  corridor text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('none','watch','elevated','severe')),
  headline text NOT NULL,
  teaser text NOT NULL,
  body text NOT NULL,
  actions jsonb NOT NULL DEFAULT '[]',
  confidence text NOT NULL CHECK (confidence IN ('low','medium','high')),
  citations jsonb NOT NULL DEFAULT '[]',
  model text NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, corridor)
);

CREATE INDEX news_item_published_idx ON public.news_items(published_at DESC);
CREATE INDEX news_item_event_idx ON public.news_items(event_id);
CREATE INDEX news_event_rank_idx ON public.news_events(status, importance DESC, last_seen DESC);
CREATE INDEX event_impact_corridor_idx ON public.event_impacts(corridor, severity);

ALTER TABLE public.news_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.news_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_impacts ENABLE ROW LEVEL SECURITY;

-- Events and their source articles are public: they are world news, not customer data.
CREATE POLICY news_event_read ON public.news_events FOR SELECT USING (true);
CREATE POLICY news_item_read ON public.news_items FOR SELECT USING (true);

-- The written analysis is the gated part. A signed-in person reads it in full; everyone
-- else gets the teaser through the function below.
CREATE POLICY event_impact_read ON public.event_impacts FOR SELECT USING (public.actor_id() IS NOT NULL);

GRANT SELECT ON public.news_items, public.news_events, public.event_impacts TO navair_app;

-- Teaser for anonymous visitors: severity and one sentence, never the full analysis or the
-- recommended actions. Enough to show the feature is real, not enough to replace signing in.
CREATE FUNCTION public.public_event_teasers(limit_count integer DEFAULT 20)
RETURNS TABLE(event_id uuid, slug text, title text, summary text, importance smallint,
              topics text[], corridors text[], last_seen timestamptz,
              worst_severity text, corridor_count integer, teaser text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT e.id, e.slug, e.title, e.summary, e.importance, e.topics, e.corridors, e.last_seen,
         (SELECT i.severity FROM public.event_impacts i WHERE i.event_id = e.id
           ORDER BY array_position(ARRAY['severe','elevated','watch','none'], i.severity) LIMIT 1),
         (SELECT count(*)::integer FROM public.event_impacts i WHERE i.event_id = e.id),
         (SELECT i.teaser FROM public.event_impacts i WHERE i.event_id = e.id
           ORDER BY array_position(ARRAY['severe','elevated','watch','none'], i.severity) LIMIT 1)
  FROM public.news_events e
  WHERE e.status = 'active'
  ORDER BY e.importance DESC, e.last_seen DESC
  LIMIT greatest(1, least(100, limit_count))
$$;

REVOKE ALL ON FUNCTION public.public_event_teasers(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_event_teasers(integer) TO navair_app;
