CREATE TABLE public.participants (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    school_id uuid NOT NULL,
    contact_id uuid NOT NULL,
    name text NOT NULL,
    normalized_name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT participants_school_id_id UNIQUE (school_id, id),
    CONSTRAINT participants_contact_normalized_name UNIQUE (contact_id, normalized_name)
);

ALTER TABLE public.participants ADD CONSTRAINT participants_school_id_fk FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;
ALTER TABLE public.participants ADD CONSTRAINT participants_contact_fk FOREIGN KEY (school_id, contact_id) REFERENCES public.contacts(school_id, id) ON DELETE CASCADE;

ALTER TABLE public.participants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.participants FROM PUBLIC, anon, authenticated, service_role;
