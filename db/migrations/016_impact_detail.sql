-- Analysis is read as scannable bullets rather than prose, so the structured parts live in
-- their own column: key points, the figures worth highlighting, and what to watch next.
-- `body` stays as the plain-text rendering, which keeps older rows readable.
ALTER TABLE public.event_impacts ADD COLUMN detail jsonb NOT NULL DEFAULT '{}';
COMMENT ON COLUMN public.event_impacts.detail IS 'bullets[], keyNumbers[{label,value,source}], outlook[] - shaped by src/lib/news/analysis.ts';
