CREATE TABLE public.schools (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_user_id uuid NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    timezone text NOT NULL,
    approved_at timestamp with time zone,
    published_at timestamp with time zone,
    previewed_at timestamp with time zone,
    notification_email text NOT NULL,
    phone text,
    website text,
    address text,
    country text DEFAULT 'US' NOT NULL,
    city text,
    parking_notes text,
    access_notes text,
    trial_guidance text,
    pricing text,
    welcome_message text,
    agent_instructions text,
    logo_url text,
    primary_color text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    whatsapp_phone_number_id text,
    whatsapp_waba_id text,
    CONSTRAINT schools_school_id_unique PRIMARY KEY (id),
    CONSTRAINT schools_owner_user_id_unique UNIQUE (owner_user_id),
    CONSTRAINT schools_slug_unique UNIQUE (slug),
    CONSTRAINT schools_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(slug) BETWEEN 3 AND 48),
    CONSTRAINT schools_primary_color CHECK (primary_color IS NULL OR primary_color ~ '^#[0-9A-Fa-f]{6}$'),
    CONSTRAINT schools_logo_url CHECK (logo_url IS NULL OR logo_url ~ '^https://')
);

ALTER TABLE public.schools ADD CONSTRAINT schools_owner_user_id_users_id_fk FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE CASCADE;

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

ALTER TABLE public.schools ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.schools FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.prevent_published_school_identity_change() FROM PUBLIC, anon, authenticated, service_role;
