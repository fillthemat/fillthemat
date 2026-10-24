CREATE TABLE public.conversations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    school_id uuid NOT NULL
        CONSTRAINT conversations_school_id_fk REFERENCES public.schools(id) ON DELETE CASCADE,
    landing_session_id uuid,
    contact_id uuid,
    resume_token_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    generating_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    wa_id_hash text,
    ended_at timestamp with time zone,
    end_reason public.conversation_end_reason,
    CONSTRAINT conversations_school_id_id UNIQUE (school_id, id),
    CONSTRAINT conversations_landing_session_fk FOREIGN KEY (school_id, landing_session_id) REFERENCES public.landing_sessions(school_id, id) ON DELETE SET NULL (landing_session_id),
    CONSTRAINT conversations_contact_fk FOREIGN KEY (school_id, contact_id) REFERENCES public.contacts(school_id, id) ON DELETE SET NULL (contact_id)
);

CREATE UNIQUE INDEX conversations_resume_token_hash ON public.conversations USING btree (resume_token_hash) WHERE ended_at IS NULL;
CREATE UNIQUE INDEX conversations_school_wa_id_hash ON public.conversations USING btree (school_id, wa_id_hash) WHERE wa_id_hash IS NOT NULL AND ended_at IS NULL;

CREATE TRIGGER conversations_set_updated_at
BEFORE UPDATE ON public.conversations
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.conversations FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.conversations to authenticated;

CREATE POLICY conversations_select_own_school
on public.conversations
FOR SELECT
TO authenticated
USING (
    school_id = (
        SELECT s.school_id
        FROM public.school_settings s
        WHERE s.owner_user_id = auth.uid()
    )
);
