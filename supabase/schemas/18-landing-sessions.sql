CREATE TABLE public.landing_sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    school_id uuid NOT NULL
        CONSTRAINT landing_sessions_school_id_fk REFERENCES public.schools(id) ON DELETE CASCADE,
    session_key_hash text NOT NULL,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    qualified_at timestamp with time zone,
    utm_source text,
    utm_medium text,
    utm_campaign text,
    utm_content text,
    utm_term text,
    is_preview boolean DEFAULT false NOT NULL,
    bot_exclusion_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT landing_sessions_school_id_id UNIQUE (school_id, id),
    CONSTRAINT landing_sessions_school_key UNIQUE (school_id, session_key_hash)
);

CREATE TRIGGER landing_sessions_set_updated_at
BEFORE UPDATE ON public.landing_sessions
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.landing_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.landing_sessions FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.landing_sessions to authenticated;

CREATE POLICY landing_sessions_select_own_school
on public.landing_sessions
FOR SELECT
TO authenticated
USING (
    school_id = (
        SELECT s.school_id
        FROM public.school_settings s
        WHERE s.owner_user_id = auth.uid()
    )
);
