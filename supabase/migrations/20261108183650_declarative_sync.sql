SET local check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.append_web_message (
  p_school_id       uuid,
  p_conversation_id uuid,
  p_generation      timestamp with time zone,
  p_id              uuid,
  p_message_id      text,
  p_role            text,
  p_parts           jsonb,
  p_completion      public.message_completion,
  p_now             timestamp with time zone
)
  RETURNS uuid
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
DECLARE v_id uuid;
BEGIN
    IF p_role NOT IN ('user', 'assistant') THEN RAISE EXCEPTION 'invalid_role' USING ERRCODE = '22023'; END IF;
    PERFORM 1 FROM public.conversations
    WHERE id = p_conversation_id AND school_id = p_school_id
      AND generating_at = p_generation AND ended_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'generation_lost' USING ERRCODE = '22023'; END IF;
    -- Transaction now() is identical for both messages of an atomic Turn.
    -- Use statement-time insertion order rather than random UUID tie-breaking.
    INSERT INTO public.messages (id, conversation_id, message_id, role, parts, completion, created_at)
    VALUES (p_id, p_conversation_id, p_message_id, p_role, p_parts, p_completion, clock_timestamp())
    ON CONFLICT (conversation_id, message_id) DO NOTHING RETURNING id INTO v_id;
    IF v_id IS NOT NULL AND p_role = 'user' THEN
        UPDATE public.conversations SET expires_at = p_now + interval '30 days' WHERE id = p_conversation_id;
    END IF;
    RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.commit_whatsapp_turn (
  p_school_id        uuid,
  p_conversation_id  uuid,
  p_generation       timestamp with time zone,
  p_wa_id            text,
  p_phone_number_id  text,
  p_wamid            text,
  p_inbound_id       uuid,
  p_inbound_text     text,
  p_reply_id         uuid,
  p_reply_message_id text,
  p_reply_text       text,
  p_reply_chunks     jsonb,
  p_effect           jsonb,
  p_now              timestamp with time zone
)
  RETURNS TABLE (
    already_committed boolean,
    reply_message_id  uuid,
    lead_id           uuid,
    delivery_ids      uuid[]
  )
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
DECLARE
    v_hash text := encode(sha256(convert_to('wa:' || p_wa_id, 'UTF8')), 'hex');
    v_kind text := p_effect->>'kind';
    v_intent_id uuid;
    v_lead public.leads;
    v_delivery uuid;
    v_deliveries uuid[] := '{}';
    v_chunk text;
    v_slot text;
    v_index integer := 0;
BEGIN
    PERFORM 1 FROM public.conversations c JOIN public.school_settings s ON s.school_id = c.school_id
        JOIN public.schools school ON school.id = c.school_id
    WHERE c.id = p_conversation_id AND c.school_id = p_school_id AND c.wa_id_hash = v_hash
        AND c.ended_at IS NULL AND c.generating_at = p_generation
        AND s.whatsapp_phone_number_id = p_phone_number_id
        AND school.approved_at IS NOT NULL AND school.published_at IS NOT NULL FOR UPDATE OF c;
    IF NOT FOUND THEN RAISE EXCEPTION 'generation_or_scope_lost' USING ERRCODE = '22023'; END IF;
    IF v_kind IS NULL OR v_kind NOT IN ('reply', 'booking_intent', 'lead_request', 'expired_confirmation') THEN
        RAISE EXCEPTION 'invalid_prepared_effect' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM public.messages m JOIN public.conversations c ON c.id = m.conversation_id
        WHERE c.school_id = p_school_id AND c.wa_id_hash = v_hash AND m.message_id = p_wamid) THEN
        already_committed := true;
        delivery_ids := '{}';
        RETURN NEXT;
        RETURN;
    END IF;
    already_committed := false;
    PERFORM public.append_web_message(p_school_id, p_conversation_id, p_generation,
        p_inbound_id, p_wamid, 'user', jsonb_build_array(jsonb_build_object('type', 'text', 'text', p_inbound_text)), 'complete', p_now);
    IF v_kind = 'booking_intent' THEN
        -- Slot IDs encode window UUID | start timestamp as base64url. Validate
        -- tenant/offering scope here; confirmation rechecks live availability.
        v_slot := convert_from(decode(translate(p_effect->>'slotId', '-_', '+/') ||
            repeat('=', (4 - length(p_effect->>'slotId') % 4) % 4), 'base64'), 'UTF8');
        PERFORM split_part(v_slot, '|', 2)::timestamptz;
        PERFORM 1 FROM public.trial_windows WHERE id = split_part(v_slot, '|', 1)::uuid
            AND school_id = p_school_id AND trial_offering_id = (p_effect->>'trialOfferingId')::uuid;
        IF NOT FOUND THEN RAISE EXCEPTION 'invalid_slot_scope' USING ERRCODE = '22023'; END IF;
        UPDATE public.whatsapp_booking_intents SET state = 'superseded'
        WHERE conversation_id = p_conversation_id AND state = 'pending';
        INSERT INTO public.whatsapp_booking_intents (school_id, conversation_id, offering_id, slot_id,
            participant_name, participant_age, expires_at)
        VALUES (p_school_id, p_conversation_id, (p_effect->>'trialOfferingId')::uuid, p_effect->>'slotId',
            p_effect->>'participantName', (p_effect->>'participantAge')::integer, p_now + interval '30 minutes')
        RETURNING id INTO v_intent_id;
    ELSIF v_kind = 'lead_request' THEN
        v_lead := public.create_lead(p_school_id, p_effect->>'contactName', p_wa_id, 'whatsapp',
            encode(sha256(convert_to('wa:whatsapp-landing:' || p_wa_id, 'UTF8')), 'hex'), NULL,
            p_effect->>'participantName', (p_effect->>'participantAge')::integer,
            (p_effect->>'trialOfferingId')::uuid, p_effect->>'statedNeed');
        UPDATE public.conversations SET contact_id = coalesce(contact_id, v_lead.contact_id) WHERE id = p_conversation_id;
    END IF;
    -- Expired confirmation is a notice, not an assistant transcript message.
    IF v_kind <> 'expired_confirmation' THEN
        reply_message_id := public.append_web_message(p_school_id, p_conversation_id, p_generation,
            p_reply_id, p_reply_message_id, 'assistant',
            CASE WHEN p_reply_text = '' THEN '[]'::jsonb ELSE
                jsonb_build_array(jsonb_build_object('type', 'text', 'text', p_reply_text)) END, 'complete', p_now);
    END IF;
    IF v_kind IN ('booking_intent', 'expired_confirmation') THEN
        v_delivery := public.enqueue_whatsapp_delivery(p_school_id, p_wa_id, p_phone_number_id,
            CASE WHEN v_intent_id IS NULL THEN 'wa-notice/' || p_wa_id || '/' || p_wamid ELSE 'wa-confirm/' || p_wamid END,
            p_body => p_reply_text,
            p_buttons => CASE WHEN v_intent_id IS NULL THEN NULL ELSE jsonb_build_array(
                jsonb_build_object('id', 'confirm_booking:' || v_intent_id, 'title', 'Confirm booking'),
                jsonb_build_object('id', 'choose_another_time', 'title', 'Choose another time')) END,
            p_window_expires_at => p_now + interval '24 hours', p_now => p_now);
        IF v_delivery IS NOT NULL THEN v_deliveries := array_append(v_deliveries, v_delivery); END IF;
    ELSE
        IF jsonb_typeof(p_reply_chunks) IS DISTINCT FROM 'array'
            OR (jsonb_array_length(p_reply_chunks) = 0 AND p_reply_text <> '') THEN
            RAISE EXCEPTION 'reply_chunks_required' USING ERRCODE = '22023';
        END IF;
        FOR v_chunk IN SELECT jsonb_array_elements_text(p_reply_chunks) LOOP
            IF v_chunk IS NULL OR btrim(v_chunk) = '' THEN
                RAISE EXCEPTION 'invalid_reply_chunk' USING ERRCODE = '22023';
            END IF;
            v_delivery := public.enqueue_whatsapp_delivery(p_school_id, p_wa_id, p_phone_number_id,
                'wa-reply/' || p_wamid || '/' || v_index, p_body => v_chunk,
                p_window_expires_at => p_now + interval '24 hours', p_now => p_now);
            IF v_delivery IS NOT NULL THEN v_deliveries := array_append(v_deliveries, v_delivery); END IF;
            v_index := v_index + 1;
        END LOOP;
    END IF;
    lead_id := v_lead.id;
    delivery_ids := v_deliveries;
    RETURN NEXT;
END;
$function$;

REVOKE ALL
  ON FUNCTION "public"."commit_whatsapp_turn"(uuid, uuid, timestamp WITH time zone, text, text, text, uuid, text, uuid, text, text, jsonb, jsonb, timestamp WITH time zone)
  FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.end_inactive_conversations (
  p_now timestamp with time zone
)
  RETURNS integer
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
DECLARE v_count integer;
BEGIN
    UPDATE public.conversations SET ended_at = p_now, end_reason = 'inactivity'
    WHERE ended_at IS NULL AND expires_at <= p_now
        AND (generating_at IS NULL OR generating_at < p_now - interval '10 minutes');
    GET DIAGNOSTICS v_count = ROW_COUNT;
    UPDATE public.whatsapp_booking_intents SET state = 'expired'
    WHERE state = 'pending' AND expires_at <= p_now;
    RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION "public"."end_inactive_conversations"(timestamp WITH time zone) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.expire_ended_conversation_intents()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
BEGIN
    UPDATE public.whatsapp_booking_intents SET state = 'expired'
    WHERE conversation_id = NEW.id AND state = 'pending';
    RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION "public"."expire_ended_conversation_intents"() FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.resolve_whatsapp_conversation (
  p_school_id  uuid,
  p_wa_id_hash text,
  p_token_hash text,
  p_now        timestamp with time zone
)
  RETURNS uuid
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
DECLARE v_conversation public.conversations;
BEGIN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
        'whatsapp:' || p_school_id::text || ':' || p_wa_id_hash, 0));
    SELECT * INTO v_conversation FROM public.conversations
    WHERE school_id = p_school_id AND wa_id_hash = p_wa_id_hash AND ended_at IS NULL FOR UPDATE;
    IF FOUND THEN
        IF v_conversation.expires_at > p_now OR v_conversation.generating_at >= p_now - interval '10 minutes' THEN
            RETURN v_conversation.id;
        END IF;
        UPDATE public.conversations SET ended_at = p_now, end_reason = 'inactivity' WHERE id = v_conversation.id;
    END IF;
    INSERT INTO public.conversations (school_id, wa_id_hash, resume_token_hash, expires_at)
    VALUES (p_school_id, p_wa_id_hash, p_token_hash, p_now + interval '30 days') RETURNING id INTO v_conversation.id;
    RETURN v_conversation.id;
END;
$function$;

REVOKE ALL ON FUNCTION "public"."resolve_whatsapp_conversation"(uuid, text, text, timestamp WITH time zone) FROM PUBLIC, "anon", "authenticated";

CREATE TRIGGER conversations_expire_intents
  AFTER UPDATE ON public.conversations
  FOR EACH ROW
  WHEN (((old.ended_at IS NULL) AND (new.ended_at IS NOT NULL)))
  EXECUTE FUNCTION public.expire_ended_conversation_intents();

REVOKE ALL
  ON FUNCTION "public"."commit_whatsapp_turn"(uuid, uuid, timestamp WITH time zone, text, text, text, uuid, text, uuid, text, text, jsonb, jsonb, timestamp WITH time zone)
  FROM "postgres";

GRANT EXECUTE
  ON FUNCTION "public"."commit_whatsapp_turn"(uuid, uuid, timestamp WITH time zone, text, text, text, uuid, text, uuid, text, text, jsonb, jsonb, timestamp WITH time zone)
  TO "postgres";

GRANT EXECUTE
  ON FUNCTION "public"."commit_whatsapp_turn"(uuid, uuid, timestamp WITH time zone, text, text, text, uuid, text, uuid, text, text, jsonb, jsonb, timestamp WITH time zone)
  TO "service_role";

REVOKE ALL ON FUNCTION "public"."end_inactive_conversations"(timestamp WITH time zone) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."end_inactive_conversations"(timestamp WITH time zone) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."end_inactive_conversations"(timestamp WITH time zone) TO "service_role";

REVOKE ALL ON FUNCTION "public"."expire_ended_conversation_intents"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."expire_ended_conversation_intents"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."expire_ended_conversation_intents"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."resolve_whatsapp_conversation"(uuid, text, text, timestamp WITH time zone) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."resolve_whatsapp_conversation"(uuid, text, text, timestamp WITH time zone) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."resolve_whatsapp_conversation"(uuid, text, text, timestamp WITH time zone) TO "service_role";
