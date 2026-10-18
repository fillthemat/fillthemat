CREATE TABLE app.conversations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    school_id uuid NOT NULL,
    landing_session_id uuid,
    contact_id uuid,
    resume_token_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    generating_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    wa_id_hash text,
    ended_at timestamp with time zone,
    end_reason app.conversation_end_reason,
    CONSTRAINT conversations_school_id_id UNIQUE (school_id, id)
);

ALTER TABLE app.conversations ADD CONSTRAINT conversations_school_id_fk FOREIGN KEY (school_id) REFERENCES app.schools(id) ON DELETE CASCADE;
ALTER TABLE app.conversations ADD CONSTRAINT conversations_landing_session_fk FOREIGN KEY (school_id, landing_session_id) REFERENCES app.landing_sessions(school_id, id) ON DELETE SET NULL;
ALTER TABLE app.conversations ADD CONSTRAINT conversations_contact_fk FOREIGN KEY (school_id, contact_id) REFERENCES app.contacts(school_id, id) ON DELETE SET NULL;

CREATE UNIQUE INDEX conversations_resume_token_hash ON app.conversations USING btree (resume_token_hash) WHERE ended_at IS NULL;
CREATE UNIQUE INDEX conversations_school_wa_id_hash ON app.conversations USING btree (school_id, wa_id_hash) WHERE wa_id_hash IS NOT NULL AND ended_at IS NULL;
