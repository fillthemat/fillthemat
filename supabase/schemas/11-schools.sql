CREATE TABLE public.schools (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_user_id uuid NOT NULL
        CONSTRAINT schools_owner_user_id_unique UNIQUE
        CONSTRAINT schools_owner_user_id_users_id_fk REFERENCES public.users(id) ON DELETE CASCADE,
    slug text NOT NULL
        CONSTRAINT schools_slug_unique UNIQUE
        CONSTRAINT schools_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(slug) BETWEEN 3 AND 48),
    timezone text NOT NULL,
    approved_at timestamp with time zone,
    published_at timestamp with time zone,
    previewed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    whatsapp_phone_number_id text,
    whatsapp_waba_id text,
    CONSTRAINT schools_school_id_unique PRIMARY KEY (id)
);

CREATE UNIQUE INDEX schools_whatsapp_phone_number_id_unique ON public.schools USING btree (whatsapp_phone_number_id) WHERE whatsapp_phone_number_id IS NOT NULL;

-- Preserve 0000's invoker function and trigger, including its original body.
CREATE FUNCTION public.prevent_published_school_identity_change()
RETURNS trigger AS $$
BEGIN
  IF OLD.published_at IS NOT NULL THEN
    IF NEW.slug IS DISTINCT FROM OLD.slug OR NEW.timezone IS DISTINCT FROM OLD.timezone THEN
      RAISE EXCEPTION 'slug and timezone are immutable after publish';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER schools_identity_immutable
  BEFORE UPDATE ON public.schools
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_published_school_identity_change();

CREATE TRIGGER schools_set_updated_at
BEFORE UPDATE ON public.schools
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.schools ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.schools FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prevent_published_school_identity_change() FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.schools to authenticated;
GRANT UPDATE (previewed_at, published_at) ON TABLE public.schools TO authenticated;

CREATE POLICY schools_update_own ON public.schools
FOR UPDATE TO authenticated
USING (owner_user_id = (SELECT auth.uid()))
WITH CHECK (owner_user_id = (SELECT auth.uid()));

CREATE POLICY schools_select_own
on public.schools
FOR SELECT
TO authenticated
USING (owner_user_id = (SELECT auth.uid()))
