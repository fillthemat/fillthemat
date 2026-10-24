CREATE TABLE public.school_settings (
    school_id uuid PRIMARY KEY REFERENCES public.schools(id) ON DELETE CASCADE,
    name text DEFAULT '' NOT NULL,
    notification_email text DEFAULT '' NOT NULL,
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
    logo_url text CONSTRAINT school_settings_logo_url CHECK (logo_url IS NULL OR logo_url ~ '^https://'),
    primary_color text CONSTRAINT school_settings_primary_color CHECK (primary_color IS NULL OR primary_color ~ '^#[0-9A-Fa-f]{6}$'),
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL
);

CREATE TRIGGER school_settings_set_updated_at
BEFORE UPDATE ON public.school_settings
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.school_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.school_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.school_settings TO authenticated;

CREATE POLICY school_settings_owner_access ON public.school_settings
FOR ALL TO authenticated
USING (school_id = (SELECT id FROM public.schools WHERE owner_user_id = (SELECT auth.uid())))
WITH CHECK (school_id = (SELECT id FROM public.schools WHERE owner_user_id = (SELECT auth.uid())));
