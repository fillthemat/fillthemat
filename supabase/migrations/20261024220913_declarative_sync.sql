-- Change identity uniqueness and the resolver contract atomically, including
-- during pg-delta's statement-by-statement shadow replay.
DO $school_token$
BEGIN
SET local check_function_bodies = off;

DROP INDEX "public"."conversations_resume_token_hash";

DROP INDEX "public"."conversations_resume_token_history";

DROP FUNCTION "public"."resolve_web_conversation"(uuid, text, timestamp WITH time zone);

CREATE OR REPLACE FUNCTION public.end_web_conversation_at_limit (
  p_school_id       uuid,
  p_conversation_id uuid,
  p_generation      timestamp with time zone,
  p_now             timestamp with time zone
)
  RETURNS boolean
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
BEGIN
    PERFORM 1 FROM public.conversations WHERE id = p_conversation_id AND school_id = p_school_id
    AND generating_at = p_generation AND ended_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'generation_lost' USING ERRCODE = '22023'; END IF;
    IF (SELECT count(*) FROM public.messages WHERE conversation_id = p_conversation_id) < 30 THEN RETURN false; END IF;
    UPDATE public.conversations SET ended_at = p_now, end_reason = 'message_limit' WHERE id = p_conversation_id;
    RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.resolve_web_conversation (
  p_school_id  uuid,
  p_token_hash text,
  p_now        timestamp with time zone
)
  RETURNS uuid
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
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
$function$;

REVOKE ALL ON FUNCTION "public"."resolve_web_conversation"(uuid, text, timestamp WITH time zone) FROM PUBLIC, "anon", "authenticated";

CREATE UNIQUE INDEX conversations_resume_token_hash ON public.conversations USING btree (school_id, resume_token_hash)
  WHERE (ended_at IS NULL);

REVOKE ALL ON FUNCTION "public"."resolve_web_conversation"(uuid, text, timestamp WITH time zone) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."resolve_web_conversation"(uuid, text, timestamp WITH time zone) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."resolve_web_conversation"(uuid, text, timestamp WITH time zone) TO "service_role";

END;
$school_token$;
