SET local check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.record_landing_session (
  p_school_id            uuid,
  p_session_key_hash     text,
  p_is_preview           boolean,
  p_bot_exclusion_reason text    DEFAULT NULL::text,
  p_utm                  jsonb   DEFAULT '{}'::jsonb
)
  RETURNS boolean
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
DECLARE
    v_session public.landing_sessions;
    v_qualified boolean;
BEGIN
    SELECT NOT p_is_preview AND p_bot_exclusion_reason IS NULL
        AND approved_at IS NOT NULL AND published_at IS NOT NULL
    INTO v_qualified FROM public.schools WHERE id = p_school_id;

    INSERT INTO public.landing_sessions (
        school_id, session_key_hash, qualified_at, is_preview, bot_exclusion_reason,
        utm_source, utm_medium, utm_campaign, utm_content, utm_term
    ) VALUES (
        p_school_id, p_session_key_hash, CASE WHEN v_qualified THEN now() END,
        p_is_preview, p_bot_exclusion_reason,
        p_utm->>'utm_source', p_utm->>'utm_medium', p_utm->>'utm_campaign',
        p_utm->>'utm_content', p_utm->>'utm_term'
    ) ON CONFLICT (school_id, session_key_hash) DO NOTHING RETURNING * INTO v_session;

    IF FOUND THEN
        IF v_session.qualified_at IS NOT NULL THEN
            INSERT INTO public.funnel_events (school_id, landing_session_id, event_type, metadata)
            VALUES (p_school_id, v_session.id, 'session_qualified', '{"source":"landing"}');
        END IF;
    ELSE
        -- A concurrent insert has committed before ON CONFLICT returns. Only
        -- touch last_seen_at: previews/bots are never requalified on a retry.
        UPDATE public.landing_sessions SET last_seen_at = now()
        WHERE school_id = p_school_id AND session_key_hash = p_session_key_hash
        RETURNING * INTO v_session;
    END IF;
    RETURN v_session.qualified_at IS NOT NULL;
END;
$function$;

REVOKE ALL ON FUNCTION "public"."record_landing_session"(uuid, text, boolean, text, jsonb) FROM PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."record_landing_session"(uuid, text, boolean, text, jsonb) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."record_landing_session"(uuid, text, boolean, text, jsonb) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."record_landing_session"(uuid, text, boolean, text, jsonb) TO "service_role";
