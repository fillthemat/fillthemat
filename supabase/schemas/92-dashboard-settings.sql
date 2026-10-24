-- Identity remains platform-owned. This is the only owner path for changing it.
CREATE FUNCTION public.update_school_profile(p_school_id uuid, p_slug text, p_timezone text, p_profile jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
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
$$;

-- Lock the parent so concurrent inserts cannot exceed the FAQ limit.
CREATE FUNCTION public.create_settings_faq(p_school_id uuid, p_question text, p_answer text)
RETURNS SETOF public.faqs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
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
$$;

CREATE FUNCTION public.update_settings_window_capacity(p_window_id uuid, p_capacity integer)
RETURNS TABLE (result text, max_booked integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
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
$$;

CREATE FUNCTION public.get_settings_windows(p_school_id uuid)
RETURNS TABLE (
    id uuid, trial_offering_id uuid, offering_name text, offering_active boolean,
    day_of_week integer, start_minute integer, duration_minutes integer,
    capacity integer, label text, active boolean, on_calendar boolean,
    has_upcoming_booking boolean, max_upcoming_booked integer
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
    SELECT w.id, w.trial_offering_id, o.name, o.active, w.day_of_week, w.start_minute,
        w.duration_minutes, w.capacity, w.label, w.active,
        EXISTS (SELECT 1 FROM public.trial_occurrences t WHERE t.trial_window_id = w.id AND t.school_id = w.school_id),
        EXISTS (SELECT 1 FROM public.bookings b WHERE b.trial_window_id = w.id AND b.school_id = w.school_id AND b.status <> 'cancelled' AND b.start_at > now()),
        (SELECT coalesce(max(t.booked_count), 0) FROM public.trial_occurrences t WHERE t.trial_window_id = w.id AND t.school_id = w.school_id AND t.start_at > now())
    FROM public.trial_windows w
    JOIN public.trial_offerings o ON o.id = w.trial_offering_id AND o.school_id = w.school_id
    WHERE w.school_id = p_school_id
    ORDER BY w.day_of_week, w.start_minute;
$$;

CREATE FUNCTION public.delete_settings_window(p_window_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
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
$$;

REVOKE ALL ON FUNCTION public.update_school_profile(uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_settings_faq(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_settings_window_capacity(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_settings_windows(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_school_profile(uuid, text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_settings_faq(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_settings_window_capacity(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_settings_windows(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.delete_settings_window(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_settings_window(uuid) TO authenticated;
