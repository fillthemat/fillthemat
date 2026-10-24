-- Private operator configuration. Ownership lives here so public school rows
-- never expose user IDs, notification destinations or provider identifiers.
CREATE TABLE public.school_settings (
    school_id uuid PRIMARY KEY REFERENCES public.schools(id) ON DELETE CASCADE,
    owner_user_id uuid NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
    notification_email text DEFAULT '' NOT NULL,
    agent_instructions text,
    previewed_at timestamptz,
    whatsapp_phone_number_id text,
    whatsapp_waba_id text,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX school_settings_whatsapp_phone_number_id_unique
ON public.school_settings (whatsapp_phone_number_id) WHERE whatsapp_phone_number_id IS NOT NULL;

CREATE TRIGGER school_settings_set_updated_at
BEFORE UPDATE ON public.school_settings
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER school_settings_delete_school
AFTER DELETE ON public.school_settings
FOR EACH ROW EXECUTE FUNCTION public.delete_school_after_account();

ALTER TABLE public.school_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.school_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.school_settings TO authenticated;
GRANT UPDATE (notification_email, agent_instructions, previewed_at, updated_at)
ON TABLE public.school_settings TO authenticated;

-- Only the platform assigns ownership and provider IDs. Owner updates cannot
-- claim a different school or transfer its account.
CREATE POLICY school_settings_owner_access ON public.school_settings
FOR ALL TO authenticated
USING (owner_user_id = (SELECT auth.uid()))
WITH CHECK (owner_user_id = (SELECT auth.uid()));
