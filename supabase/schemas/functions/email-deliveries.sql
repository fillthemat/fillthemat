-- Reserve 20% for retries, then refill spare capacity. Provider I/O is outside
-- this transaction. See README.md for the queue-claim contract.
CREATE FUNCTION public.claim_email_deliveries(p_run_id text, p_limit integer DEFAULT 25,
    p_now timestamptz DEFAULT now(), p_ids uuid[] DEFAULT NULL)
RETURNS SETOF public.email_deliveries
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
    v_ids uuid[] := '{}';
    v_lane integer;
    v_capacity integer;
    v_fresh boolean;
BEGIN
    IF p_limit <= 0 THEN RETURN; END IF;
    FOR v_lane IN 1..4 LOOP
        v_fresh := v_lane IN (1, 3);
        v_capacity := CASE v_lane WHEN 1 THEN p_limit - p_limit / 5
            WHEN 2 THEN p_limit / 5 ELSE p_limit - cardinality(v_ids) END;
        v_ids := v_ids || ARRAY(
            SELECT id FROM public.email_deliveries
            WHERE state IN ('pending', 'failed') AND next_attempt_at <= p_now
                AND (attempts = 0) = v_fresh
                AND (p_ids IS NULL OR id = ANY(p_ids)) AND NOT (id = ANY(v_ids))
            ORDER BY created_at, id LIMIT v_capacity FOR UPDATE SKIP LOCKED
        );
    END LOOP;
    RETURN QUERY WITH claimed AS (
        UPDATE public.email_deliveries SET state = 'claimed', claimed_at = p_now, claimed_by = p_run_id
        WHERE id = ANY(v_ids) RETURNING *
    ) SELECT * FROM claimed ORDER BY (attempts > 0), created_at, id;
END;
$$;

-- Fence duplicate starts as well as stale workers. Five started executions,
-- including crashed work, is the budget shared with retry-policy.ts.
CREATE FUNCTION public.start_email_delivery(p_id uuid, p_claimed_by text,
    p_claimed_at timestamptz, p_attempts integer)
RETURNS SETOF public.email_deliveries
LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
    UPDATE public.email_deliveries SET attempts = attempts + 1
    WHERE id = p_id AND state = 'claimed' AND claimed_by = p_claimed_by
        AND claimed_at = p_claimed_at AND attempts = p_attempts AND attempts < 5
    RETURNING *;
$$;

CREATE FUNCTION public.recover_email_deliveries(p_stale_before timestamptz,
    p_ids uuid[] DEFAULT NULL)
RETURNS SETOF public.email_deliveries
LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
    WITH stale AS (
        SELECT id FROM public.email_deliveries
        WHERE state = 'claimed' AND claimed_at < p_stale_before
            AND (p_ids IS NULL OR id = ANY(p_ids))
        FOR UPDATE SKIP LOCKED
    )
    UPDATE public.email_deliveries d SET
        state = CASE WHEN attempts >= 5 THEN 'dead' ELSE 'pending' END::public.email_state,
        claimed_at = NULL, claimed_by = NULL,
        failure_reason = CASE WHEN attempts >= 5 THEN coalesce(failure_reason, 'worker_crashed') ELSE failure_reason END,
        last_error = CASE WHEN attempts >= 5 THEN coalesce(last_error, 'worker_crashed') ELSE last_error END,
        terminal_cause = CASE WHEN attempts >= 5 THEN 'attempts_exhausted' ELSE NULL END
    FROM stale WHERE d.id = stale.id RETURNING d.*;
$$;

-- Compose inside future booking/lead/Turn RPCs. Duplicates never reset state.
CREATE FUNCTION public.enqueue_email_delivery(p_school_id uuid, p_kind public.email_kind,
    p_recipient text, p_key text, p_booking_id uuid DEFAULT NULL, p_lead_id uuid DEFAULT NULL,
    p_now timestamptz DEFAULT now())
RETURNS uuid
LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
    INSERT INTO public.email_deliveries
        (school_id, kind, recipient, provider_idempotency_key, booking_id, lead_id, next_attempt_at)
    VALUES (p_school_id, p_kind, p_recipient, p_key, p_booking_id, p_lead_id, p_now)
    ON CONFLICT (provider_idempotency_key) DO NOTHING RETURNING id;
$$;

CREATE FUNCTION public.enqueue_email_reminders(p_now timestamptz DEFAULT now())
RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_count integer;
BEGIN
    INSERT INTO public.email_deliveries
        (school_id, booking_id, kind, recipient, provider_idempotency_key, next_attempt_at)
    SELECT school_id, id, 'booking_reminder', contact_email_snapshot, 'booking-reminder/' || id, p_now
    FROM public.bookings
    WHERE status = 'booked' AND contact_email_snapshot IS NOT NULL
        AND start_at > p_now AND start_at <= p_now + interval '24 hours'
        AND start_at - created_at >= interval '36 hours'
    ON CONFLICT (provider_idempotency_key) DO NOTHING;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_email_deliveries(text, integer, timestamptz, uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.start_email_delivery(uuid, text, timestamptz, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recover_email_deliveries(timestamptz, uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_email_delivery(uuid, public.email_kind, text, text, uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_email_reminders(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_email_deliveries(text, integer, timestamptz, uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.start_email_delivery(uuid, text, timestamptz, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.recover_email_deliveries(timestamptz, uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_email_delivery(uuid, public.email_kind, text, text, uuid, uuid, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_email_reminders(timestamptz) TO service_role;
