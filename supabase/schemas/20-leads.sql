CREATE TABLE public.leads (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    school_id uuid NOT NULL,
    landing_session_id uuid NOT NULL,
    contact_id uuid NOT NULL,
    participant_name text,
    participant_age integer,
    trial_offering_id uuid,
    stated_need text,
    status text DEFAULT 'open' NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT leads_school_id_id UNIQUE (school_id, id)
);

ALTER TABLE public.leads ADD CONSTRAINT leads_school_id_fk FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;
ALTER TABLE public.leads ADD CONSTRAINT leads_landing_session_fk FOREIGN KEY (school_id, landing_session_id) REFERENCES public.landing_sessions(school_id, id) ON DELETE RESTRICT;
ALTER TABLE public.leads ADD CONSTRAINT leads_contact_fk FOREIGN KEY (school_id, contact_id) REFERENCES public.contacts(school_id, id) ON DELETE RESTRICT;
ALTER TABLE public.leads ADD CONSTRAINT leads_offering_fk FOREIGN KEY (school_id, trial_offering_id) REFERENCES public.trial_offerings(school_id, id) ON DELETE SET NULL;

ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.leads FROM PUBLIC, anon, authenticated, service_role;
