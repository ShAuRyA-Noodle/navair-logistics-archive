-- Persist operational evidence when a milestone changes. Summaries can use the
-- whole permitted route without exposing other customers' shipment records.
CREATE FUNCTION public.capture_shipment_evidence() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE demo boolean;
BEGIN
 SELECT is_demo INTO demo FROM public.enquiries WHERE id=NEW.enquiry_id;
 IF NEW.status='cancelled' THEN DELETE FROM public.delivery_evidence WHERE source_id='shipment:'||NEW.id::text;
 ELSE
 INSERT INTO public.delivery_evidence(source_id,route_id,promised_at,actual_at,observed_at,is_demo)
 VALUES('shipment:'||NEW.id::text,NEW.route_id,NEW.promised_at,NEW.actual_at,now(),demo)
 ON CONFLICT(source_id) DO UPDATE SET actual_at=excluded.actual_at,observed_at=excluded.observed_at;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER shipment_evidence AFTER INSERT OR UPDATE OF status,actual_at,estimated_at ON public.shipments FOR EACH ROW EXECUTE FUNCTION public.capture_shipment_evidence();
REVOKE ALL ON FUNCTION public.capture_shipment_evidence() FROM PUBLIC;

CREATE FUNCTION public.accepted_enquiry_email() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE business text;
BEGIN
 IF OLD.status='pending' AND NEW.status='accepted' THEN
 SELECT reply_to INTO business FROM public.email_outbox WHERE enquiry_id=NEW.id AND kind='acknowledgment' LIMIT 1;
 IF business IS NOT NULL THEN
 INSERT INTO public.email_outbox(enquiry_id,kind,recipient,subject,body,reply_to,idempotency_key)
 VALUES(NEW.id,'accepted',NEW.email,'Your enquiry has been accepted '||NEW.reference,
 'Hello '||NEW.name||E',\n\nNavair has accepted your enquiry. Sign in to the Navair website with the email you used for your enquiry to view your shipment journey, agreed selling price and delivery updates.\n\nReference: '||NEW.reference||E'\n\nNavair Logistics',business,'enquiry/'||NEW.id::text||'/accepted-v1') ON CONFLICT(idempotency_key) DO NOTHING;
 END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER enquiry_acceptance_mail AFTER UPDATE OF status ON public.enquiries FOR EACH ROW EXECUTE FUNCTION public.accepted_enquiry_email();
REVOKE ALL ON FUNCTION public.accepted_enquiry_email() FROM PUBLIC;
