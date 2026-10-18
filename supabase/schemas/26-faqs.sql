CREATE TABLE public.faqs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    school_id uuid NOT NULL,
    question text NOT NULL,
    answer text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT faqs_school_id_id UNIQUE (school_id, id),
    CONSTRAINT faqs_question_len CHECK (char_length(question) BETWEEN 1 AND 200),
    CONSTRAINT faqs_answer_len CHECK (char_length(answer) BETWEEN 1 AND 2000)
);

ALTER TABLE public.faqs ADD CONSTRAINT faqs_school_id_fk FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;

ALTER TABLE public.faqs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.faqs FROM PUBLIC, anon, authenticated, service_role;
