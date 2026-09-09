ALTER TABLE public.enquiries ADD COLUMN shipment_details jsonb;

CREATE OR REPLACE FUNCTION public.enquiry_shipment_summary(details jsonb)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT CASE WHEN details IS NULL THEN '' ELSE E'\nShipment details:\n' || concat_ws(E'\n',
    'Cargo type: ' || coalesce(details->>'cargoType','Not provided'),
    CASE WHEN details ? 'goodsDescription' THEN 'Goods: ' || (details->>'goodsDescription') END,
    'Package type: ' || coalesce(details->>'packageType','Not provided'),
    CASE WHEN details ? 'quantity' THEN 'Package count: ' || (details->>'quantity') END,
    CASE WHEN details ? 'handling' THEN 'Handling: ' || (details->>'handling') END,
    CASE WHEN details->'weight' ? 'unknown' THEN 'Total weight: Unknown'
         WHEN details->'weight' ? 'value' THEN 'Total weight: ' || (details->'weight'->>'value') || ' ' || (details->'weight'->>'unit') END,
    CASE WHEN details->'dimensions' ? 'unknown' THEN 'Dimensions per package: Unknown'
         WHEN details->'dimensions' ? 'length' THEN 'Dimensions per package: ' || (details->'dimensions'->>'length') || ' × ' || (details->'dimensions'->>'width') || ' × ' || (details->'dimensions'->>'height') || ' ' || (details->'dimensions'->>'unit') END,
    CASE WHEN details ? 'seaContainer' THEN 'Sea container: ' || (details->>'seaContainer') END,
    CASE WHEN details->'readiness' ? 'date' THEN 'Cargo readiness: ' || (details->'readiness'->>'date')
         WHEN details->'readiness' ? 'flexible' THEN 'Cargo readiness: Flexible' END,
    CASE WHEN details ? 'notes' THEN 'Notes: ' || (details->>'notes') END
  ) END
$$;

CREATE OR REPLACE FUNCTION public.submit_enquiry(payload jsonb, request_key text, request_hash text, demo boolean, business_email text)
RETURNS TABLE(id uuid, reference text) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE existing public.submission_keys; target uuid; ref text; customer uuid; customer_email text; customer_name text; details jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(request_key,0));
 SELECT * INTO existing FROM public.submission_keys WHERE key=request_key;
 IF FOUND THEN
   IF existing.payload_hash<>request_hash THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT' USING ERRCODE='P0001'; END IF;
   RETURN QUERY SELECT e.id,e.reference FROM public.enquiries e WHERE e.id=existing.enquiry_id; RETURN;
 END IF;
 customer_email:=lower(payload->>'email'); customer_name:=payload->>'name'; details:=payload->'shipment';
 SELECT u.id INTO customer FROM public.app_users u WHERE u.email=customer_email AND u.role='customer' AND u.is_demo=demo AND u.active;
 IF customer IS NULL AND demo THEN
   INSERT INTO public.app_users(email,name,is_demo) VALUES(customer_email,customer_name,true)
   ON CONFLICT(email) DO NOTHING RETURNING app_users.id INTO customer;
 END IF;
 target:=gen_random_uuid(); ref:='NAV-'||upper(substr(replace(target::text,'-',''),1,10));
 INSERT INTO public.enquiries(id,reference,customer_id,name,email,phone,origin,destination,mode,description,shipment_details,is_demo)
 VALUES(target,ref,customer,customer_name,customer_email,nullif(payload->>'phone',''),payload->>'origin',payload->>'destination',payload->>'mode',payload->>'description',details,demo);
 INSERT INTO public.submission_keys(key,payload_hash,enquiry_id) VALUES(request_key,request_hash,target);
 INSERT INTO public.email_outbox(enquiry_id,kind,recipient,subject,body,reply_to,idempotency_key) VALUES
 (target,'staff',business_email,'New export enquiry '||ref,
 'New enquiry from '||customer_name||E'\nEmail: '||customer_email||E'\nRoute: '||(payload->>'origin')||' to '||(payload->>'destination')||E'\nMode: '||(payload->>'mode')||E'\nPhone: '||coalesce(nullif(payload->>'phone',''),'Not provided')||E'\nRequirements: '||(payload->>'description')||public.enquiry_shipment_summary(details),customer_email,'enquiry/'||target::text||'/staff-v2'),
 (target,'acknowledgment',customer_email,'We received your enquiry '||ref,
 'Hello '||customer_name||E',\n\nThank you for contacting Navair Logistics. We received your enquiry for '||(payload->>'origin')||' to '||(payload->>'destination')||E'. Our team will review your requirements and get in touch.'||public.enquiry_shipment_summary(details)||E'\n\nYour reference: '||ref||E'\nThis acknowledges your enquiry; it does not confirm a booking or price.\n\nNavair Logistics',business_email,'enquiry/'||target::text||'/ack-v2');
 RETURN QUERY SELECT target,ref;
END $$;

REVOKE ALL ON FUNCTION public.enquiry_shipment_summary(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enquiry_shipment_summary(jsonb) TO navair_app;
REVOKE ALL ON FUNCTION public.submit_enquiry(jsonb,text,text,boolean,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_enquiry(jsonb,text,text,boolean,text) TO navair_app;
