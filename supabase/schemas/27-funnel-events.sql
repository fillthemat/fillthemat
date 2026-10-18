CREATE TABLE app.funnel_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    school_id uuid NOT NULL,
    landing_session_id uuid,
    conversation_id uuid,
    booking_id uuid,
    lead_id uuid,
    event_type text NOT NULL,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE app.funnel_events ADD CONSTRAINT funnel_events_school_id_fk FOREIGN KEY (school_id) REFERENCES app.schools(id) ON DELETE CASCADE;

CREATE INDEX funnel_events_school_created_idx ON app.funnel_events USING btree (school_id, created_at);
