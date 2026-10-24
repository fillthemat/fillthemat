CREATE TABLE public.faqs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    school_id uuid NOT NULL
        CONSTRAINT faqs_school_id_fk REFERENCES public.schools(id) ON DELETE CASCADE,
    question text NOT NULL
        CONSTRAINT faqs_question_len CHECK (char_length(question) BETWEEN 1 AND 200),
    answer text NOT NULL
        CONSTRAINT faqs_answer_len CHECK (char_length(answer) BETWEEN 1 AND 2000),
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT faqs_school_id_id UNIQUE (school_id, id)
);

CREATE TRIGGER faqs_set_updated_at
BEFORE UPDATE ON public.faqs
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.faqs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.faqs FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.faqs TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON TABLE public.faqs TO authenticated;

CREATE POLICY faqs_owner_write ON public.faqs
FOR ALL TO authenticated
USING (school_id = (SELECT school_id FROM public.school_settings WHERE owner_user_id = (SELECT auth.uid())))
WITH CHECK (school_id = (SELECT school_id FROM public.school_settings WHERE owner_user_id = (SELECT auth.uid())));

CREATE POLICY faqs_select_own_school
on public.faqs
FOR SELECT
TO authenticated
USING (
    school_id = (
        SELECT s.school_id
        FROM public.school_settings s
        WHERE s.owner_user_id = auth.uid()
    )
);

CREATE TRIGGER faqs_enforce_limit
BEFORE INSERT ON public.faqs
FOR EACH ROW EXECUTE FUNCTION public.enforce_faq_limit();

CREATE POLICY faqs_public_read ON public.faqs
FOR SELECT TO anon, authenticated
USING (EXISTS (
    SELECT 1 FROM public.schools s
    WHERE s.id = school_id AND s.approved_at IS NOT NULL AND s.published_at IS NOT NULL
));
