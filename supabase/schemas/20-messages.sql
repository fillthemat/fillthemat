CREATE TABLE public.messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid NOT NULL
        CONSTRAINT messages_conversation_id_conversations_id_fk REFERENCES public.conversations(id) ON DELETE CASCADE,
    message_id text NOT NULL,
    role text NOT NULL,
    parts jsonb NOT NULL,
    completion public.message_completion DEFAULT 'complete' NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT messages_conversation_message_id UNIQUE (conversation_id, message_id)
);

CREATE INDEX messages_transcript_order ON public.messages (conversation_id, created_at, id);

CREATE TRIGGER messages_set_updated_at
BEFORE UPDATE ON public.messages
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.messages FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.messages to authenticated;

CREATE POLICY messages_select_own_school
on public.messages
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.conversations c
        JOIN public.school_settings s ON s.school_id = c.school_id
        WHERE c.id = public.messages.conversation_id
          AND s.owner_user_id = auth.uid()
    )
);
