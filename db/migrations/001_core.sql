REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO navair_app;

CREATE TABLE public.app_users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), external_id uuid UNIQUE,
 email text NOT NULL UNIQUE CHECK (email=lower(email)), name text NOT NULL,
 role text NOT NULL DEFAULT 'customer' CHECK (role IN ('owner','staff','customer')),
 permissions text[] NOT NULL DEFAULT '{}', active boolean NOT NULL DEFAULT true,
 is_demo boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.sessions (
 token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES public.app_users(id),
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.routes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), origin text NOT NULL, destination text NOT NULL,
 mode text NOT NULL CHECK (mode IN ('air','sea','road','courier','other')), unit text NOT NULL,
 UNIQUE(origin,destination,mode)
);
CREATE TABLE public.enquiries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), reference text UNIQUE NOT NULL,
 customer_id uuid REFERENCES public.app_users(id), assigned_to uuid REFERENCES public.app_users(id),
 name text NOT NULL, email text NOT NULL, phone text, origin text NOT NULL, destination text NOT NULL,
 mode text NOT NULL CHECK(mode IN ('air','sea','road','courier','other','unsure')),
 description text NOT NULL, status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','declined')),
 is_demo boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(), accepted_at timestamptz,
 version integer NOT NULL DEFAULT 1
);
CREATE TABLE public.shipments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), enquiry_id uuid UNIQUE NOT NULL REFERENCES public.enquiries(id),
 route_id uuid NOT NULL REFERENCES public.routes(id), status text NOT NULL DEFAULT 'accepted'
 CHECK(status IN ('accepted','booked','collected','in_transit','customs','delivered','cancelled')),
 promised_at timestamptz NOT NULL, estimated_at timestamptz, actual_at timestamptz,
 selling_price numeric(14,2) NOT NULL CHECK(selling_price>=0), currency text NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
 unit text NOT NULL, quantity numeric(12,3) NOT NULL DEFAULT 1 CHECK(quantity>0),
 version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.shipment_finance (
 shipment_id uuid PRIMARY KEY REFERENCES public.shipments(id), buying_cost numeric(14,2) NOT NULL CHECK(buying_cost>=0)
);
CREATE TABLE public.shipment_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shipment_id uuid NOT NULL REFERENCES public.shipments(id),
 status text NOT NULL, description text NOT NULL, occurred_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.commitments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), enquiry_id uuid NOT NULL REFERENCES public.enquiries(id),
 assigned_to uuid NOT NULL REFERENCES public.app_users(id), title text NOT NULL,
 due_at timestamptz NOT NULL, completed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.price_observations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_id text NOT NULL UNIQUE,
 route_id uuid NOT NULL REFERENCES public.routes(id), observed_at timestamptz NOT NULL,
 selling_price numeric(14,2) NOT NULL CHECK(selling_price>0), currency text NOT NULL,
 unit text NOT NULL, is_demo boolean NOT NULL DEFAULT false
);
CREATE TABLE public.delivery_evidence (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_id text NOT NULL UNIQUE,
 route_id uuid NOT NULL REFERENCES public.routes(id), promised_at timestamptz NOT NULL,
 actual_at timestamptz, observed_at timestamptz NOT NULL, issue text,
 is_demo boolean NOT NULL DEFAULT false
);
CREATE TABLE public.email_outbox (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), enquiry_id uuid REFERENCES public.enquiries(id),
 kind text NOT NULL, recipient text NOT NULL, subject text NOT NULL, body text NOT NULL,
 reply_to text NOT NULL, idempotency_key text UNIQUE NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','preview','sent','delivered','failed','bounced','complained','uncertain')),
 attempts integer NOT NULL DEFAULT 0, available_at timestamptz NOT NULL DEFAULT now(),
 locked_at timestamptz, first_attempt_at timestamptz, provider_id text UNIQUE,
 last_error text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.email_webhook_events (id text PRIMARY KEY, provider_id text NOT NULL, event_type text NOT NULL, occurred_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.submission_keys (key text PRIMARY KEY, payload_hash text NOT NULL, enquiry_id uuid NOT NULL REFERENCES public.enquiries(id), created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.rate_limits (bucket text PRIMARY KEY, count integer NOT NULL, resets_at timestamptz NOT NULL);
CREATE TABLE public.audit_log (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, actor_id uuid REFERENCES public.app_users(id),
 action text NOT NULL, entity_id uuid, details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX enquiry_customer_idx ON public.enquiries(customer_id);
CREATE INDEX enquiry_assignee_idx ON public.enquiries(assigned_to);
CREATE INDEX price_route_date_idx ON public.price_observations(route_id,observed_at);
CREATE INDEX evidence_route_date_idx ON public.delivery_evidence(route_id,observed_at);
CREATE INDEX outbox_available_idx ON public.email_outbox(status,available_at);

CREATE FUNCTION public.actor_id() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.user_id',true),'')::uuid $$;
CREATE FUNCTION public.has_permission(permission text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.app_users WHERE id=public.actor_id() AND active AND (role='owner' OR (role='staff' AND permission=ANY(permissions))))
$$;
CREATE FUNCTION public.owns_enquiry(target uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.enquiries e JOIN public.app_users u ON u.id=public.actor_id() AND u.active
 WHERE e.id=target AND (e.customer_id=u.id OR public.has_permission('cases.all') OR (public.has_permission('cases.assigned') AND e.assigned_to=u.id)))
$$;
CREATE FUNCTION public.has_route(target uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT public.has_permission('cases.all') OR EXISTS(SELECT 1 FROM public.shipments s JOIN public.enquiries e ON e.id=s.enquiry_id WHERE s.route_id=target AND e.status='accepted' AND public.owns_enquiry(e.id))
$$;

ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY users_read ON public.app_users FOR SELECT USING (id=public.actor_id() OR public.has_permission('team.manage'));
CREATE POLICY users_update ON public.app_users FOR UPDATE USING (public.has_permission('team.manage')) WITH CHECK(public.has_permission('team.manage'));
ALTER TABLE public.routes ENABLE ROW LEVEL SECURITY;
CREATE POLICY routes_read ON public.routes FOR SELECT USING (true);
CREATE POLICY routes_insert ON public.routes FOR INSERT WITH CHECK(public.has_permission('cases.accept'));
ALTER TABLE public.enquiries ENABLE ROW LEVEL SECURITY;
CREATE POLICY enquiry_read ON public.enquiries FOR SELECT USING (public.owns_enquiry(id));
CREATE POLICY enquiry_update ON public.enquiries FOR UPDATE USING (public.owns_enquiry(id) AND (public.has_permission('cases.accept') OR public.has_permission('shipments.update'))) WITH CHECK(public.owns_enquiry(id));
ALTER TABLE public.shipments ENABLE ROW LEVEL SECURITY;
CREATE POLICY shipment_read ON public.shipments FOR SELECT USING (public.owns_enquiry(enquiry_id));
CREATE POLICY shipment_insert ON public.shipments FOR INSERT WITH CHECK(public.has_permission('cases.accept') AND public.owns_enquiry(enquiry_id));
CREATE POLICY shipment_update ON public.shipments FOR UPDATE USING (public.has_permission('shipments.update') AND public.owns_enquiry(enquiry_id));
ALTER TABLE public.shipment_finance ENABLE ROW LEVEL SECURITY;
CREATE POLICY finance_access ON public.shipment_finance USING (public.has_permission('finance.view') AND EXISTS(SELECT 1 FROM public.shipments WHERE id=shipment_id)) WITH CHECK(public.has_permission('finance.view'));
ALTER TABLE public.shipment_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY events_read ON public.shipment_events FOR SELECT USING (EXISTS(SELECT 1 FROM public.shipments WHERE id=shipment_id));
CREATE POLICY events_insert ON public.shipment_events FOR INSERT WITH CHECK(public.has_permission('shipments.update') AND EXISTS(SELECT 1 FROM public.shipments WHERE id=shipment_id));
ALTER TABLE public.commitments ENABLE ROW LEVEL SECURITY;
CREATE POLICY commitments_read ON public.commitments FOR SELECT USING(public.has_permission('commitments.manage') AND public.owns_enquiry(enquiry_id));
CREATE POLICY commitments_write ON public.commitments FOR ALL USING(public.has_permission('commitments.manage') AND public.owns_enquiry(enquiry_id)) WITH CHECK(public.has_permission('commitments.manage') AND public.owns_enquiry(enquiry_id));
ALTER TABLE public.price_observations ENABLE ROW LEVEL SECURITY;
CREATE POLICY prices_read ON public.price_observations FOR SELECT USING(public.has_route(route_id));
ALTER TABLE public.delivery_evidence ENABLE ROW LEVEL SECURITY;
CREATE POLICY evidence_read ON public.delivery_evidence FOR SELECT USING(public.has_route(route_id));
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_read ON public.audit_log FOR SELECT USING(public.has_permission('team.manage'));
CREATE POLICY audit_insert ON public.audit_log FOR INSERT WITH CHECK(actor_id=public.actor_id());

GRANT SELECT ON public.app_users,public.routes,public.enquiries,public.shipments,public.shipment_finance,public.shipment_events,public.commitments,public.price_observations,public.delivery_evidence,public.audit_log TO navair_app;
GRANT UPDATE ON public.app_users,public.enquiries,public.shipments,public.commitments TO navair_app;
GRANT INSERT ON public.routes,public.shipments,public.shipment_finance,public.shipment_events,public.commitments,public.audit_log TO navair_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO navair_app;

-- Backend-only functions. No anonymous client or browser receives database credentials.
CREATE FUNCTION public.resolve_session(hash text) RETURNS SETOF public.app_users LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT u.* FROM public.sessions s JOIN public.app_users u ON s.user_id=u.id WHERE s.token_hash=hash AND s.expires_at>now() AND u.active
$$;
CREATE FUNCTION public.create_session(target uuid, hash text) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 INSERT INTO public.sessions(token_hash,user_id,expires_at) SELECT hash,id,now()+interval '8 hours' FROM public.app_users WHERE id=target AND active
$$;
CREATE FUNCTION public.revoke_session(hash text) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$ DELETE FROM public.sessions WHERE token_hash=hash $$;
CREATE FUNCTION public.demo_users() RETURNS SETOF public.app_users LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$ SELECT * FROM public.app_users WHERE is_demo AND active ORDER BY role,name $$;
CREATE FUNCTION public.provision_customer(subject uuid, address text, full_name text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE target uuid;
BEGIN
 SELECT id INTO target FROM public.app_users WHERE external_id=subject AND active;
 IF target IS NULL THEN
   SELECT id INTO target FROM public.app_users WHERE email=lower(address) AND role='customer' AND NOT is_demo AND external_id IS NULL AND active FOR UPDATE;
   IF target IS NOT NULL THEN UPDATE public.app_users SET external_id=subject WHERE id=target;
   ELSE INSERT INTO public.app_users(external_id,email,name) VALUES(subject,lower(address),full_name) RETURNING id INTO target; END IF;
 END IF;
 UPDATE public.enquiries SET customer_id=target WHERE customer_id IS NULL AND email=lower(address) AND NOT is_demo;
 RETURN target;
END $$;
CREATE FUNCTION public.rate_limit(bucket_key text, maximum integer, seconds integer) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE hits integer;
BEGIN
 INSERT INTO public.rate_limits(bucket,count,resets_at) VALUES(bucket_key,1,now()+make_interval(secs=>seconds))
 ON CONFLICT(bucket) DO UPDATE SET count=CASE WHEN public.rate_limits.resets_at<now() THEN 1 ELSE public.rate_limits.count+1 END,
 resets_at=CASE WHEN public.rate_limits.resets_at<now() THEN now()+make_interval(secs=>seconds) ELSE public.rate_limits.resets_at END RETURNING count INTO hits;
 RETURN hits<=maximum;
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO navair_app;
