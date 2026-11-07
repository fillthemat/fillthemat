SET local check_function_bodies = off;

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
        AND start_at - created_at >= interval '36 hours'
    ON CONFLICT (provider_idempotency_key) DO NOTHING;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$function$;
