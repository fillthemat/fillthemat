-- Email's four claim lanes, fresh-first, with full execution fencing.
CREATE FUNCTION public.claim_whatsapp_jobs(p_run_id text, p_limit integer DEFAULT 10,
    p_now timestamptz DEFAULT now(), p_retry_only boolean DEFAULT false, p_phone_number_ids text[] DEFAULT NULL)
RETURNS SETOF public.whatsapp_jobs LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_ids uuid[] := '{}'; v_lane integer; v_capacity integer; v_fresh boolean;
BEGIN
    IF p_limit <= 0 THEN RETURN; END IF;
    FOR v_lane IN 1..4 LOOP
        v_fresh := v_lane IN (1, 3);
        IF p_retry_only AND v_fresh THEN CONTINUE; END IF;
        v_capacity := CASE WHEN p_retry_only THEN p_limit - cardinality(v_ids)
            WHEN v_lane = 1 THEN p_limit - p_limit / 5 WHEN v_lane = 2 THEN p_limit / 5
            ELSE p_limit - cardinality(v_ids) END;
        v_ids := v_ids || ARRAY(SELECT id FROM public.whatsapp_jobs
            WHERE state IN ('pending', 'failed') AND next_attempt_at <= p_now
                AND (attempts = 0) = v_fresh AND NOT (id = ANY(v_ids))
                AND (p_phone_number_ids IS NULL OR phone_number_id = ANY(p_phone_number_ids))
            ORDER BY created_at, id LIMIT v_capacity FOR UPDATE SKIP LOCKED);
    END LOOP;
    RETURN QUERY WITH claimed AS (
        UPDATE public.whatsapp_jobs SET state = 'claimed', claimed_at = p_now, claimed_by = p_run_id
        WHERE id = ANY(v_ids) RETURNING *
    ) SELECT * FROM claimed ORDER BY (attempts > 0), created_at, id;
END;
$$;

CREATE FUNCTION public.start_whatsapp_job(p_id uuid, p_claimed_by text, p_claimed_at timestamptz,
    p_attempts integer, p_school_id uuid DEFAULT NULL)
RETURNS SETOF public.whatsapp_jobs LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
    UPDATE public.whatsapp_jobs SET attempts = attempts + 1, school_id = coalesce(p_school_id, school_id)
    WHERE id = p_id AND state = 'claimed' AND claimed_by = p_claimed_by
        AND claimed_at = p_claimed_at AND attempts = p_attempts AND attempts < 5 RETURNING *;
$$;

CREATE FUNCTION public.recover_whatsapp_jobs(p_stale_before timestamptz, p_phone_number_ids text[] DEFAULT NULL)
RETURNS SETOF public.whatsapp_jobs LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
    WITH stale AS (SELECT id FROM public.whatsapp_jobs
        WHERE state = 'claimed' AND claimed_at < p_stale_before
            AND (p_phone_number_ids IS NULL OR phone_number_id = ANY(p_phone_number_ids))
        FOR UPDATE SKIP LOCKED)
    UPDATE public.whatsapp_jobs j SET
        state = CASE WHEN attempts >= 5 THEN 'dead' ELSE 'pending' END::public.whatsapp_job_state,
        claimed_at = NULL, claimed_by = NULL,
        failure_reason = CASE WHEN attempts >= 5 THEN coalesce(failure_reason, 'worker_crashed') ELSE failure_reason END,
        last_error = CASE WHEN attempts >= 5 THEN coalesce(last_error, 'worker_crashed') ELSE last_error END,
        terminal_cause = CASE WHEN attempts >= 5 THEN 'attempts_exhausted' ELSE NULL END
    FROM stale WHERE j.id = stale.id RETURNING j.*;
$$;

-- The terminal transition and apology commit together, including recovery.
-- Use transaction now() for the receipt window on all paths, including fenced
-- table finalizers that have no p_now. RPC clocks only select/schedule work.
CREATE FUNCTION public.whatsapp_job_death_hook() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_school uuid; v_window timestamptz; v_recipient text;
BEGIN
    IF NEW.state <> 'dead' OR OLD.state = 'dead' OR NEW.terminal_cause IS DISTINCT FROM 'attempts_exhausted'
        OR NEW.kind <> 'inbound_message' THEN RETURN NEW; END IF;
    v_recipient := NEW.payload->>'waId';
    IF coalesce(v_recipient, '') = '' THEN RETURN NEW; END IF;
    SELECT max(created_at) + interval '24 hours' INTO v_window FROM public.whatsapp_jobs
        WHERE kind = 'inbound_message' AND phone_number_id = NEW.phone_number_id
            AND payload->>'waId' = v_recipient AND created_at <= now();
    IF v_window IS NULL OR v_window <= now() THEN RETURN NEW; END IF;
    SELECT school_id INTO v_school FROM public.school_settings
        WHERE whatsapp_phone_number_id = NEW.phone_number_id
            AND (NEW.school_id IS NULL OR school_id = NEW.school_id);
    IF v_school IS NOT NULL THEN
        PERFORM public.enqueue_whatsapp_delivery(v_school, v_recipient, NEW.phone_number_id,
            'job-fallback/' || NEW.id, p_body => 'Sorry, we''re having trouble replying right now. Please message us again in a bit.',
            p_window_expires_at => v_window);
    END IF;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_whatsapp_jobs(text, integer, timestamptz, boolean, text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.start_whatsapp_job(uuid, text, timestamptz, integer, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recover_whatsapp_jobs(timestamptz, text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.whatsapp_job_death_hook() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_whatsapp_jobs(text, integer, timestamptz, boolean, text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.start_whatsapp_job(uuid, text, timestamptz, integer, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.recover_whatsapp_jobs(timestamptz, text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.whatsapp_job_death_hook() TO service_role;
