-- 003_mail.sql is already deployed. Keep its public transition surface forward-only.
ALTER TABLE public.email_outbox ADD COLUMN lease_id uuid;

DROP FUNCTION public.claim_email_outbox(integer);
DROP FUNCTION public.finish_email_outbox(uuid,text,text,text,timestamptz);
DROP FUNCTION public.record_email_webhook(text,text,text,timestamptz);

CREATE FUNCTION public.claim_email_outbox(batch_size integer DEFAULT 1)
RETURNS SETOF public.email_outbox
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NOT public.has_permission('mail.manage') THEN
    RAISE EXCEPTION 'MAIL_FORBIDDEN' USING ERRCODE='42501';
  END IF;
  IF batch_size < 1 OR batch_size > 10 THEN
    RAISE EXCEPTION 'MAIL_BATCH_INVALID' USING ERRCODE='22023';
  END IF;

  UPDATE public.email_outbox
  SET status='pending', locked_at=NULL, lease_id=NULL, available_at=least(available_at,now()), updated_at=now(),
      last_error=coalesce(last_error, 'Recovered stale worker lease')
  WHERE status='processing' AND locked_at < now()-interval '5 minutes';

  RETURN QUERY
  WITH picked AS (
    SELECT eo.id FROM public.email_outbox eo
    WHERE eo.status='pending' AND eo.available_at<=now()
    ORDER BY eo.available_at, eo.created_at
    LIMIT batch_size
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.email_outbox eo
  SET status='processing', locked_at=now(), lease_id=gen_random_uuid(), attempts=eo.attempts+1,
      first_attempt_at=coalesce(eo.first_attempt_at,now()), updated_at=now()
  FROM picked
  WHERE eo.id=picked.id
  RETURNING eo.*;
END $$;

CREATE FUNCTION public.finish_email_outbox(
  job_id uuid, expected_lease_id uuid, target_status text, new_provider_id text DEFAULT NULL,
  error_message text DEFAULT NULL, next_available_at timestamptz DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE changed boolean;
BEGIN
  IF NOT public.has_permission('mail.manage') THEN
    RAISE EXCEPTION 'MAIL_FORBIDDEN' USING ERRCODE='42501';
  END IF;
  IF target_status NOT IN ('pending','preview','sent','failed','uncertain') THEN
    RAISE EXCEPTION 'MAIL_STATUS_INVALID' USING ERRCODE='22023';
  END IF;
  IF target_status='pending' AND next_available_at IS NULL THEN
    RAISE EXCEPTION 'MAIL_RETRY_REQUIRES_TIME' USING ERRCODE='22023';
  END IF;

  UPDATE public.email_outbox
  SET status=target_status, provider_id=coalesce(new_provider_id,provider_id),
      last_error=error_message, available_at=coalesce(next_available_at,available_at),
      locked_at=NULL, lease_id=NULL, updated_at=now()
  WHERE id=job_id AND status='processing' AND lease_id=expected_lease_id
  RETURNING true INTO changed;
  IF NOT coalesce(changed,false) THEN RETURN false; END IF;

  -- Delivery can beat the send response. Apply the highest durable event when
  -- a just-sent provider id is finally attached to this job.
  IF new_provider_id IS NOT NULL THEN
    WITH highest AS (
      SELECT CASE event_type
        WHEN 'email.sent' THEN 'sent'
        WHEN 'email.failed' THEN 'failed'
        WHEN 'email.delivered' THEN 'delivered'
        WHEN 'email.bounced' THEN 'bounced'
        WHEN 'email.complained' THEN 'complained'
      END AS status
      FROM public.email_webhook_events
      WHERE provider_id=new_provider_id
        AND event_type IN ('email.sent','email.failed','email.delivered','email.bounced','email.complained')
      ORDER BY CASE event_type
        WHEN 'email.sent' THEN 1 WHEN 'email.failed' THEN 2 WHEN 'email.delivered' THEN 3
        WHEN 'email.bounced' THEN 4 WHEN 'email.complained' THEN 5 END DESC, occurred_at DESC
      LIMIT 1
    )
    UPDATE public.email_outbox eo
    SET status=highest.status, updated_at=now()
    FROM highest WHERE eo.id=job_id;
  END IF;
  RETURN true;
END $$;

CREATE FUNCTION public.record_email_webhook(
  event_id text, target_provider_id text, target_event_type text, occurred timestamptz
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE inserted_id text; new_status text; new_priority integer;
BEGIN
  IF NOT public.has_permission('mail.manage') THEN
    RAISE EXCEPTION 'MAIL_FORBIDDEN' USING ERRCODE='42501';
  END IF;
  INSERT INTO public.email_webhook_events(id,provider_id,event_type,occurred_at)
  VALUES(event_id,target_provider_id,target_event_type,occurred)
  ON CONFLICT(id) DO NOTHING RETURNING id INTO inserted_id;
  IF inserted_id IS NULL THEN RETURN false; END IF;

  new_status:=CASE target_event_type
    WHEN 'email.sent' THEN 'sent' WHEN 'email.failed' THEN 'failed'
    WHEN 'email.delivered' THEN 'delivered' WHEN 'email.bounced' THEN 'bounced'
    WHEN 'email.complained' THEN 'complained' ELSE NULL END;
  IF new_status IS NULL THEN RETURN true; END IF;
  new_priority:=CASE new_status
    WHEN 'sent' THEN 1 WHEN 'failed' THEN 2 WHEN 'delivered' THEN 3
    WHEN 'bounced' THEN 4 WHEN 'complained' THEN 5 END;

  UPDATE public.email_outbox
  SET status=new_status, updated_at=now()
  WHERE provider_id=target_provider_id
    AND CASE status
      WHEN 'sent' THEN 1 WHEN 'failed' THEN 2 WHEN 'delivered' THEN 3
      WHEN 'bounced' THEN 4 WHEN 'complained' THEN 5 ELSE 0 END <= new_priority;
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION public.claim_email_outbox(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finish_email_outbox(uuid,uuid,text,text,text,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_email_webhook(text,text,text,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_email_outbox(integer) TO navair_app;
GRANT EXECUTE ON FUNCTION public.finish_email_outbox(uuid,uuid,text,text,text,timestamptz) TO navair_app;
GRANT EXECUTE ON FUNCTION public.record_email_webhook(text,text,text,timestamptz) TO navair_app;
