-- Application access/Turnstile/quota checks precede this service-only boundary.
-- No INSERT booking triggers exist: this function owns all booking side effects.
CREATE FUNCTION public.book_trial(
    p_school_id uuid, p_offering_id uuid, p_window_id uuid, p_start_at timestamptz,
    p_idempotency_key text, p_contact_name text, p_email text, p_phone text,
    p_participant_name text, p_participant_age integer,
    p_landing_token_hash text DEFAULT NULL, p_resume_token_hash text DEFAULT NULL,
    p_conversation_id uuid DEFAULT NULL, p_now timestamptz DEFAULT now()
)
RETURNS TABLE (booking public.bookings, idempotent boolean)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
    v_booking public.bookings;
    v_school public.schools;
    v_profile public.school_profiles;
    v_offering public.trial_offerings;
    v_window public.trial_windows;
    v_occurrence public.trial_occurrences;
    v_contact_id uuid;
    v_participant_id uuid;
    v_landing_id uuid;
    v_conversation_id uuid;
    v_notification_email text;
    v_local timestamp;
    v_email text := nullif(lower(btrim(p_email)), '');
    v_name text := btrim(p_participant_name);
    v_constraint text;
BEGIN
    -- Serialize retries even when they select different occurrences.
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
        'book-trial:' || p_school_id::text || ':' || p_idempotency_key, 0));
    SELECT * INTO v_booking FROM public.bookings
    WHERE school_id = p_school_id AND idempotency_key = p_idempotency_key;
    IF FOUND THEN RETURN QUERY SELECT v_booking, true; RETURN; END IF;
    SELECT * INTO v_school FROM public.schools WHERE id = p_school_id;
    IF NOT FOUND OR v_school.approved_at IS NULL OR v_school.published_at IS NULL THEN
        RAISE EXCEPTION 'school_not_public';
    END IF;
    SELECT * INTO v_profile FROM public.school_profiles WHERE school_id = p_school_id;
    SELECT * INTO v_offering FROM public.trial_offerings
    WHERE id = p_offering_id AND school_id = p_school_id AND active;
    IF NOT FOUND OR p_participant_age IS NULL OR p_participant_age NOT BETWEEN 0 AND 99
        OR p_participant_age < v_offering.minimum_age OR p_participant_age > v_offering.maximum_age THEN
        RAISE EXCEPTION 'ineligible';
    END IF;
    -- Owner capacity propagation locks the window before its occurrences too.
    SELECT * INTO v_window FROM public.trial_windows
    WHERE id = p_window_id AND school_id = p_school_id AND trial_offering_id = p_offering_id AND active
    FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'invalid_slot'; END IF;
    v_local := p_start_at AT TIME ZONE v_school.timezone;
    IF p_start_at IS NULL OR p_start_at < p_now + interval '120 minutes'
        OR p_start_at > p_now + interval '14 days'
        OR extract(dow FROM v_local) <> v_window.day_of_week
        OR v_local::time <> time '00:00' + v_window.start_minute * interval '1 minute' THEN
        RAISE EXCEPTION 'slot_unavailable';
    END IF;
    INSERT INTO public.trial_occurrences
        (school_id, trial_window_id, trial_offering_id, start_at, end_at, capacity)
    VALUES (p_school_id, p_window_id, p_offering_id, p_start_at,
        p_start_at + v_window.duration_minutes * interval '1 minute', v_window.capacity)
    ON CONFLICT (trial_window_id, start_at) DO NOTHING;
    SELECT * INTO STRICT v_occurrence FROM public.trial_occurrences
    WHERE school_id = p_school_id AND trial_window_id = p_window_id AND start_at = p_start_at FOR UPDATE;
    IF v_occurrence.booked_count >= v_occurrence.capacity THEN RAISE EXCEPTION 'slot_unavailable'; END IF;
    IF v_email IS NOT NULL THEN
        INSERT INTO public.contacts (school_id, email, name, phone)
        VALUES (p_school_id, v_email, btrim(p_contact_name), btrim(p_phone))
        ON CONFLICT (school_id, email) DO UPDATE SET name = excluded.name, phone = excluded.phone
        RETURNING id INTO v_contact_id;
    ELSE
        INSERT INTO public.contacts (school_id, email, name, phone)
        VALUES (p_school_id, NULL, btrim(p_contact_name), btrim(p_phone))
        ON CONFLICT (school_id, phone) DO UPDATE SET name = excluded.name, phone = excluded.phone
        RETURNING id INTO v_contact_id;
    END IF;
    INSERT INTO public.participants (school_id, contact_id, name, normalized_name)
    VALUES (p_school_id, v_contact_id, v_name, lower(regexp_replace(v_name, '\s+', ' ', 'g')))
    ON CONFLICT (contact_id, normalized_name) DO UPDATE SET name = excluded.name
    RETURNING id INTO v_participant_id;
    SELECT id INTO v_landing_id FROM public.landing_sessions
    WHERE school_id = p_school_id AND session_key_hash = p_landing_token_hash;
    UPDATE public.conversations SET contact_id = v_contact_id
    WHERE school_id = p_school_id AND ended_at IS NULL AND expires_at > p_now
        AND ((p_conversation_id IS NOT NULL AND id = p_conversation_id)
            OR (p_conversation_id IS NULL AND resume_token_hash = p_resume_token_hash))
    RETURNING id INTO v_conversation_id;
    v_booking.id := gen_random_uuid();
    INSERT INTO public.bookings (
        id, school_id, contact_id, participant_id, trial_offering_id, trial_window_id,
        trial_occurrence_id, conversation_id, landing_session_id, idempotency_key,
        participant_name_snapshot, participant_age_snapshot, offering_name_snapshot,
        timezone_snapshot, start_at, end_at, location_snapshot, instructions_snapshot,
        contact_email_snapshot, contact_name_snapshot, contact_phone_snapshot, ics_uid
    ) VALUES (
        v_booking.id, p_school_id, v_contact_id, v_participant_id, p_offering_id, p_window_id,
        v_occurrence.id, v_conversation_id, v_landing_id, p_idempotency_key,
        v_name, p_participant_age, v_offering.name, v_school.timezone, p_start_at, v_occurrence.end_at,
        nullif(concat_ws(', ', nullif(v_profile.address, ''), nullif(v_profile.city, ''), nullif(v_profile.country, '')), ''),
        nullif(concat_ws(E'\n', nullif(v_profile.access_notes, ''), nullif(v_profile.parking_notes, ''),
            nullif(coalesce(v_offering.attire, v_profile.trial_guidance), '')), ''),
        v_email, btrim(p_contact_name), btrim(p_phone), v_booking.id::text || '@fillthemat.com'
    ) RETURNING * INTO v_booking;
    UPDATE public.trial_occurrences SET booked_count = booked_count + 1 WHERE id = v_occurrence.id;
    SELECT notification_email INTO STRICT v_notification_email FROM public.school_settings WHERE school_id = p_school_id;
    IF v_email IS NOT NULL THEN
        PERFORM public.enqueue_email_delivery(p_school_id, 'prospect_confirmation', v_email,
            'booking-confirmation/' || v_booking.id, v_booking.id, NULL, p_now);
    END IF;
    PERFORM public.enqueue_email_delivery(p_school_id, 'owner_booking', v_notification_email,
        'owner-booking/' || v_booking.id, v_booking.id, NULL, p_now);
    INSERT INTO public.funnel_events (school_id, booking_id, landing_session_id, conversation_id, event_type, metadata)
    VALUES (p_school_id, v_booking.id, v_landing_id, v_conversation_id, 'booking_confirmed',
        jsonb_build_object('source', CASE WHEN v_conversation_id IS NULL THEN 'direct' ELSE 'chat' END));
    RETURN QUERY SELECT v_booking, false;
EXCEPTION WHEN unique_violation THEN
    -- Roll back every effect, including contact changes and a new occurrence.
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    IF v_constraint = 'bookings_active_participant_occurrence' THEN RAISE EXCEPTION 'already_booked'; END IF;
    RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.book_trial(uuid, uuid, uuid, timestamptz, text, text, text, text, text, integer, text, text, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.book_trial(uuid, uuid, uuid, timestamptz, text, text, text, text, text, integer, text, text, uuid, timestamptz) TO service_role;
