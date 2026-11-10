-- Atomic Turn contract. The app prepares text/chunks and exactly one effect:
-- reply, booking_intent, or lead_request.
-- Check scope/control, save inbound, apply effect, save reply and enqueue.
-- Any exception rolls everything back, including create_lead's email/events.
-- Duplicate inbound returns no writes; stale generation raises before writes.
CREATE FUNCTION public.commit_whatsapp_turn(
    p_school_id uuid, p_conversation_id uuid, p_generation timestamptz,
    p_wa_id text, p_phone_number_id text, p_wamid text, p_inbound_id uuid,
    p_inbound_text text, p_reply_id uuid, p_reply_message_id text,
    p_reply_text text, p_reply_chunks jsonb, p_effect jsonb, p_now timestamptz
)
RETURNS TABLE (already_committed boolean, reply_message_id uuid, lead_id uuid, delivery_ids uuid[])
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
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
    IF v_kind IS NULL OR v_kind NOT IN ('reply', 'booking_intent', 'lead_request') THEN
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
    reply_message_id := public.append_web_message(p_school_id, p_conversation_id, p_generation,
        p_reply_id, p_reply_message_id, 'assistant',
        CASE WHEN p_reply_text = '' THEN '[]'::jsonb ELSE
            jsonb_build_array(jsonb_build_object('type', 'text', 'text', p_reply_text)) END, 'complete', p_now);
    IF v_kind = 'booking_intent' THEN
        v_delivery := public.enqueue_whatsapp_delivery(p_school_id, p_wa_id, p_phone_number_id,
            'wa-confirm/' || p_wamid,
            p_body => p_reply_text,
            p_buttons => jsonb_build_array(
                jsonb_build_object('id', 'confirm_booking:' || v_intent_id, 'title', 'Confirm booking'),
                jsonb_build_object('id', 'choose_another_time', 'title', 'Choose another time')),
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
$$;

REVOKE ALL ON FUNCTION public.commit_whatsapp_turn(uuid, uuid, timestamptz, text, text, text, uuid, text, uuid, text, text, jsonb, jsonb, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_whatsapp_turn(uuid, uuid, timestamptz, text, text, text, uuid, text, uuid, text, text, jsonb, jsonb, timestamptz) TO service_role;
