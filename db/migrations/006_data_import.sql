CREATE TABLE public.price_costs (
 observation_id uuid PRIMARY KEY REFERENCES public.price_observations(id) ON DELETE CASCADE,
 buying_cost numeric(14,2) NOT NULL CHECK(buying_cost>0)
);

ALTER TABLE public.price_costs ENABLE ROW LEVEL SECURITY;
CREATE POLICY price_costs_read ON public.price_costs FOR SELECT USING (
 public.has_permission('finance.view') AND EXISTS(
  SELECT 1 FROM public.price_observations p WHERE p.id=observation_id AND public.has_route(p.route_id)
 )
);
CREATE POLICY price_costs_insert ON public.price_costs FOR INSERT WITH CHECK (
 public.has_permission('finance.view') AND EXISTS(
  SELECT 1 FROM public.price_observations p WHERE p.id=observation_id AND public.has_route(p.route_id)
 )
);
CREATE POLICY price_costs_update ON public.price_costs FOR UPDATE USING (
 public.has_permission('finance.view') AND EXISTS(
  SELECT 1 FROM public.price_observations p WHERE p.id=observation_id AND public.has_route(p.route_id)
 )
) WITH CHECK (
 public.has_permission('finance.view') AND EXISTS(
  SELECT 1 FROM public.price_observations p WHERE p.id=observation_id AND public.has_route(p.route_id)
 )
);

CREATE POLICY prices_import_insert ON public.price_observations FOR INSERT WITH CHECK(public.has_permission('team.manage'));
CREATE POLICY prices_import_update ON public.price_observations FOR UPDATE USING(public.has_permission('team.manage')) WITH CHECK(public.has_permission('team.manage'));
CREATE POLICY evidence_import_insert ON public.delivery_evidence FOR INSERT WITH CHECK(public.has_permission('team.manage'));
CREATE POLICY evidence_import_update ON public.delivery_evidence FOR UPDATE USING(public.has_permission('team.manage')) WITH CHECK(public.has_permission('team.manage'));

GRANT SELECT,INSERT,UPDATE ON public.price_costs TO navair_app;
GRANT INSERT,UPDATE ON public.price_observations,public.delivery_evidence TO navair_app;
