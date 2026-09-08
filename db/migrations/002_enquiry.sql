CREATE FUNCTION public.submit_enquiry(payload jsonb, request_key text, request_hash text, demo boolean, business_email text)
RETURNS TABLE(id uuid, reference text) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE existing public.submission_keys; target uuid; ref text; customer uuid; customer_email text; customer_name text;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(request_key,0));
 SELECT * INTO existing FROM public.submission_keys WHERE key=request_key;
 IF FOUND THEN
   IF existing.payload_hash<>request_hash THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT' USING ERRCODE='P0001'; END IF;
   RETURN QUERY SELECT e.id,e.reference FROM public.enquiries e WHERE e.id=existing.enquiry_id; RETURN;
 END IF;
 customer_email:=lower(payload->>'email'); customer_name:=payload->>'name';
 SELECT u.id INTO customer FROM public.app_users u WHERE u.email=customer_email AND u.role='customer' AND u.is_demo=demo AND u.active;
 IF customer IS NULL AND demo THEN
   INSERT INTO public.app_users(email,name,is_demo) VALUES(customer_email,customer_name,true)
   ON CONFLICT(email) DO NOTHING RETURNING app_users.id INTO customer;
 END IF;
 target:=gen_random_uuid(); ref:='NAV-'||upper(substr(replace(target::text,'-',''),1,10));
 INSERT INTO public.enquiries(id,reference,customer_id,name,email,phone,origin,destination,mode,description,is_demo)
 VALUES(target,ref,customer,customer_name,customer_email,nullif(payload->>'phone',''),payload->>'origin',payload->>'destination',payload->>'mode',payload->>'description',demo);
 INSERT INTO public.submission_keys(key,payload_hash,enquiry_id) VALUES(request_key,request_hash,target);
 INSERT INTO public.email_outbox(enquiry_id,kind,recipient,subject,body,reply_to,idempotency_key) VALUES
 (target,'staff',business_email,'New export enquiry '||ref,
 'New enquiry from '||customer_name||E'\nEmail: '||customer_email||E'\nRoute: '||(payload->>'origin')||' to '||(payload->>'destination')||E'\nMode: '||(payload->>'mode')||E'\nPhone: '||coalesce(nullif(payload->>'phone',''),'Not provided')||E'\nRequirements: '||(payload->>'description'),customer_email,'enquiry/'||target::text||'/staff-v1'),
 (target,'acknowledgment',customer_email,'We received your enquiry '||ref,
 'Hello '||customer_name||E',\n\nThank you for contacting Navair Logistics. We received your enquiry for '||(payload->>'origin')||' to '||(payload->>'destination')||E'. Our team will review your requirements and get in touch.\n\nYour reference: '||ref||E'\nThis acknowledges your enquiry; it does not confirm a booking or price.\n\nNavair Logistics',business_email,'enquiry/'||target::text||'/ack-v1');
 RETURN QUERY SELECT target,ref;
END $$;
REVOKE ALL ON FUNCTION public.submit_enquiry(jsonb,text,text,boolean,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_enquiry(jsonb,text,text,boolean,text) TO navair_app;
ALTER TABLE public.email_outbox ENABLE ROW LEVEL SECURITY;
CREATE POLICY outbox_read ON public.email_outbox FOR SELECT USING(public.has_permission('mail.manage'));
GRANT SELECT ON public.email_outbox TO navair_app;
