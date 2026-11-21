-- Facts explicitly intended for a school's public page and assistant.
CREATE TABLE public.school_profiles (
    school_id uuid PRIMARY KEY REFERENCES public.schools(id) ON DELETE CASCADE,
    name text DEFAULT '' NOT NULL,
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
    logo_url text CONSTRAINT school_profiles_logo_url CHECK (logo_url IS NULL OR logo_url ~ '^https://'),
    primary_color text CONSTRAINT school_profiles_primary_color CHECK (primary_color IS NULL OR primary_color ~ '^#[0-9A-Fa-f]{6}$'),
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL
);

CREATE TRIGGER school_profiles_set_updated_at
BEFORE UPDATE ON public.school_profiles
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.school_profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.school_profiles FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.school_profiles TO anon, authenticated;
GRANT INSERT, UPDATE ON public.school_profiles TO authenticated;

CREATE POLICY school_profiles_owner_access ON public.school_profiles
FOR ALL TO authenticated
USING (school_id = (SELECT school_id FROM public.school_settings WHERE owner_user_id = (SELECT auth.uid())))
WITH CHECK (school_id = (SELECT school_id FROM public.school_settings WHERE owner_user_id = (SELECT auth.uid())));

CREATE POLICY school_profiles_public_read ON public.school_profiles
FOR SELECT TO anon, authenticated
USING (EXISTS (
    SELECT 1 FROM public.schools s
    WHERE s.id = school_id AND s.approved_at IS NOT NULL AND s.published_at IS NOT NULL
));
