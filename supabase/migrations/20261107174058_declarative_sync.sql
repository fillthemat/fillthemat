SET local check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.claim_email_deliveries (
  p_run_id text,
  p_limit  integer                  DEFAULT 25,
  p_now    timestamp with time zone DEFAULT now(),
  p_ids    uuid[]                   DEFAULT NULL::uuid[]
)
  RETURNS SETOF public.email_deliveries
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
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
$function$;

REVOKE ALL ON FUNCTION "public"."claim_email_deliveries"(text, integer, timestamp WITH time zone, uuid[]) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.enqueue_email_delivery (
  p_school_id  uuid,
  p_kind       public.email_kind,
  p_recipient  text,
  p_key        text,
  p_booking_id uuid                     DEFAULT NULL::uuid,
  p_lead_id    uuid                     DEFAULT NULL::uuid,
  p_now        timestamp with time zone DEFAULT now()
)
  RETURNS uuid
  LANGUAGE sql
  SET search_path TO ''
  AS $function$
    INSERT INTO public.email_deliveries
        (school_id, kind, recipient, provider_idempotency_key, booking_id, lead_id, next_attempt_at)
    VALUES (p_school_id, p_kind, p_recipient, p_key, p_booking_id, p_lead_id, p_now)
    ON CONFLICT (provider_idempotency_key) DO NOTHING RETURNING id;
$function$;

REVOKE ALL ON FUNCTION "public"."enqueue_email_delivery"(uuid, public.email_kind, text, text, uuid, uuid, timestamp WITH time zone) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.enqueue_email_reminders (
  p_now timestamp with time zone DEFAULT now()
)
  RETURNS integer
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
DECLARE v_count integer;
BEGIN
    INSERT INTO public.email_deliveries
        (school_id, booking_id, kind, recipient, provider_idempotency_key, next_attempt_at)
    SELECT school_id, id, 'booking_reminder', contact_email_snapshot, 'booking-reminder/' || id, p_now
    FROM public.bookings
    WHERE status = 'booked' AND contact_email_snapshot IS NOT NULL
        AND start_at > p_now AND start_at <= p_now + interval '24 hours'
        AND start_at - created_at >= interval '48 hours'
    ON CONFLICT (provider_idempotency_key) DO NOTHING;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION "public"."enqueue_email_reminders"(timestamp WITH time zone) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.recover_email_deliveries (
  p_stale_before timestamp with time zone,
  p_ids          uuid[]                   DEFAULT NULL::uuid[]
)
  RETURNS SETOF public.email_deliveries
  LANGUAGE sql
  SET search_path TO ''
  AS $function$
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
$function$;

REVOKE ALL ON FUNCTION "public"."recover_email_deliveries"(timestamp WITH time zone, uuid[]) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.start_email_delivery (
  p_id         uuid,
  p_claimed_by text,
  p_claimed_at timestamp with time zone,
  p_attempts   integer
)
  RETURNS SETOF public.email_deliveries
  LANGUAGE sql
  SET search_path TO ''
  AS $function$
    UPDATE public.email_deliveries SET attempts = attempts + 1
    WHERE id = p_id AND state = 'claimed' AND claimed_by = p_claimed_by
        AND claimed_at = p_claimed_at AND attempts = p_attempts AND attempts < 5
    RETURNING *;
$function$;

REVOKE ALL ON FUNCTION "public"."start_email_delivery"(uuid, text, timestamp WITH time zone, integer) FROM PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."claim_email_deliveries"(text, integer, timestamp WITH time zone, uuid[]) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."claim_email_deliveries"(text, integer, timestamp WITH time zone, uuid[]) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."claim_email_deliveries"(text, integer, timestamp WITH time zone, uuid[]) TO "service_role";

REVOKE ALL ON FUNCTION "public"."enqueue_email_delivery"(uuid, public.email_kind, text, text, uuid, uuid, timestamp WITH time zone) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."enqueue_email_delivery"(uuid, public.email_kind, text, text, uuid, uuid, timestamp WITH time zone) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."enqueue_email_delivery"(uuid, public.email_kind, text, text, uuid, uuid, timestamp WITH time zone) TO "service_role";

REVOKE ALL ON FUNCTION "public"."enqueue_email_reminders"(timestamp WITH time zone) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."enqueue_email_reminders"(timestamp WITH time zone) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."enqueue_email_reminders"(timestamp WITH time zone) TO "service_role";

REVOKE ALL ON FUNCTION "public"."recover_email_deliveries"(timestamp WITH time zone, uuid[]) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."recover_email_deliveries"(timestamp WITH time zone, uuid[]) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."recover_email_deliveries"(timestamp WITH time zone, uuid[]) TO "service_role";

REVOKE ALL ON FUNCTION "public"."start_email_delivery"(uuid, text, timestamp WITH time zone, integer) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."start_email_delivery"(uuid, text, timestamp WITH time zone, integer) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."start_email_delivery"(uuid, text, timestamp WITH time zone, integer) TO "service_role";
