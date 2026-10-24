CREATE TABLE public.trial_offerings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    school_id uuid NOT NULL
        CONSTRAINT trial_offerings_school_id_fk REFERENCES public.schools(id) ON DELETE CASCADE,
    name text NOT NULL
        CONSTRAINT trial_offerings_name_len CHECK (char_length(name) BETWEEN 1 AND 80),
    description text,
    minimum_age integer,
    maximum_age integer,
    expectations text,
    attire text,
    waiver_notes text,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT trial_offerings_school_id_id UNIQUE (school_id, id),
    CONSTRAINT trial_offerings_age_range CHECK (
        (minimum_age IS NULL OR minimum_age BETWEEN 0 AND 99)
        AND (maximum_age IS NULL OR maximum_age BETWEEN 0 AND 99)
        AND (minimum_age IS NULL OR maximum_age IS NULL OR minimum_age <= maximum_age)
    )
);

CREATE TRIGGER trial_offerings_set_updated_at
BEFORE UPDATE ON public.trial_offerings
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.trial_offerings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.trial_offerings FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.trial_offerings TO anon, authenticated;
GRANT INSERT, UPDATE ON TABLE public.trial_offerings TO authenticated;

CREATE POLICY trial_offerings_owner_write ON public.trial_offerings
FOR ALL TO authenticated
USING (school_id = (SELECT school_id FROM public.school_settings WHERE owner_user_id = (SELECT auth.uid())))
WITH CHECK (school_id = (SELECT school_id FROM public.school_settings WHERE owner_user_id = (SELECT auth.uid())));

CREATE POLICY trial_offerings_select_own_school
on public.trial_offerings
FOR SELECT
TO authenticated
USING (
    school_id = (
        SELECT s.school_id
        FROM public.school_settings s
        WHERE s.owner_user_id = auth.uid()
    )
);

CREATE POLICY trial_offerings_public_read ON public.trial_offerings
FOR SELECT TO anon, authenticated
USING (active AND EXISTS (
    SELECT 1 FROM public.schools s
    WHERE s.id = school_id AND s.approved_at IS NOT NULL AND s.published_at IS NOT NULL
));
