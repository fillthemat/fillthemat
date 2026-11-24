CREATE TABLE public.whatsapp_connections (
    school_id uuid PRIMARY KEY REFERENCES public.schools(id) ON DELETE CASCADE,
    phone_number_id text UNIQUE,
    waba_id text,
    display_phone_number text,
    verified_name text,
    number_source text DEFAULT 'rented' NOT NULL CHECK (number_source IN ('rented')),
    state text DEFAULT 'off' NOT NULL CHECK (state IN (
        'off', 'popup', 'cancelled', 'popup-failed', 'registering', 'failed', 'live', 'broken-card'
    )),
    failure_code text,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT whatsapp_connections_live_number CHECK (state <> 'live' OR phone_number_id IS NOT NULL)
);

CREATE TRIGGER whatsapp_connections_set_updated_at
BEFORE UPDATE ON public.whatsapp_connections
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.whatsapp_connections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.whatsapp_connections FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.whatsapp_connections TO authenticated;
GRANT ALL ON TABLE public.whatsapp_connections TO service_role;

CREATE POLICY whatsapp_connections_select_own_school ON public.whatsapp_connections
FOR SELECT TO authenticated USING (
    school_id = (
        SELECT s.school_id FROM public.school_settings s
        WHERE s.owner_user_id = (SELECT auth.uid())
    )
);

CREATE TABLE public.whatsapp_connection_secrets (
    school_id uuid PRIMARY KEY REFERENCES public.whatsapp_connections(school_id) ON DELETE CASCADE,
    encrypted_token text NOT NULL,
    encrypted_pin text NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL
);

CREATE TRIGGER whatsapp_connection_secrets_set_updated_at
BEFORE UPDATE ON public.whatsapp_connection_secrets
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.whatsapp_connection_secrets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.whatsapp_connection_secrets FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.whatsapp_connection_secrets TO service_role;
