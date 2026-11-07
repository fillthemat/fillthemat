CREATE FUNCTION public.enqueue_whatsapp_delivery(p_school_id uuid, p_recipient text, p_phone_number_id text,
    p_key text, p_template_name text DEFAULT NULL, p_template_params jsonb DEFAULT NULL,
    p_body text DEFAULT NULL, p_buttons jsonb DEFAULT NULL, p_window_expires_at timestamptz DEFAULT NULL,
    p_booking_id uuid DEFAULT NULL, p_lead_id uuid DEFAULT NULL, p_now timestamptz DEFAULT now())
RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
    INSERT INTO public.whatsapp_deliveries (school_id, recipient_wa_id, phone_number_id,
        provider_idempotency_key, template_name, template_params, body, interactive_buttons,
        window_expires_at, booking_id, lead_id, next_attempt_at)
    VALUES (p_school_id, p_recipient, p_phone_number_id, p_key, p_template_name, p_template_params,
        p_body, p_buttons, p_window_expires_at, p_booking_id, p_lead_id, p_now)
    ON CONFLICT (provider_idempotency_key) DO NOTHING RETURNING id;
$$;

CREATE FUNCTION public.claim_whatsapp_deliveries(p_run_id text, p_limit integer DEFAULT 25,
    p_now timestamptz DEFAULT now(), p_ids uuid[] DEFAULT NULL,
    p_retry_only boolean DEFAULT false, p_phone_number_ids text[] DEFAULT NULL)
RETURNS SETOF public.whatsapp_deliveries LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_ids uuid[] := '{}'; v_lane integer; v_capacity integer; v_fresh boolean;
BEGIN
    IF p_limit <= 0 THEN RETURN; END IF;
    FOR v_lane IN 1..4 LOOP
        v_fresh := v_lane IN (1, 3);
        IF p_retry_only AND v_fresh THEN CONTINUE; END IF;
        v_capacity := CASE WHEN p_retry_only THEN p_limit - cardinality(v_ids)
            WHEN v_lane = 1 THEN p_limit - p_limit / 5 WHEN v_lane = 2 THEN p_limit / 5
            ELSE p_limit - cardinality(v_ids) END;
        v_ids := v_ids || ARRAY(SELECT id FROM public.whatsapp_deliveries
            WHERE state IN ('pending', 'failed') AND next_attempt_at <= p_now
                AND (attempts = 0) = v_fresh AND NOT (id = ANY(v_ids))
                AND (p_ids IS NULL OR id = ANY(p_ids))
                AND (p_phone_number_ids IS NULL OR phone_number_id = ANY(p_phone_number_ids))
            ORDER BY created_at, id LIMIT v_capacity FOR UPDATE SKIP LOCKED);
    END LOOP;
    RETURN QUERY WITH claimed AS (
        UPDATE public.whatsapp_deliveries SET state = 'claimed', claimed_at = p_now, claimed_by = p_run_id
        WHERE id = ANY(v_ids) RETURNING *
    ) SELECT * FROM claimed ORDER BY (attempts > 0), created_at, id;
END;
$$;

CREATE FUNCTION public.start_whatsapp_delivery(p_id uuid, p_claimed_by text, p_claimed_at timestamptz, p_attempts integer)
RETURNS SETOF public.whatsapp_deliveries LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
    UPDATE public.whatsapp_deliveries SET attempts = attempts + 1,
        send_outcome = 'unknown', provider_id = NULL, status_at = NULL
    WHERE id = p_id AND state = 'claimed' AND claimed_by = p_claimed_by
        AND claimed_at = p_claimed_at AND attempts = p_attempts AND attempts < 5 RETURNING *;
$$;

CREATE FUNCTION public.recover_whatsapp_deliveries(p_stale_before timestamptz,
    p_phone_number_ids text[] DEFAULT NULL, p_now timestamptz DEFAULT now())
RETURNS SETOF public.whatsapp_deliveries LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
    WITH stale AS (SELECT d.id, (d.template_name = 'booking_confirmation' AND EXISTS (
            SELECT 1 FROM public.bookings b WHERE b.id = d.booking_id AND b.school_id = d.school_id AND b.start_at <= p_now)) AS expired
        FROM public.whatsapp_deliveries d
        WHERE d.state = 'claimed' AND d.claimed_at < p_stale_before
            AND (p_phone_number_ids IS NULL OR d.phone_number_id = ANY(p_phone_number_ids))
        FOR UPDATE OF d SKIP LOCKED)
    UPDATE public.whatsapp_deliveries d SET
        state = CASE WHEN stale.expired OR attempts >= 5 THEN 'dead' ELSE 'pending' END::public.whatsapp_delivery_state,
        claimed_at = NULL, claimed_by = NULL,
        failure_reason = CASE WHEN stale.expired THEN 'booking_confirmation_stale'
            WHEN attempts >= 5 THEN coalesce(failure_reason, 'worker_crashed') ELSE failure_reason END,
        last_error = CASE WHEN stale.expired OR attempts >= 5 THEN coalesce(last_error, 'worker_crashed') ELSE last_error END,
        terminal_cause = CASE WHEN stale.expired THEN 'stale' WHEN attempts >= 5 THEN 'attempts_exhausted' ELSE NULL END
    FROM stale WHERE d.id = stale.id RETURNING d.*;
$$;

-- Cross-outbox hooks commit with every transition, not just the worker path.
-- Hooks deliberately use transaction now(): fenced table finalizers have no
-- p_now, so expiry/notification eligibility uses one DB clock on every path.
-- RPC p_now controls scheduling/recovery cutoffs, not the hook's wall clock.
CREATE FUNCTION public.whatsapp_confirmation_hook() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_email text;
BEGIN
    IF NEW.booking_id IS NULL OR NEW.template_name IS DISTINCT FROM 'booking_confirmation' THEN RETURN NEW; END IF;
    IF NEW.state = 'dead' AND OLD.state <> 'dead' AND NEW.terminal_cause <> 'stale'
        AND EXISTS (SELECT 1 FROM public.bookings WHERE id = NEW.booking_id AND school_id = NEW.school_id AND start_at > now()) THEN
        SELECT notification_email INTO v_email FROM public.school_settings WHERE school_id = NEW.school_id;
        v_email := nullif(btrim(v_email), '');
        IF v_email IS NOT NULL THEN
            PERFORM public.enqueue_email_delivery(NEW.school_id, 'owner_whatsapp_confirmation_failed', v_email,
                'owner-whatsapp-confirmation-failed/' || NEW.booking_id, NEW.booking_id);
        END IF;
    ELSIF NEW.state IN ('delivered', 'read') THEN
        DELETE FROM public.email_deliveries WHERE school_id = NEW.school_id AND booking_id = NEW.booking_id
            AND kind = 'owner_whatsapp_confirmation_failed' AND state IN ('pending', 'failed') AND attempts = 0;
    END IF;
    RETURN NEW;
END;
$$;

-- Serialize receipts with claims/start/recovery. p_permanent is classified by
-- retry-policy.ts; expiry and execution budget are locked database facts.
CREATE FUNCTION public.apply_whatsapp_status(p_wamid text, p_status text,
    p_status_at timestamptz DEFAULT NULL, p_callback_id uuid DEFAULT NULL,
    p_callback_attempt integer DEFAULT NULL, p_phone_number_id text DEFAULT NULL,
    p_permanent boolean DEFAULT false, p_code integer DEFAULT NULL,
    p_error text DEFAULT 'delivery_failed', p_now timestamptz DEFAULT now())
RETURNS SETOF public.whatsapp_deliveries LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE d public.whatsapp_deliveries; v_at timestamptz; v_stale boolean; v_cause text;
BEGIN
    IF p_status NOT IN ('sent', 'delivered', 'read', 'failed') THEN RETURN; END IF;
    SELECT * INTO d FROM public.whatsapp_deliveries
        WHERE provider_id = p_wamid OR (id = p_callback_id AND attempts = p_callback_attempt
            AND p_callback_attempt BETWEEN 1 AND 5 AND phone_number_id = p_phone_number_id
            AND send_outcome = 'unknown' AND provider_id IS NULL)
        LIMIT 1 FOR UPDATE;
    IF NOT FOUND THEN RETURN; END IF;
    v_at := coalesce(p_status_at, d.status_at, d.sent_at, p_now);
    IF p_status_at IS NOT NULL AND d.status_at IS NOT NULL AND v_at <= d.status_at THEN RETURN; END IF;
    IF d.state = 'read' OR (d.state = 'delivered' AND p_status <> 'read') THEN RETURN; END IF;
    IF d.state = 'dead' AND (d.send_outcome IS DISTINCT FROM 'unknown' OR p_status = 'failed') THEN RETURN; END IF;
    IF p_status = 'failed' THEN
        IF d.state <> 'sent' AND d.send_outcome IS DISTINCT FROM 'unknown' THEN RETURN; END IF;
        v_stale := d.template_name = 'booking_confirmation' AND EXISTS (
            SELECT 1 FROM public.bookings WHERE id = d.booking_id AND school_id = d.school_id AND start_at <= p_now);
        v_cause := CASE WHEN v_stale THEN 'stale' WHEN p_permanent THEN 'permanent'
            WHEN d.attempts >= 5 THEN 'attempts_exhausted' ELSE NULL END;
        RETURN QUERY UPDATE public.whatsapp_deliveries SET
            state = CASE WHEN v_cause IS NULL THEN 'failed' ELSE 'dead' END::public.whatsapp_delivery_state,
            send_outcome = 'accepted', provider_id = p_wamid, status_at = v_at,
            next_attempt_at = CASE WHEN v_cause IS NULL THEN p_now + interval '10 seconds' * power(2, greatest(0, d.attempts - 1)) ELSE next_attempt_at END,
            last_error = left(p_error, 500), failure_code = p_code,
            failure_reason = CASE WHEN v_stale THEN 'booking_confirmation_stale' ELSE 'whatsapp_error' END,
            terminal_cause = v_cause, claimed_at = NULL, claimed_by = NULL WHERE id = d.id RETURNING *;
        RETURN;
    END IF;
    -- Only delivered/read may cancel the retry of a known failed attempt.
    -- A successor start clears provider_id, invalidating the old receipt.
    IF d.state IN ('pending', 'claimed', 'failed') AND d.send_outcome IS DISTINCT FROM 'unknown'
        AND p_status = 'sent' THEN RETURN; END IF;
    RETURN QUERY UPDATE public.whatsapp_deliveries SET state = p_status::public.whatsapp_delivery_state,
        send_outcome = 'accepted', provider_id = p_wamid, status_at = v_at, sent_at = coalesce(sent_at, v_at),
        last_error = NULL, failure_code = NULL, failure_reason = NULL, terminal_cause = NULL,
        claimed_at = NULL, claimed_by = NULL WHERE id = d.id RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_whatsapp_delivery(uuid, text, text, text, text, jsonb, text, jsonb, timestamptz, uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_whatsapp_deliveries(text, integer, timestamptz, uuid[], boolean, text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.start_whatsapp_delivery(uuid, text, timestamptz, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recover_whatsapp_deliveries(timestamptz, text[], timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.whatsapp_confirmation_hook() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_whatsapp_status(text, text, timestamptz, uuid, integer, text, boolean, integer, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_whatsapp_delivery(uuid, text, text, text, text, jsonb, text, jsonb, timestamptz, uuid, uuid, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_whatsapp_deliveries(text, integer, timestamptz, uuid[], boolean, text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.start_whatsapp_delivery(uuid, text, timestamptz, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.recover_whatsapp_deliveries(timestamptz, text[], timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.whatsapp_confirmation_hook() TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_whatsapp_status(text, text, timestamptz, uuid, integer, text, boolean, integer, text, timestamptz) TO service_role;
