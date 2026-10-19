CREATE TABLE public.messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid NOT NULL,
    message_id text NOT NULL,
    role text NOT NULL,
    parts jsonb NOT NULL,
    completion public.message_completion DEFAULT 'complete' NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT messages_conversation_message_id UNIQUE (conversation_id, message_id)
);

ALTER TABLE public.messages ADD CONSTRAINT messages_conversation_id_conversations_id_fk FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;

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
        JOIN public.schools s ON s.id = c.school_id
        WHERE c.id = public.messages.conversation_id
          AND s.owner_user_id = auth.uid()
    )
);
