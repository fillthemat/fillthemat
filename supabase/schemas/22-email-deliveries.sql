CREATE TABLE app.email_deliveries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    school_id uuid NOT NULL,
    booking_id uuid,
    lead_id uuid,
    kind app.email_kind NOT NULL,
    recipient text NOT NULL,
    provider_idempotency_key text NOT NULL,
    state app.email_state DEFAULT 'pending' NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    provider_id text,
    last_error text,
    next_attempt_at timestamp with time zone DEFAULT now() NOT NULL,
    sent_at timestamp with time zone,
    claimed_at timestamp with time zone,
    claimed_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    failure_reason text,
    terminal_cause text,
    CONSTRAINT email_deliveries_provider_key UNIQUE (provider_idempotency_key)
);

ALTER TABLE app.email_deliveries ADD CONSTRAINT email_deliveries_school_id_fk FOREIGN KEY (school_id) REFERENCES app.schools(id) ON DELETE CASCADE;
ALTER TABLE app.email_deliveries ADD CONSTRAINT email_deliveries_booking_fk FOREIGN KEY (school_id, booking_id) REFERENCES app.bookings(school_id, id) ON DELETE CASCADE;
ALTER TABLE app.email_deliveries ADD CONSTRAINT email_deliveries_lead_fk FOREIGN KEY (school_id, lead_id) REFERENCES app.leads(school_id, id) ON DELETE CASCADE;

CREATE INDEX email_deliveries_due_idx ON app.email_deliveries USING btree (state, next_attempt_at);
