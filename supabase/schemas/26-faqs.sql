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

ALTER TABLE public.faqs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.faqs FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.faqs to authenticated;

CREATE POLICY faqs_select_own_school
on public.faqs
FOR SELECT
TO authenticated
USING (
    school_id = (
        SELECT s.id
        FROM public.schools s
        WHERE s.owner_user_id = auth.uid()
    )
);
