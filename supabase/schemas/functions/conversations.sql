-- Service-only transaction boundaries. Public clients must go through the
-- application, which checks school visibility and holds the raw resume token.
CREATE FUNCTION public.resolve_web_conversation(p_school_id uuid, p_token_hash text, p_now timestamptz)
RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_id uuid; v_expires_at timestamptz;
BEGIN
    -- Serialize first creation: there may not be a row to lock yet.
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_school_id::text || ':' || p_token_hash, 0));
    -- Coordinate with message saves/deadline extensions, which lock this row.
    SELECT id, expires_at INTO v_id, v_expires_at FROM public.conversations
    WHERE school_id = p_school_id AND resume_token_hash = p_token_hash AND ended_at IS NULL FOR UPDATE;
    IF FOUND THEN
        IF v_expires_at > p_now THEN RETURN v_id; END IF;
        UPDATE public.conversations SET ended_at = p_now, end_reason = 'inactivity' WHERE id = v_id;
    END IF;
    INSERT INTO public.conversations (school_id, resume_token_hash, expires_at)
    VALUES (p_school_id, p_token_hash, p_now + interval '30 days') RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;

CREATE FUNCTION public.append_web_message(
    p_school_id uuid, p_conversation_id uuid, p_generation timestamptz,
    p_id uuid, p_message_id text, p_role text, p_parts jsonb,
    p_completion public.message_completion, p_now timestamptz
)
RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_id uuid;
BEGIN
    IF p_role NOT IN ('user', 'assistant') THEN RAISE EXCEPTION 'invalid_role' USING ERRCODE = '22023'; END IF;
    PERFORM 1 FROM public.conversations
    WHERE id = p_conversation_id AND school_id = p_school_id
      AND generating_at = p_generation AND ended_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'generation_lost' USING ERRCODE = '22023'; END IF;
    INSERT INTO public.messages (id, conversation_id, message_id, role, parts, completion)
    VALUES (p_id, p_conversation_id, p_message_id, p_role, p_parts, p_completion)
    ON CONFLICT (conversation_id, message_id) DO NOTHING RETURNING id INTO v_id;
    IF v_id IS NOT NULL AND p_role = 'user' THEN
        UPDATE public.conversations SET expires_at = p_now + interval '30 days' WHERE id = p_conversation_id;
    END IF;
    RETURN v_id;
END;
$$;

CREATE FUNCTION public.end_web_conversation_at_limit(
    p_school_id uuid, p_conversation_id uuid, p_generation timestamptz, p_now timestamptz
)
RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
    PERFORM 1 FROM public.conversations WHERE id = p_conversation_id AND school_id = p_school_id
    AND generating_at = p_generation AND ended_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'generation_lost' USING ERRCODE = '22023'; END IF;
    IF (SELECT count(*) FROM public.messages WHERE conversation_id = p_conversation_id) < 30 THEN RETURN false; END IF;
    UPDATE public.conversations SET ended_at = p_now, end_reason = 'message_limit' WHERE id = p_conversation_id;
    RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_web_conversation(uuid, text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.append_web_message(uuid, uuid, timestamptz, uuid, text, text, jsonb, public.message_completion, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.end_web_conversation_at_limit(uuid, uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_web_conversation(uuid, text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.append_web_message(uuid, uuid, timestamptz, uuid, text, text, jsonb, public.message_completion, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.end_web_conversation_at_limit(uuid, uuid, timestamptz, timestamptz) TO service_role;
