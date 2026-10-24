SET local check_function_bodies = off;

ALTER TABLE "public"."schools"
  DROP CONSTRAINT "schools_logo_url";

ALTER TABLE "public"."schools"
  DROP CONSTRAINT "schools_primary_color";

ALTER TABLE "public"."schools"
  DROP COLUMN "access_notes";

ALTER TABLE "public"."schools"
  DROP COLUMN "address";

ALTER TABLE "public"."schools"
  DROP COLUMN "agent_instructions";

ALTER TABLE "public"."schools"
  DROP COLUMN "city";

ALTER TABLE "public"."schools"
  DROP COLUMN "country";

ALTER TABLE "public"."schools"
  DROP COLUMN "logo_url";

ALTER TABLE "public"."schools"
  DROP COLUMN "name";

ALTER TABLE "public"."schools"
  DROP COLUMN "notification_email";

ALTER TABLE "public"."schools"
  DROP COLUMN "parking_notes";

ALTER TABLE "public"."schools"
  DROP COLUMN "phone";

ALTER TABLE "public"."schools"
  DROP COLUMN "pricing";

ALTER TABLE "public"."schools"
  DROP COLUMN "primary_color";

ALTER TABLE "public"."schools"
  DROP COLUMN "trial_guidance";

ALTER TABLE "public"."schools"
  DROP COLUMN "website";

ALTER TABLE "public"."schools"
  DROP COLUMN "welcome_message";

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
    FROM public.school_settings WHERE school_id = v_booking.school_id;

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

CREATE OR REPLACE FUNCTION public.create_settings_faq (
  p_school_id uuid,
  p_question  text,
  p_answer    text
)
  RETURNS SETOF public.faqs
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE v_count integer;
BEGIN
    PERFORM 1 FROM public.schools
    WHERE id = p_school_id AND owner_user_id = (SELECT auth.uid()) FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'school_not_found' USING ERRCODE = '42501'; END IF;
    SELECT count(*) INTO v_count FROM public.faqs WHERE school_id = p_school_id;
    IF v_count >= 20 THEN RAISE EXCEPTION 'faq_limit_reached' USING ERRCODE = '23514'; END IF;
    RETURN QUERY INSERT INTO public.faqs (school_id, question, answer, sort_order)
    VALUES (p_school_id, p_question, p_answer, v_count) RETURNING *;
END;
$function$;

REVOKE ALL ON FUNCTION "public"."create_settings_faq"(uuid, text, text) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.delete_settings_window (
  p_window_id uuid
)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE v_school_id uuid;
BEGIN
    SELECT w.school_id INTO v_school_id FROM public.trial_windows w
    JOIN public.schools s ON s.id = w.school_id
    WHERE w.id = p_window_id AND s.owner_user_id = (SELECT auth.uid()) FOR UPDATE OF w;
    IF NOT FOUND THEN RETURN 'not_found'; END IF;
    IF EXISTS (SELECT 1 FROM public.trial_occurrences WHERE trial_window_id = p_window_id AND school_id = v_school_id) THEN
        RETURN 'on_calendar';
    END IF;
    DELETE FROM public.trial_windows WHERE id = p_window_id;
    RETURN 'deleted';
END;
$function$;

REVOKE ALL ON FUNCTION "public"."delete_settings_window"(uuid) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.get_settings_windows (
  p_school_id uuid
)
  RETURNS TABLE (
    id                   uuid,
    trial_offering_id    uuid,
    offering_name        text,
    offering_active      boolean,
    day_of_week          integer,
    start_minute         integer,
    duration_minutes     integer,
    capacity             integer,
    label                text,
    active               boolean,
    on_calendar          boolean,
    has_upcoming_booking boolean,
    max_upcoming_booked  integer
  )
  LANGUAGE sql
  STABLE
  SET search_path TO ''
  AS $function$
    SELECT w.id, w.trial_offering_id, o.name, o.active, w.day_of_week, w.start_minute,
        w.duration_minutes, w.capacity, w.label, w.active,
        EXISTS (SELECT 1 FROM public.trial_occurrences t WHERE t.trial_window_id = w.id AND t.school_id = w.school_id),
        EXISTS (SELECT 1 FROM public.bookings b WHERE b.trial_window_id = w.id AND b.school_id = w.school_id AND b.status <> 'cancelled' AND b.start_at > now()),
        (SELECT coalesce(max(t.booked_count), 0) FROM public.trial_occurrences t WHERE t.trial_window_id = w.id AND t.school_id = w.school_id AND t.start_at > now())
    FROM public.trial_windows w
    JOIN public.trial_offerings o ON o.id = w.trial_offering_id AND o.school_id = w.school_id
    WHERE w.school_id = p_school_id
    ORDER BY w.day_of_week, w.start_minute;
$function$;

REVOKE ALL ON FUNCTION "public"."get_settings_windows"(uuid) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.update_school_profile (
  p_school_id uuid,
  p_slug      text,
  p_timezone  text,
  p_profile   jsonb
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
BEGIN
    PERFORM 1 FROM public.schools
    WHERE id = p_school_id AND owner_user_id = (SELECT auth.uid()) FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'school_not_found' USING ERRCODE = '42501'; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = p_timezone) THEN
        RAISE EXCEPTION 'invalid_timezone' USING ERRCODE = '22023';
    END IF;
    -- The schools trigger rejects identity changes after publication.
    UPDATE public.schools SET slug = p_slug, timezone = p_timezone, updated_at = now()
    WHERE id = p_school_id;
    INSERT INTO public.school_settings (
        school_id, name, notification_email, phone, website, address, city, country,
        parking_notes, access_notes, trial_guidance
    ) VALUES (
        p_school_id, p_profile->>'name', p_profile->>'notification_email',
        p_profile->>'phone', p_profile->>'website', p_profile->>'address', p_profile->>'city',
        coalesce(p_profile->>'country', 'US'), p_profile->>'parking_notes',
        p_profile->>'access_notes', p_profile->>'trial_guidance'
    ) ON CONFLICT (school_id) DO UPDATE SET
        name = EXCLUDED.name, notification_email = EXCLUDED.notification_email,
        phone = EXCLUDED.phone, website = EXCLUDED.website, address = EXCLUDED.address,
        city = EXCLUDED.city, country = EXCLUDED.country, parking_notes = EXCLUDED.parking_notes,
        access_notes = EXCLUDED.access_notes, trial_guidance = EXCLUDED.trial_guidance, updated_at = now();
END;
$function$;

REVOKE ALL ON FUNCTION "public"."update_school_profile"(uuid, text, text, jsonb) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.update_settings_window_capacity (
  p_window_id uuid,
  p_capacity  integer
)
  RETURNS TABLE (
    result     text,
    max_booked integer
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE v_school_id uuid; v_booked integer;
BEGIN
    IF p_capacity IS NULL OR p_capacity NOT BETWEEN 1 AND 50 THEN
        RAISE EXCEPTION 'invalid_capacity' USING ERRCODE = '22023';
    END IF;
    SELECT w.school_id INTO v_school_id FROM public.trial_windows w
    JOIN public.schools s ON s.id = w.school_id
    WHERE w.id = p_window_id AND s.owner_user_id = (SELECT auth.uid()) FOR UPDATE OF w;
    IF NOT FOUND THEN RETURN QUERY SELECT 'not_found'::text, 0; RETURN; END IF;
    PERFORM 1 FROM public.trial_occurrences
    WHERE trial_window_id = p_window_id AND school_id = v_school_id AND start_at > now()
    ORDER BY id FOR UPDATE;
    SELECT coalesce(max(booked_count), 0) INTO v_booked FROM public.trial_occurrences
    WHERE trial_window_id = p_window_id AND school_id = v_school_id AND start_at > now();
    IF v_booked > p_capacity THEN
        RETURN QUERY SELECT 'below_booked'::text, v_booked; RETURN;
    END IF;
    UPDATE public.trial_windows SET capacity = p_capacity, updated_at = now() WHERE id = p_window_id;
    UPDATE public.trial_occurrences SET capacity = p_capacity, updated_at = now()
    WHERE trial_window_id = p_window_id AND school_id = v_school_id AND start_at > now();
    RETURN QUERY SELECT 'updated'::text, v_booked;
END;
$function$;

REVOKE ALL ON FUNCTION "public"."update_settings_window_capacity"(uuid, integer) FROM PUBLIC, "anon";

CREATE POLICY "faqs_owner_write" ON "public"."faqs"
  FOR ALL
  TO "authenticated"
  USING ((school_id = ( SELECT schools.id
   FROM public.schools
  WHERE (schools.owner_user_id = ( SELECT auth.uid() AS uid)))))
  WITH CHECK ((school_id = ( SELECT schools.id
   FROM public.schools
  WHERE (schools.owner_user_id = ( SELECT auth.uid() AS uid)))));

CREATE POLICY "trial_offerings_owner_write" ON "public"."trial_offerings"
  FOR ALL
  TO "authenticated"
  USING ((school_id = ( SELECT schools.id
   FROM public.schools
  WHERE (schools.owner_user_id = ( SELECT auth.uid() AS uid)))))
  WITH CHECK ((school_id = ( SELECT schools.id
   FROM public.schools
  WHERE (schools.owner_user_id = ( SELECT auth.uid() AS uid)))));

CREATE POLICY "trial_windows_owner_write" ON "public"."trial_windows"
  FOR ALL
  TO "authenticated"
  USING ((school_id = ( SELECT schools.id
   FROM public.schools
  WHERE (schools.owner_user_id = ( SELECT auth.uid() AS uid)))))
  WITH CHECK ((school_id = ( SELECT schools.id
   FROM public.schools
  WHERE (schools.owner_user_id = ( SELECT auth.uid() AS uid)))));

GRANT EXECUTE ON FUNCTION "public"."create_settings_faq"(uuid, text, text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."create_settings_faq"(uuid, text, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."create_settings_faq"(uuid, text, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."create_settings_faq"(uuid, text, text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."delete_settings_window"(uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."delete_settings_window"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."delete_settings_window"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."delete_settings_window"(uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."get_settings_windows"(uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."get_settings_windows"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."get_settings_windows"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."get_settings_windows"(uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."update_school_profile"(uuid, text, text, jsonb) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."update_school_profile"(uuid, text, text, jsonb) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."update_school_profile"(uuid, text, text, jsonb) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."update_school_profile"(uuid, text, text, jsonb) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."update_settings_window_capacity"(uuid, integer) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."update_settings_window_capacity"(uuid, integer) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."update_settings_window_capacity"(uuid, integer) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."update_settings_window_capacity"(uuid, integer) TO "service_role";

REVOKE ALL ON TABLE "public"."faqs" FROM "authenticated";

GRANT DELETE, SELECT, UPDATE ON TABLE "public"."faqs" TO "authenticated";

REVOKE ALL ON TABLE "public"."trial_offerings" FROM "authenticated";

GRANT INSERT, SELECT, UPDATE ON TABLE "public"."trial_offerings" TO "authenticated";

REVOKE ALL ON TABLE "public"."trial_windows" FROM "authenticated";

REVOKE ALL ("active") ON TABLE "public"."trial_windows" FROM "authenticated";

GRANT UPDATE ("active") ON TABLE "public"."trial_windows" TO "authenticated";

REVOKE ALL ("updated_at") ON TABLE "public"."trial_windows" FROM "authenticated";

GRANT UPDATE ("updated_at") ON TABLE "public"."trial_windows" TO "authenticated";

GRANT INSERT, SELECT ON TABLE "public"."trial_windows" TO "authenticated";
