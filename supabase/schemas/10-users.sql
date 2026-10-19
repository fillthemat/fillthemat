CREATE TABLE public.users (
    id uuid PRIMARY KEY NOT NULL,
    email text NOT NULL,
    name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Supabase owns auth.users; this is the only FK outside the public copies.
ALTER TABLE public.users ADD CONSTRAINT users_id_auth_users_fk FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.users FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.users TO authenticated;

CREATE POLICY users_select_own
ON public.users
FOR SELECT
TO authenticated
USING (id = (SELECT auth.uid()));