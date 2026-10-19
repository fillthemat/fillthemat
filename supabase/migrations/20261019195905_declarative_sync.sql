SET local check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.get_overview_metrics (
  p_school_id uuid,
  p_now       timestamp with time zone DEFAULT now()
)
  RETURNS TABLE (
    upcoming_bookings            integer,
    leads                        integer,
    eligible_bookings            integer,
    converted_sessions           integer,
    chat_assisted_booking_events integer,
    active_trial_classes         integer,
    active_class_times           integer,
    failed_emails                integer
  )
  LANGUAGE sql
  STABLE
  SET search_path TO ''
  AS $function$
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
      AND s.owner_user_id = (SELECT auth.uid());
$function$;

REVOKE ALL ON FUNCTION "public"."get_overview_metrics"(uuid, timestamp WITH time zone) FROM PUBLIC, "anon";

GRANT EXECUTE ON FUNCTION "public"."get_overview_metrics"(uuid, timestamp WITH time zone) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."get_overview_metrics"(uuid, timestamp WITH time zone) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."get_overview_metrics"(uuid, timestamp WITH time zone) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."get_overview_metrics"(uuid, timestamp WITH time zone) TO "service_role";
