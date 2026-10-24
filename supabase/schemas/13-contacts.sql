CREATE TABLE public.contacts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    school_id uuid NOT NULL
        CONSTRAINT contacts_school_id_fk REFERENCES public.schools(id) ON DELETE CASCADE,
    email text,
    name text NOT NULL,
    phone text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT contacts_school_id_id UNIQUE (school_id, id),
    CONSTRAINT contacts_school_email UNIQUE (school_id, email),
    CONSTRAINT contacts_school_phone UNIQUE (school_id, phone)
);

ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.contacts FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.contacts to authenticated;

CREATE POLICY contacts_select_own_school
on public.contacts
FOR SELECT
TO authenticated
USING (
    school_id = (
        SELECT s.id
        FROM public.schools s
        WHERE s.owner_user_id = auth.uid()
    )
);
