CREATE TABLE app.whatsapp_jobs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    school_id uuid,
    phone_number_id text NOT NULL,
    dedupe_key text NOT NULL,
    kind text DEFAULT 'inbound_message' NOT NULL,
    payload jsonb NOT NULL,
    state app.whatsapp_job_state DEFAULT 'pending' NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    next_attempt_at timestamp with time zone DEFAULT now() NOT NULL,
    claimed_at timestamp with time zone,
    claimed_by text,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    failure_reason text,
    terminal_cause text,
    CONSTRAINT whatsapp_jobs_dedupe_key UNIQUE (dedupe_key)
);

ALTER TABLE app.whatsapp_jobs ADD CONSTRAINT whatsapp_jobs_school_id_fk FOREIGN KEY (school_id) REFERENCES app.schools(id) ON DELETE SET NULL;

CREATE INDEX whatsapp_jobs_due_idx ON app.whatsapp_jobs USING btree (state, next_attempt_at);
