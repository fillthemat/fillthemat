CREATE TABLE app.leads (
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

ALTER TABLE app.leads ADD CONSTRAINT leads_school_id_fk FOREIGN KEY (school_id) REFERENCES app.schools(id) ON DELETE CASCADE;
ALTER TABLE app.leads ADD CONSTRAINT leads_landing_session_fk FOREIGN KEY (school_id, landing_session_id) REFERENCES app.landing_sessions(school_id, id) ON DELETE RESTRICT;
ALTER TABLE app.leads ADD CONSTRAINT leads_contact_fk FOREIGN KEY (school_id, contact_id) REFERENCES app.contacts(school_id, id) ON DELETE RESTRICT;
ALTER TABLE app.leads ADD CONSTRAINT leads_offering_fk FOREIGN KEY (school_id, trial_offering_id) REFERENCES app.trial_offerings(school_id, id) ON DELETE SET NULL;
