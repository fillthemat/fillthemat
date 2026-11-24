SET local check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.claim_whatsapp_signup (
  p_school_id       uuid,
  p_phone_number_id text
)
  RETURNS text
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
DECLARE v_connection public.whatsapp_connections;
BEGIN
    INSERT INTO public.whatsapp_connections (school_id) VALUES (p_school_id) ON CONFLICT DO NOTHING;
    SELECT * INTO STRICT v_connection FROM public.whatsapp_connections WHERE school_id = p_school_id FOR UPDATE;
    IF v_connection.state = 'live' THEN RETURN 'connection_live'; END IF;
    IF v_connection.state = 'registering'
        AND v_connection.updated_at >= statement_timestamp() - interval '10 minutes' THEN
        RETURN 'signup_in_progress';
    END IF;
    IF EXISTS (SELECT 1 FROM public.whatsapp_connections
        WHERE phone_number_id = p_phone_number_id AND school_id <> p_school_id) THEN
        RETURN 'phone_number_in_use';
    END IF;
    UPDATE public.whatsapp_connections SET state = 'registering', phone_number_id = p_phone_number_id, failure_code = NULL
    WHERE school_id = p_school_id AND (state NOT IN ('registering', 'live') OR
        (state = 'registering' AND updated_at < statement_timestamp() - interval '10 minutes'));
    IF NOT FOUND THEN RETURN 'signup_in_progress'; END IF;
    IF v_connection.phone_number_id IS DISTINCT FROM p_phone_number_id THEN
        DELETE FROM public.whatsapp_connection_secrets WHERE school_id = p_school_id;
    END IF;
    RETURN 'claimed';
EXCEPTION WHEN unique_violation THEN
    RETURN 'phone_number_in_use';
END;
$function$;

CREATE OR REPLACE FUNCTION public.finish_whatsapp_signup (
  p_school_id            uuid,
  p_phone_number_id      text,
  p_waba_id              text,
  p_display_phone_number text,
  p_verified_name        text,
  p_encrypted_token      text,
  p_encrypted_pin        text
)
  RETURNS void
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
BEGIN
    UPDATE public.whatsapp_connections SET
        phone_number_id = p_phone_number_id, waba_id = p_waba_id,
        display_phone_number = p_display_phone_number, verified_name = p_verified_name,
        state = 'live', failure_code = NULL
    WHERE school_id = p_school_id AND state = 'registering'
        AND phone_number_id = p_phone_number_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'signup_not_registering' USING ERRCODE = '22023'; END IF;
    INSERT INTO public.whatsapp_connection_secrets (school_id, encrypted_token, encrypted_pin)
    VALUES (p_school_id, p_encrypted_token, p_encrypted_pin)
    ON CONFLICT (school_id) DO UPDATE SET
        encrypted_token = EXCLUDED.encrypted_token, encrypted_pin = EXCLUDED.encrypted_pin,
        updated_at = now();
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_whatsapp_signup_state (
  p_school_id    uuid,
  p_state        text,
  p_failure_code text DEFAULT NULL::text
)
  RETURNS boolean
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
BEGIN
    IF p_state NOT IN ('popup', 'cancelled', 'popup-failed', 'failed') THEN
        RAISE EXCEPTION 'invalid_signup_state' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.whatsapp_connections (school_id) VALUES (p_school_id) ON CONFLICT DO NOTHING;
    UPDATE public.whatsapp_connections SET state = p_state, failure_code = p_failure_code
    WHERE school_id = p_school_id AND
        ((p_state = 'failed' AND state = 'registering') OR
         (p_state <> 'failed' AND (state NOT IN ('live', 'registering') OR
             (state = 'registering' AND updated_at < statement_timestamp() - interval '10 minutes'))));
    RETURN FOUND;
END;
$function$;
