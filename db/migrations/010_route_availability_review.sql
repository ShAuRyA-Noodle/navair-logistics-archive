-- Public route history and synthetic catalog entries are not operational coverage promises.
-- Operations must maintain this declaration when a route's coverage becomes known.
ALTER TABLE public.routes ADD COLUMN service_coverage text NOT NULL DEFAULT 'unknown'
 CHECK (service_coverage IN ('supported','on_request','not_supported','unknown'));
ALTER TABLE public.enquiries ADD COLUMN route_availability_review boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.submit_enquiry(payload jsonb, request_key text, request_hash text, demo boolean, business_email text)
RETURNS TABLE(id uuid, reference text) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE existing public.submission_keys; target uuid; ref text; customer uuid; customer_email text; customer_name text; details jsonb; coverage text; review boolean;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(request_key,0));
 SELECT * INTO existing FROM public.submission_keys WHERE key=request_key;
 IF FOUND THEN
   IF existing.payload_hash<>request_hash THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT' USING ERRCODE='P0001'; END IF;
   RETURN QUERY SELECT e.id,e.reference FROM public.enquiries e WHERE e.id=existing.enquiry_id; RETURN;
 END IF;
 customer_email:=lower(payload->>'email'); customer_name:=payload->>'name'; details:=payload->'shipment';
 SELECT r.service_coverage INTO coverage FROM public.routes r
 WHERE lower(regexp_replace(trim(r.origin),'\s+',' ','g'))=lower(regexp_replace(trim(payload->>'origin'),'\s+',' ','g'))
   AND lower(regexp_replace(trim(r.destination),'\s+',' ','g'))=lower(regexp_replace(trim(payload->>'destination'),'\s+',' ','g'))
   AND r.mode=payload->>'mode'
 LIMIT 1;
 review:=coalesce(coverage,'unknown')<>'supported';
 SELECT u.id INTO customer FROM public.app_users u WHERE u.email=customer_email AND u.role='customer' AND u.is_demo=demo AND u.active;
 IF customer IS NULL AND demo THEN
   INSERT INTO public.app_users(email,name,is_demo) VALUES(customer_email,customer_name,true)
   ON CONFLICT(email) DO NOTHING RETURNING app_users.id INTO customer;
 END IF;
 target:=gen_random_uuid(); ref:='NAV-'||upper(substr(replace(target::text,'-',''),1,10));
 INSERT INTO public.enquiries(id,reference,customer_id,name,email,phone,origin,destination,mode,description,shipment_details,route_availability_review,is_demo)
 VALUES(target,ref,customer,customer_name,customer_email,nullif(payload->>'phone',''),payload->>'origin',payload->>'destination',payload->>'mode',payload->>'description',details,review,demo);
 INSERT INTO public.submission_keys(key,payload_hash,enquiry_id) VALUES(request_key,request_hash,target);
 INSERT INTO public.email_outbox(enquiry_id,kind,recipient,subject,body,reply_to,idempotency_key) VALUES
 (target,'staff',business_email,
 CASE WHEN review THEN 'Route availability review required: '||ref ELSE 'New export enquiry '||ref END,
 CASE WHEN review THEN 'Route availability review required. Service is not confirmed; assess availability and possible alternatives.'||E'\n\n' ELSE '' END||
 'New enquiry from '||customer_name||E'\nEmail: '||customer_email||E'\nRoute: '||(payload->>'origin')||' to '||(payload->>'destination')||E'\nMode: '||(payload->>'mode')||E'\nPhone: '||coalesce(nullif(payload->>'phone',''),'Not provided')||E'\nRequirements: '||(payload->>'description')||public.enquiry_shipment_summary(details),customer_email,'enquiry/'||target::text||'/staff-v3'),
 (target,'acknowledgment',customer_email,'We received your enquiry '||ref,
 'Hello '||customer_name||E',\n\nThank you for contacting Navair Logistics. We received your enquiry for '||(payload->>'origin')||' to '||(payload->>'destination')||E'. '||
 CASE WHEN review THEN 'Our team will review availability and possible alternatives, then get in touch.' ELSE 'Our team will review your requirements and get in touch.' END||public.enquiry_shipment_summary(details)||E'\n\nYour reference: '||ref||
 CASE WHEN review THEN E'\nThis acknowledges your enquiry; it does not confirm a booking, quote, or availability.' ELSE E'\nThis acknowledges your enquiry; it does not confirm a booking or price.' END||E'\n\nNavair Logistics',business_email,'enquiry/'||target::text||'/ack-v3');
 RETURN QUERY SELECT target,ref;
END $$;

REVOKE ALL ON FUNCTION public.submit_enquiry(jsonb,text,text,boolean,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_enquiry(jsonb,text,text,boolean,text) TO navair_app;
