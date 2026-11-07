SET local check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.whatsapp_confirmation_hook()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
DECLARE v_email text;
BEGIN
    IF NEW.booking_id IS NULL OR NEW.template_name IS DISTINCT FROM 'booking_confirmation' THEN RETURN NEW; END IF;
    IF NEW.state = 'dead' AND OLD.state <> 'dead' AND NEW.terminal_cause <> 'stale'
        AND EXISTS (SELECT 1 FROM public.bookings WHERE id = NEW.booking_id AND school_id = NEW.school_id AND start_at > now()) THEN
        SELECT notification_email INTO v_email FROM public.school_settings WHERE school_id = NEW.school_id;
        IF v_email IS NOT NULL THEN
            PERFORM public.enqueue_email_delivery(NEW.school_id, 'owner_whatsapp_confirmation_failed', v_email,
                'owner-whatsapp-confirmation-failed/' || NEW.booking_id, NEW.booking_id);
        END IF;
    ELSIF NEW.state IN ('delivered', 'read') THEN
        DELETE FROM public.email_deliveries WHERE school_id = NEW.school_id AND booking_id = NEW.booking_id
            AND kind = 'owner_whatsapp_confirmation_failed' AND state IN ('pending', 'failed') AND attempts = 0;
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.whatsapp_job_death_hook()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
DECLARE v_school uuid; v_window timestamptz; v_recipient text;
BEGIN
    IF NEW.state <> 'dead' OR OLD.state = 'dead' OR NEW.terminal_cause IS DISTINCT FROM 'attempts_exhausted'
        OR NEW.kind <> 'inbound_message' THEN RETURN NEW; END IF;
    v_recipient := NEW.payload->>'waId';
    IF coalesce(v_recipient, '') = '' THEN RETURN NEW; END IF;
    SELECT max(created_at) + interval '24 hours' INTO v_window FROM public.whatsapp_jobs
        WHERE kind = 'inbound_message' AND phone_number_id = NEW.phone_number_id
            AND payload->>'waId' = v_recipient AND created_at <= now();
    IF v_window IS NULL OR v_window <= now() THEN RETURN NEW; END IF;
    SELECT school_id INTO v_school FROM public.school_settings
        WHERE whatsapp_phone_number_id = NEW.phone_number_id
            AND (NEW.school_id IS NULL OR school_id = NEW.school_id);
    IF v_school IS NOT NULL THEN
        PERFORM public.enqueue_whatsapp_delivery(v_school, v_recipient, NEW.phone_number_id,
            'job-fallback/' || NEW.id, p_body => 'Sorry, we''re having trouble replying right now. Please message us again in a bit.',
            p_window_expires_at => v_window);
    END IF;
    RETURN NEW;
END;
$function$;
