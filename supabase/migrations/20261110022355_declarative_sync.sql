SET local check_function_bodies = off;

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
$function$;

CREATE OR REPLACE FUNCTION public.confirm_whatsapp_booking (
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
  p_intent_id        uuid                     DEFAULT NULL::uuid,
  p_profile_name     text                     DEFAULT NULL::text,
  p_now              timestamp with time zone DEFAULT now()
)
  RETURNS TABLE (
    already_committed boolean,
    outcome           text,
    booking_id        uuid,
    reply_message_id  uuid,
    reply_text        text,
    delivery_ids      uuid[]
  )
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
DECLARE
    v_hash text := encode(sha256(convert_to('wa:' || p_wa_id, 'UTF8')), 'hex');
    v_intent public.whatsapp_booking_intents;
    v_booking public.bookings;
    v_slot text;
    v_name text;
    v_school_name text;
    v_when text;
    v_delivery uuid;
BEGIN
    -- Same lock order as Turn supersession: conversation, then intent.
    PERFORM 1 FROM public.conversations c JOIN public.school_settings s ON s.school_id = c.school_id
        JOIN public.schools school ON school.id = c.school_id
    WHERE c.id = p_conversation_id AND c.school_id = p_school_id AND c.wa_id_hash = v_hash
        AND c.ended_at IS NULL AND c.generating_at = p_generation
        AND s.whatsapp_phone_number_id = p_phone_number_id
        AND school.approved_at IS NOT NULL AND school.published_at IS NOT NULL FOR UPDATE OF c;
    IF NOT FOUND THEN RAISE EXCEPTION 'generation_or_scope_lost' USING ERRCODE = '22023'; END IF;
    delivery_ids := '{}';
    IF EXISTS (SELECT 1 FROM public.messages m JOIN public.conversations c ON c.id = m.conversation_id
        WHERE c.school_id = p_school_id AND c.wa_id_hash = v_hash AND m.message_id = p_wamid) THEN
        already_committed := true;
        outcome := 'already_committed';
        RETURN NEXT;
        RETURN;
    END IF;
    already_committed := false;
    SELECT * INTO v_intent FROM public.whatsapp_booking_intents
    WHERE id = p_intent_id AND school_id = p_school_id AND conversation_id = p_conversation_id FOR UPDATE;
    outcome := 'expired';
    reply_text := 'That booking option has expired or was replaced. Please ask for available times again.';
    -- Clock timestamps in the append helper preserve user-before-assistant order.
    -- Extend the live generation's deadline before book_trial links the row.
    PERFORM public.append_web_message(p_school_id, p_conversation_id, p_generation,
        p_inbound_id, p_wamid, 'user', jsonb_build_array(jsonb_build_object('type', 'text', 'text', p_inbound_text)), 'complete', p_now);
    IF v_intent.id IS NOT NULL AND v_intent.state = 'pending' AND v_intent.expires_at > p_now THEN
        -- This boundary owns the six-per-24-hours booking cap. Serialize the
        -- quota across replacement conversations for the same recipient.
        PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
            'wa-booking-quota:' || p_school_id::text || ':' || v_hash, 0));
        IF (SELECT count(*) FROM public.bookings WHERE school_id = p_school_id
            AND contact_phone_snapshot = p_wa_id AND created_at >= p_now - interval '24 hours') >= 6 THEN
            outcome := 'rate_limited';
            reply_text := 'You''ve reached the daily booking limit for today. Please try again tomorrow.';
        ELSIF v_intent.participant_age IS NULL THEN
            outcome := 'incomplete';
            reply_text := 'I still need the participant''s age to complete the booking. Could you tell me their age in years?';
        ELSE
            v_slot := convert_from(decode(translate(v_intent.slot_id, '-_', '+/') ||
                repeat('=', (4 - length(v_intent.slot_id) % 4) % 4), 'base64'), 'UTF8');
            v_name := coalesce(nullif(btrim(coalesce(v_intent.participant_name, p_profile_name)), ''), 'Guest');
            BEGIN
                SELECT (b.booking).* INTO v_booking FROM public.book_trial(p_school_id, v_intent.offering_id,
                    split_part(v_slot, '|', 1)::uuid, split_part(v_slot, '|', 2)::timestamptz,
                    'wa-confirmation/' || p_wamid, v_name, p_wa_id, v_name, v_intent.participant_age,
                    p_conversation_id => p_conversation_id, p_now => p_now) b;
                outcome := 'booked';
            EXCEPTION WHEN raise_exception THEN
                -- Only expected Book Trial failures become notices. All other
                -- errors, including append/outbox failures, roll back everything.
                IF SQLERRM NOT IN ('invalid_slot', 'slot_unavailable', 'ineligible', 'already_booked') THEN RAISE; END IF;
                outcome := SQLERRM;
                reply_text := CASE SQLERRM
                    WHEN 'already_booked' THEN 'This participant is already booked into that slot.'
                    WHEN 'ineligible' THEN 'That participant doesn''t meet the offering''s age range.'
                    ELSE 'That time is no longer open — please pick another time.' END;
            END;
        END IF;
    ELSIF v_intent.state = 'pending' AND v_intent.expires_at <= p_now THEN
        UPDATE public.whatsapp_booking_intents SET state = 'expired' WHERE id = v_intent.id;
    END IF;
    IF outcome = 'booked' THEN
        booking_id := v_booking.id;
        UPDATE public.whatsapp_booking_intents SET state = 'confirmed' WHERE id = v_intent.id;
        SELECT name INTO STRICT v_school_name FROM public.school_profiles WHERE school_id = p_school_id;
        v_when := to_char(v_booking.start_at AT TIME ZONE v_booking.timezone_snapshot, 'FMDay FMMon FMDD "at" FMHH12:MI AM');
        reply_text := 'Booked! ' || v_booking.participant_name_snapshot || '''s trial for ' ||
            v_booking.offering_name_snapshot || ' is ' || v_when || '. ' || v_school_name || ' will see you there.';
        reply_message_id := public.append_web_message(p_school_id, p_conversation_id, p_generation,
            p_reply_id, p_reply_message_id, 'assistant', jsonb_build_array(jsonb_build_object('type', 'text', 'text', reply_text)), 'complete', p_now);
        v_delivery := public.enqueue_whatsapp_delivery(p_school_id, p_wa_id, p_phone_number_id,
            'booking-confirmation-template/' || v_booking.id, p_template_name => 'booking_confirmation',
            p_template_params => jsonb_build_array(v_school_name, v_booking.participant_name_snapshot,
                v_booking.offering_name_snapshot, v_when), p_booking_id => v_booking.id, p_now => p_now);
    ELSE
        -- Existing failure responses are notices, not assistant transcript rows.
        v_delivery := public.enqueue_whatsapp_delivery(p_school_id, p_wa_id, p_phone_number_id,
            'wa-notice/' || p_wa_id || '/' || p_wamid, p_body => reply_text,
            p_window_expires_at => p_now + interval '24 hours', p_now => p_now);
    END IF;
    IF v_delivery IS NOT NULL THEN delivery_ids := array_append(delivery_ids, v_delivery); END IF;
    RETURN NEXT;
END;
$function$;

REVOKE ALL
  ON FUNCTION "public"."confirm_whatsapp_booking"(uuid, uuid, timestamp WITH time zone, text, text, text, uuid, text, uuid, text, uuid, text, timestamp WITH time zone)
  FROM PUBLIC, "anon", "authenticated";

REVOKE ALL
  ON FUNCTION "public"."confirm_whatsapp_booking"(uuid, uuid, timestamp WITH time zone, text, text, text, uuid, text, uuid, text, uuid, text, timestamp WITH time zone)
  FROM "postgres";

GRANT EXECUTE
  ON FUNCTION "public"."confirm_whatsapp_booking"(uuid, uuid, timestamp WITH time zone, text, text, text, uuid, text, uuid, text, uuid, text, timestamp WITH time zone)
  TO "postgres";

GRANT EXECUTE
  ON FUNCTION "public"."confirm_whatsapp_booking"(uuid, uuid, timestamp WITH time zone, text, text, text, uuid, text, uuid, text, uuid, text, timestamp WITH time zone)
  TO "service_role";
