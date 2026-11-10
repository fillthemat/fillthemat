CREATE TABLE public.users (
    -- Supabase owns auth.users; this is the only FK outside the public copies.
    id uuid PRIMARY KEY NOT NULL
        CONSTRAINT users_id_auth_users_fk REFERENCES auth.users(id) ON DELETE CASCADE,
    email text NOT NULL,
    name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TRIGGER users_set_updated_at
BEFORE UPDATE ON public.users
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.users FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.users TO authenticated;

CREATE POLICY users_select_own
ON public.users
FOR SELECT
TO authenticated
USING (id = (SELECT auth.uid()));
