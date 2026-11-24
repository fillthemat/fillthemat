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
