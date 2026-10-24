-- All capacity updates, including direct owner writes, propagate atomically.
-- The occurrence CHECK constraint rejects capacity below the booked count.
CREATE FUNCTION public.sync_window_capacity()
RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
    PERFORM 1 FROM public.trial_occurrences
    WHERE trial_window_id = NEW.id AND school_id = NEW.school_id AND start_at > now()
    ORDER BY id FOR UPDATE;
    UPDATE public.trial_occurrences SET capacity = NEW.capacity
    WHERE trial_window_id = NEW.id AND school_id = NEW.school_id AND start_at > now();
    RETURN NULL;
END;
$$;

CREATE FUNCTION public.update_settings_window_capacity(p_window_id uuid, p_capacity integer)
RETURNS TABLE (result text, max_booked integer)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_school_id uuid; v_booked integer;
BEGIN
    IF p_capacity IS NULL OR p_capacity NOT BETWEEN 1 AND 50 THEN
        RAISE EXCEPTION 'invalid_capacity' USING ERRCODE = '22023';
    END IF;
    SELECT w.school_id INTO v_school_id FROM public.trial_windows w
    WHERE w.id = p_window_id AND w.school_id = (
        SELECT school_id FROM public.school_settings WHERE owner_user_id = (SELECT auth.uid())
    ) FOR UPDATE;
    IF NOT FOUND THEN RETURN QUERY SELECT 'not_found'::text, 0; RETURN; END IF;
    SELECT coalesce(max(booked_count), 0) INTO v_booked FROM public.trial_occurrences
    WHERE trial_window_id = p_window_id AND school_id = v_school_id AND start_at > now();
    IF v_booked > p_capacity THEN
        RETURN QUERY SELECT 'below_booked'::text, v_booked; RETURN;
    END IF;
    UPDATE public.trial_windows SET capacity = p_capacity WHERE id = p_window_id;
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
      AND w.school_id = (SELECT school_id FROM public.school_settings WHERE owner_user_id = (SELECT auth.uid()))
    ORDER BY w.day_of_week, w.start_minute;
$$;

CREATE FUNCTION public.delete_settings_window(p_window_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_school_id uuid;
BEGIN
    SELECT w.school_id INTO v_school_id FROM public.trial_windows w
    WHERE w.id = p_window_id AND w.school_id = (
        SELECT school_id FROM public.school_settings WHERE owner_user_id = (SELECT auth.uid())
    ) FOR UPDATE;
    IF NOT FOUND THEN RETURN 'not_found'; END IF;
    IF EXISTS (SELECT 1 FROM public.trial_occurrences WHERE trial_window_id = p_window_id AND school_id = v_school_id) THEN
        RETURN 'on_calendar';
    END IF;
    DELETE FROM public.trial_windows WHERE id = p_window_id;
    RETURN 'deleted';
END;
$$;

REVOKE ALL ON FUNCTION public.sync_window_capacity() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_settings_window_capacity(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_settings_windows(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_settings_window(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_settings_window_capacity(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_settings_windows(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_settings_window(uuid) TO authenticated;
