-- Data API owners can update status only. The BEFORE trigger owns derived
-- cancellation fields; the AFTER trigger owns counters, events and outboxes.
-- Privileged platform workflows already handle their own atomic side effects.
CREATE FUNCTION public.validate_owner_booking_transition()
RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
    IF current_user <> 'authenticated' OR NEW.status = OLD.status THEN RETURN NEW; END IF;
    IF NEW.status IN ('showed', 'no_show') AND OLD.status IN ('booked', 'showed', 'no_show') THEN
        RETURN NEW;
    END IF;
    IF NEW.status = 'cancelled' AND OLD.status = 'booked' AND OLD.start_at > now() THEN
        NEW.cancelled_at := now();
        NEW.ics_sequence := OLD.ics_sequence + 1;
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'invalid_booking_status_change' USING ERRCODE = '22023';
END;
$$;

CREATE FUNCTION public.record_owner_booking_transition()
RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_notification_email text;
BEGIN
    IF current_user <> 'authenticated' OR NEW.status = OLD.status THEN RETURN NULL; END IF;
    IF NEW.status IN ('showed', 'no_show') THEN
        INSERT INTO public.funnel_events (school_id, booking_id, event_type)
        VALUES (NEW.school_id, NEW.id, NEW.status::text);
        RETURN NULL;
    END IF;
    UPDATE public.trial_occurrences SET booked_count = booked_count - 1
    WHERE id = NEW.trial_occurrence_id AND school_id = NEW.school_id AND booked_count > 0;
    SELECT notification_email INTO v_notification_email
    FROM public.school_settings WHERE school_id = NEW.school_id;
    IF NEW.contact_email_snapshot IS NOT NULL THEN
        INSERT INTO public.email_deliveries (school_id, booking_id, kind, recipient, provider_idempotency_key)
        VALUES (NEW.school_id, NEW.id, 'booking_cancellation', NEW.contact_email_snapshot,
                'booking-cancellation/' || NEW.id || '/' || NEW.ics_sequence);
    END IF;
    IF v_notification_email IS NOT NULL AND v_notification_email <> '' THEN
        INSERT INTO public.email_deliveries (school_id, booking_id, kind, recipient, provider_idempotency_key)
        VALUES (NEW.school_id, NEW.id, 'owner_cancellation', v_notification_email,
                'owner-cancellation/' || NEW.id || '/' || NEW.ics_sequence);
    END IF;
    INSERT INTO public.funnel_events (school_id, booking_id, landing_session_id, conversation_id, event_type, metadata)
    VALUES (NEW.school_id, NEW.id, NEW.landing_session_id, NEW.conversation_id,
            'booking_cancelled', jsonb_build_object('sequence', NEW.ics_sequence));
    RETURN NULL;
END;
$$;

CREATE FUNCTION public.update_booking_attendance(p_booking_id uuid, p_status text)
RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
    IF p_status NOT IN ('showed', 'no_show') OR p_status IS NULL THEN
        RAISE EXCEPTION 'invalid_attendance_status' USING ERRCODE = '22023';
    END IF;
    UPDATE public.bookings SET status = p_status::public.booking_status
    WHERE id = p_booking_id AND status IN ('booked', 'showed', 'no_show');
    RETURN FOUND;
END;
$$;

CREATE FUNCTION public.cancel_dashboard_booking(p_booking_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_booking public.bookings%ROWTYPE;
BEGIN
    SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
    IF NOT FOUND THEN RETURN 'not_found'; END IF;
    IF v_booking.status = 'cancelled' THEN RETURN 'replay'; END IF;
    IF v_booking.status <> 'booked' OR v_booking.start_at <= now() THEN RETURN 'not_cancellable'; END IF;
    UPDATE public.bookings SET status = 'cancelled' WHERE id = p_booking_id;
    RETURN 'cancelled';
END;
$$;

REVOKE ALL ON FUNCTION public.validate_owner_booking_transition() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_owner_booking_transition() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_booking_attendance(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cancel_dashboard_booking(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_booking_attendance(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_dashboard_booking(uuid) TO authenticated;
