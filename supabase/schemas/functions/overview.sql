CREATE OR REPLACE FUNCTION public.get_overview_metrics(
    p_school_id uuid,
    p_now timestamptz DEFAULT now()
)
RETURNS TABLE (
    upcoming_bookings integer,
    leads integer,
    eligible_bookings integer,
    converted_sessions integer,
    chat_assisted_booking_events integer,
    active_trial_classes integer,
    active_class_times integer,
    failed_emails integer
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT
        (
            SELECT count(*)::integer
            FROM public.bookings b
            WHERE b.school_id = s.id
              AND b.status = 'booked'
              AND b.start_at >= p_now
        ),
        (
            SELECT count(*)::integer
            FROM public.leads l
            WHERE l.school_id = s.id
        ),
        (
            SELECT count(*)::integer
            FROM public.landing_sessions ls
            WHERE ls.school_id = s.id
              AND ls.qualified_at IS NOT NULL
        ),
        (
            SELECT count(*)::integer
            FROM public.landing_sessions ls
            WHERE ls.school_id = s.id
              AND ls.qualified_at IS NOT NULL
              AND EXISTS (
                  SELECT 1
                  FROM public.bookings b
                  WHERE b.school_id = s.id
                    AND b.landing_session_id = ls.id
              )
        ),
        (
            SELECT count(*)::integer
            FROM public.funnel_events fe
            WHERE fe.school_id = s.id
              AND fe.event_type = 'booking_confirmed'
              AND fe.metadata ->> 'source' = 'chat'
        ),
        (
            SELECT count(*)::integer
            FROM public.trial_offerings o
            WHERE o.school_id = s.id
              AND o.active = true
        ),
        (
            SELECT count(*)::integer
            FROM public.trial_windows w
            WHERE w.school_id = s.id
              AND w.active = true
        ),
        (
            SELECT count(*)::integer
            FROM public.email_deliveries e
            WHERE e.school_id = s.id
              AND e.state = 'failed'
        )
    FROM public.schools s
    WHERE s.id = p_school_id
      AND s.id = (SELECT school_id FROM public.school_settings WHERE owner_user_id = (SELECT auth.uid()));
$$;

REVOKE EXECUTE ON FUNCTION public.get_overview_metrics(uuid, timestamptz)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_overview_metrics(uuid, timestamptz)
TO authenticated;
