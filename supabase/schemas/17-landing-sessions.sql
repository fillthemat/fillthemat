CREATE TABLE app.landing_sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    school_id uuid NOT NULL,
    session_key_hash text NOT NULL,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    qualified_at timestamp with time zone,
    utm_source text,
    utm_medium text,
    utm_campaign text,
    utm_content text,
    utm_term text,
    is_preview boolean DEFAULT false NOT NULL,
    bot_exclusion_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT landing_sessions_school_id_id UNIQUE (school_id, id),
    CONSTRAINT landing_sessions_school_key UNIQUE (school_id, session_key_hash)
);

ALTER TABLE app.landing_sessions ADD CONSTRAINT landing_sessions_school_id_fk FOREIGN KEY (school_id) REFERENCES app.schools(id) ON DELETE CASCADE;
