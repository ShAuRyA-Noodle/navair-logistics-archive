-- The application role can inspect mail only through RLS. State transitions live
-- in these narrowly-scoped functions so a caller cannot mark arbitrary mail sent.
REVOKE INSERT, UPDATE, DELETE ON public.email_outbox FROM navair_app;

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

  -- A worker which died after claiming a row leaves a short, recoverable lease.
  UPDATE public.email_outbox
  SET status='pending', locked_at=NULL, available_at=now(), updated_at=now(),
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
  SET status='processing', locked_at=now(), attempts=eo.attempts+1,
      first_attempt_at=coalesce(eo.first_attempt_at,now()), updated_at=now()
  FROM picked
  WHERE eo.id=picked.id
  RETURNING eo.*;
END $$;

CREATE FUNCTION public.finish_email_outbox(
  job_id uuid, target_status text, new_provider_id text DEFAULT NULL,
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
      locked_at=NULL, updated_at=now()
  WHERE id=job_id AND status='processing'
  RETURNING true INTO changed;
  RETURN coalesce(changed,false);
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
  ON CONFLICT(id) DO NOTHING
  RETURNING id INTO inserted_id;
  IF inserted_id IS NULL THEN RETURN false; END IF;

  new_status:=CASE target_event_type
    WHEN 'email.delivered' THEN 'delivered'
    WHEN 'email.bounced' THEN 'bounced'
    WHEN 'email.complained' THEN 'complained'
    ELSE NULL
  END;
  IF new_status IS NULL THEN RETURN true; END IF;
  new_priority:=CASE new_status WHEN 'delivered' THEN 2 WHEN 'bounced' THEN 3 ELSE 4 END;

  UPDATE public.email_outbox
  SET status=new_status, updated_at=now()
  WHERE provider_id=target_provider_id
    AND CASE status
      WHEN 'delivered' THEN 2
      WHEN 'bounced' THEN 3
      WHEN 'complained' THEN 4
      ELSE 1
    END <= new_priority;
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION public.claim_email_outbox(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finish_email_outbox(uuid,text,text,text,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_email_webhook(text,text,text,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_email_outbox(integer) TO navair_app;
GRANT EXECUTE ON FUNCTION public.finish_email_outbox(uuid,text,text,text,timestamptz) TO navair_app;
GRANT EXECUTE ON FUNCTION public.record_email_webhook(text,text,text,timestamptz) TO navair_app;
