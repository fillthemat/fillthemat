-- Never publish a live connection without committing its credentials with it.
CREATE FUNCTION public.finish_whatsapp_signup(
    p_school_id uuid, p_phone_number_id text, p_waba_id text,
    p_display_phone_number text, p_verified_name text,
    p_encrypted_token text, p_encrypted_pin text
) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
    UPDATE public.whatsapp_connections SET
        phone_number_id = p_phone_number_id, waba_id = p_waba_id,
        display_phone_number = p_display_phone_number, verified_name = p_verified_name,
        state = 'live', failure_code = NULL
    WHERE school_id = p_school_id AND state = 'registering';
    IF NOT FOUND THEN RAISE EXCEPTION 'signup_not_registering' USING ERRCODE = '22023'; END IF;
    INSERT INTO public.whatsapp_connection_secrets (school_id, encrypted_token, encrypted_pin)
    VALUES (p_school_id, p_encrypted_token, p_encrypted_pin)
    ON CONFLICT (school_id) DO UPDATE SET
        encrypted_token = EXCLUDED.encrypted_token, encrypted_pin = EXCLUDED.encrypted_pin,
        updated_at = now();
END;
$$;
REVOKE ALL ON FUNCTION public.finish_whatsapp_signup(uuid, text, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_whatsapp_signup(uuid, text, text, text, text, text, text) TO service_role;

CREATE FUNCTION public.set_whatsapp_signup_state(p_school_id uuid, p_state text, p_failure_code text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
    IF p_state NOT IN ('popup', 'cancelled', 'popup-failed', 'failed') THEN
        RAISE EXCEPTION 'invalid_signup_state' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.whatsapp_connections (school_id) VALUES (p_school_id) ON CONFLICT DO NOTHING;
    UPDATE public.whatsapp_connections SET state = p_state, failure_code = p_failure_code
    WHERE school_id = p_school_id AND
        ((p_state = 'failed' AND state = 'registering') OR
         (p_state <> 'failed' AND state NOT IN ('live', 'registering')));
    RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.set_whatsapp_signup_state(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_whatsapp_signup_state(uuid, text, text) TO service_role;

CREATE FUNCTION public.claim_whatsapp_signup(p_school_id uuid, p_phone_number_id text)
RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_connection public.whatsapp_connections;
BEGIN
    INSERT INTO public.whatsapp_connections (school_id) VALUES (p_school_id) ON CONFLICT DO NOTHING;
    SELECT * INTO STRICT v_connection FROM public.whatsapp_connections WHERE school_id = p_school_id FOR UPDATE;
    IF v_connection.state = 'live' THEN RETURN 'connection_live'; END IF;
    IF v_connection.state = 'registering' THEN RETURN 'signup_in_progress'; END IF;
    IF EXISTS (SELECT 1 FROM public.whatsapp_connections
        WHERE phone_number_id = p_phone_number_id AND school_id <> p_school_id) THEN
        RETURN 'phone_number_in_use';
    END IF;
    UPDATE public.whatsapp_connections SET state = 'registering', phone_number_id = p_phone_number_id, failure_code = NULL
    WHERE school_id = p_school_id AND state NOT IN ('registering', 'live');
    IF NOT FOUND THEN RETURN 'signup_in_progress'; END IF;
    IF v_connection.phone_number_id IS DISTINCT FROM p_phone_number_id THEN
        DELETE FROM public.whatsapp_connection_secrets WHERE school_id = p_school_id;
    END IF;
    RETURN 'claimed';
EXCEPTION WHEN unique_violation THEN
    RETURN 'phone_number_in_use';
END;
$$;
REVOKE ALL ON FUNCTION public.claim_whatsapp_signup(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_whatsapp_signup(uuid, text) TO service_role;
