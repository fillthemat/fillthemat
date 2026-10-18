CREATE TABLE app.bookings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    school_id uuid NOT NULL,
    contact_id uuid NOT NULL,
    participant_id uuid NOT NULL,
    trial_offering_id uuid NOT NULL,
    trial_window_id uuid NOT NULL,
    trial_occurrence_id uuid NOT NULL,
    conversation_id uuid,
    landing_session_id uuid,
    idempotency_key text NOT NULL,
    status app.booking_status DEFAULT 'booked' NOT NULL,
    participant_name_snapshot text NOT NULL,
    participant_age_snapshot integer NOT NULL,
    offering_name_snapshot text NOT NULL,
    timezone_snapshot text NOT NULL,
    start_at timestamp with time zone NOT NULL,
    end_at timestamp with time zone NOT NULL,
    location_snapshot text,
    instructions_snapshot text,
    contact_email_snapshot text,
    contact_name_snapshot text NOT NULL,
    contact_phone_snapshot text NOT NULL,
    ics_uid text NOT NULL,
    ics_sequence integer DEFAULT 0 NOT NULL,
    cancelled_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT bookings_school_id_id UNIQUE (school_id, id),
    CONSTRAINT bookings_school_idempotency UNIQUE (school_id, idempotency_key),
    CONSTRAINT bookings_participant_age CHECK (participant_age_snapshot BETWEEN 0 AND 99)
);

ALTER TABLE app.bookings ADD CONSTRAINT bookings_school_id_fk FOREIGN KEY (school_id) REFERENCES app.schools(id) ON DELETE CASCADE;
ALTER TABLE app.bookings ADD CONSTRAINT bookings_contact_fk FOREIGN KEY (school_id, contact_id) REFERENCES app.contacts(school_id, id) ON DELETE RESTRICT;
ALTER TABLE app.bookings ADD CONSTRAINT bookings_participant_fk FOREIGN KEY (school_id, participant_id) REFERENCES app.participants(school_id, id) ON DELETE RESTRICT;
ALTER TABLE app.bookings ADD CONSTRAINT bookings_offering_fk FOREIGN KEY (school_id, trial_offering_id) REFERENCES app.trial_offerings(school_id, id) ON DELETE RESTRICT;
ALTER TABLE app.bookings ADD CONSTRAINT bookings_window_fk FOREIGN KEY (school_id, trial_window_id) REFERENCES app.trial_windows(school_id, id) ON DELETE RESTRICT;
ALTER TABLE app.bookings ADD CONSTRAINT bookings_occurrence_fk FOREIGN KEY (school_id, trial_occurrence_id) REFERENCES app.trial_occurrences(school_id, id) ON DELETE RESTRICT;
ALTER TABLE app.bookings ADD CONSTRAINT bookings_conversation_fk FOREIGN KEY (school_id, conversation_id) REFERENCES app.conversations(school_id, id) ON DELETE SET NULL;
ALTER TABLE app.bookings ADD CONSTRAINT bookings_landing_session_fk FOREIGN KEY (school_id, landing_session_id) REFERENCES app.landing_sessions(school_id, id) ON DELETE SET NULL;

CREATE UNIQUE INDEX bookings_active_participant_occurrence ON app.bookings USING btree (trial_occurrence_id, participant_id) WHERE status <> 'cancelled';
