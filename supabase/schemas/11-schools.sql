CREATE TABLE public.schools (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL
        CONSTRAINT schools_slug_unique UNIQUE
        CONSTRAINT schools_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(slug) BETWEEN 3 AND 48),
    timezone text NOT NULL,
    approved_at timestamp with time zone,
    published_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT schools_school_id_unique PRIMARY KEY (id)
);

CREATE TRIGGER schools_identity_immutable
  BEFORE UPDATE ON public.schools
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_published_school_identity_change();

CREATE TRIGGER schools_set_updated_at
BEFORE UPDATE ON public.schools
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.schools ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.schools FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.schools TO anon, authenticated;
GRANT UPDATE (slug, timezone, published_at) ON TABLE public.schools TO authenticated;

CREATE POLICY schools_update_own ON public.schools
FOR UPDATE TO authenticated
USING (id = (SELECT school_id FROM public.school_settings WHERE owner_user_id = (SELECT auth.uid())))
WITH CHECK (id = (SELECT school_id FROM public.school_settings WHERE owner_user_id = (SELECT auth.uid())));

CREATE POLICY schools_select_own
on public.schools
FOR SELECT
TO authenticated
USING (id = (SELECT school_id FROM public.school_settings WHERE owner_user_id = (SELECT auth.uid())));

CREATE POLICY schools_select_public ON public.schools
FOR SELECT TO anon, authenticated
USING (approved_at IS NOT NULL AND published_at IS NOT NULL);
