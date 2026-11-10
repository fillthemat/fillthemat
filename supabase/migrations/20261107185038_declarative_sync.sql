SET local check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.create_lead (
  p_school_id          uuid,
  p_contact_name       text,
  p_phone              text,
  p_channel            text,
  p_landing_token_hash text,
  p_email              text    DEFAULT NULL::text,
  p_participant_name   text    DEFAULT NULL::text,
  p_participant_age    integer DEFAULT NULL::integer,
  p_offering_id        uuid    DEFAULT NULL::uuid,
  p_stated_need        text    DEFAULT NULL::text
)
  RETURNS public.leads
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
DECLARE
    v_lead public.leads;
    v_contact_id uuid;
    v_landing_id uuid;
    v_notification_email text;
    v_email text := nullif(lower(btrim(p_email)), '');
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.schools WHERE id = p_school_id
        AND approved_at IS NOT NULL AND published_at IS NOT NULL) THEN
        RAISE EXCEPTION 'school_not_public';
    END IF;
    IF p_channel IS NULL OR p_channel NOT IN ('web', 'whatsapp') THEN
        RAISE EXCEPTION 'invalid_channel';
    END IF;
    IF p_landing_token_hash IS NULL OR p_landing_token_hash = '' THEN
        RAISE EXCEPTION 'session_required';
    END IF;
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
    IF p_channel = 'whatsapp' THEN
        INSERT INTO public.landing_sessions (school_id, session_key_hash, utm_source)
        VALUES (p_school_id, p_landing_token_hash, 'whatsapp')
        ON CONFLICT (school_id, session_key_hash) DO UPDATE
        SET last_seen_at = now(), utm_source = 'whatsapp'
        RETURNING id INTO v_landing_id;
    ELSE
        SELECT id INTO v_landing_id FROM public.landing_sessions
        WHERE school_id = p_school_id AND session_key_hash = p_landing_token_hash;
        IF NOT FOUND THEN RAISE EXCEPTION 'session_required'; END IF;
    END IF;
    -- Composite foreign keys also reject offerings/sessions from another school.
    INSERT INTO public.leads (school_id, landing_session_id, contact_id,
        participant_name, participant_age, trial_offering_id, stated_need)
    VALUES (p_school_id, v_landing_id, v_contact_id, p_participant_name,
        p_participant_age, p_offering_id, p_stated_need)
    RETURNING * INTO v_lead;
    SELECT nullif(btrim(notification_email), '') INTO STRICT v_notification_email
    FROM public.school_settings WHERE school_id = p_school_id;
    IF v_notification_email IS NOT NULL THEN
        PERFORM public.enqueue_email_delivery(p_school_id, 'owner_lead', v_notification_email,
            'owner-lead/' || v_lead.id, NULL, v_lead.id);
    END IF;
    INSERT INTO public.funnel_events (school_id, landing_session_id, lead_id, event_type, metadata)
    VALUES (p_school_id, v_landing_id, v_lead.id, 'lead_captured',
        jsonb_build_object('hasOffering', p_offering_id IS NOT NULL) ||
        CASE WHEN p_channel = 'whatsapp' THEN jsonb_build_object('channel', 'whatsapp') ELSE '{}'::jsonb END);
    RETURN v_lead;
END;
$function$;

REVOKE ALL ON FUNCTION "public"."create_lead"(uuid, text, text, text, text, text, text, integer, uuid, text) FROM PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."create_lead"(uuid, text, text, text, text, text, text, integer, uuid, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."create_lead"(uuid, text, text, text, text, text, text, integer, uuid, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."create_lead"(uuid, text, text, text, text, text, text, integer, uuid, text) TO "service_role";
