SET local check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.cancel_dashboard_booking (
  p_booking_id uuid
)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE
    v_booking public.bookings%ROWTYPE;
    v_notification_email text;
    v_sequence integer;
BEGIN
    SELECT b.* INTO v_booking
    FROM public.bookings b
    WHERE b.id = p_booking_id
      AND EXISTS (
          SELECT 1 FROM public.schools s
          WHERE s.id = b.school_id AND s.owner_user_id = (SELECT auth.uid())
      )
    FOR UPDATE;

    IF NOT FOUND THEN RETURN 'not_found'; END IF;
    IF v_booking.status = 'cancelled' THEN RETURN 'replay'; END IF;
    IF v_booking.status <> 'booked' OR v_booking.start_at <= now() THEN
        RETURN 'not_cancellable';
    END IF;

    v_sequence := v_booking.ics_sequence + 1;
    UPDATE public.bookings
    SET status = 'cancelled', cancelled_at = now(),
        ics_sequence = v_sequence, updated_at = now()
    WHERE id = v_booking.id;

    UPDATE public.trial_occurrences
    SET booked_count = booked_count - 1, updated_at = now()
    WHERE id = v_booking.trial_occurrence_id
      AND school_id = v_booking.school_id AND booked_count > 0;

    SELECT notification_email INTO v_notification_email
    FROM public.schools WHERE id = v_booking.school_id;

    IF v_booking.contact_email_snapshot IS NOT NULL THEN
        INSERT INTO public.email_deliveries (
            school_id, booking_id, kind, recipient, provider_idempotency_key
        ) VALUES (
            v_booking.school_id, v_booking.id, 'booking_cancellation',
            v_booking.contact_email_snapshot,
            'booking-cancellation/' || v_booking.id || '/' || v_sequence
        );
    END IF;
    IF v_notification_email IS NOT NULL AND v_notification_email <> '' THEN
        INSERT INTO public.email_deliveries (
            school_id, booking_id, kind, recipient, provider_idempotency_key
        ) VALUES (
            v_booking.school_id, v_booking.id, 'owner_cancellation',
            v_notification_email,
            'owner-cancellation/' || v_booking.id || '/' || v_sequence
        );
    END IF;

    INSERT INTO public.funnel_events (
        school_id, booking_id, landing_session_id, conversation_id, event_type, metadata
    ) VALUES (
        v_booking.school_id, v_booking.id, v_booking.landing_session_id,
        v_booking.conversation_id, 'booking_cancelled', jsonb_build_object('sequence', v_sequence)
    );
    RETURN 'cancelled';
END;
$function$;

REVOKE ALL ON FUNCTION "public"."cancel_dashboard_booking"(uuid) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.update_booking_attendance (
  p_booking_id uuid,
  p_status     text
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE
    v_school_id uuid;
BEGIN
    IF p_status NOT IN ('showed', 'no_show') OR p_status IS NULL THEN
        RAISE EXCEPTION 'invalid_attendance_status' USING ERRCODE = '22023';
    END IF;

    UPDATE public.bookings b
    SET status = p_status::public.booking_status, updated_at = now()
    WHERE b.id = p_booking_id
      AND b.status IN ('booked', 'showed', 'no_show')
      AND EXISTS (
          SELECT 1 FROM public.schools s
          WHERE s.id = b.school_id AND s.owner_user_id = (SELECT auth.uid())
      )
    RETURNING b.school_id INTO v_school_id;

    IF NOT FOUND THEN RETURN false; END IF;

    INSERT INTO public.funnel_events (school_id, booking_id, event_type)
    VALUES (v_school_id, p_booking_id, p_status);
    RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION "public"."update_booking_attendance"(uuid, text) FROM PUBLIC, "anon";

GRANT EXECUTE ON FUNCTION "public"."cancel_dashboard_booking"(uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."cancel_dashboard_booking"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."cancel_dashboard_booking"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."cancel_dashboard_booking"(uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."update_booking_attendance"(uuid, text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."update_booking_attendance"(uuid, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."update_booking_attendance"(uuid, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."update_booking_attendance"(uuid, text) TO "service_role";
