CREATE TABLE public.whatsapp_booking_intents (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    school_id uuid NOT NULL
        CONSTRAINT whatsapp_booking_intents_school_id_fk REFERENCES public.schools(id) ON DELETE CASCADE,
    conversation_id uuid NOT NULL,
    offering_id uuid NOT NULL,
    slot_id text NOT NULL,
    participant_name text,
    participant_age integer
        CONSTRAINT whatsapp_booking_intents_age CHECK (participant_age IS NULL OR participant_age BETWEEN 0 AND 99),
    state public.whatsapp_booking_intent_state DEFAULT 'pending' NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT whatsapp_booking_intents_school_id_id UNIQUE (school_id, id),
    CONSTRAINT whatsapp_booking_intents_conversation_fk FOREIGN KEY (school_id, conversation_id) REFERENCES public.conversations(school_id, id) ON DELETE CASCADE,
    CONSTRAINT whatsapp_booking_intents_offering_fk FOREIGN KEY (school_id, offering_id) REFERENCES public.trial_offerings(school_id, id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX whatsapp_booking_intents_active_pending ON public.whatsapp_booking_intents USING btree (conversation_id) WHERE state = 'pending';

ALTER TABLE public.whatsapp_booking_intents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.whatsapp_booking_intents FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.whatsapp_booking_intents to authenticated;

CREATE POLICY whatsapp_booking_intents_select_own_school
on public.whatsapp_booking_intents
FOR SELECT
TO authenticated
USING (
    school_id = (
        SELECT s.id
        FROM public.schools s
        WHERE s.owner_user_id = auth.uid()
    )
);
