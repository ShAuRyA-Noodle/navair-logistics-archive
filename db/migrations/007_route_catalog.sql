ALTER TABLE public.routes ADD COLUMN is_public boolean NOT NULL DEFAULT false;
DROP POLICY routes_read ON public.routes;
CREATE POLICY routes_read ON public.routes FOR SELECT USING (
 is_public OR public.has_route(id) OR EXISTS(
  SELECT 1 FROM public.enquiries e WHERE e.origin=routes.origin AND e.destination=routes.destination AND e.mode=routes.mode
    AND (public.has_permission('cases.all') OR public.has_permission('cases.assigned'))
 )
);
