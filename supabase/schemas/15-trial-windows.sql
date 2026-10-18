CREATE TABLE app.trial_windows (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    school_id uuid NOT NULL,
    trial_offering_id uuid NOT NULL,
    day_of_week integer NOT NULL,
    start_minute integer NOT NULL,
    duration_minutes integer NOT NULL,
    capacity integer NOT NULL,
    label text,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT trial_windows_school_id_id UNIQUE (school_id, id),
    CONSTRAINT trial_windows_day CHECK (day_of_week BETWEEN 0 AND 6),
    CONSTRAINT trial_windows_start_minute CHECK (start_minute BETWEEN 0 AND 1439),
    CONSTRAINT trial_windows_duration CHECK (duration_minutes > 0),
    CONSTRAINT trial_windows_capacity CHECK (capacity BETWEEN 1 AND 50)
);

ALTER TABLE app.trial_windows ADD CONSTRAINT trial_windows_school_id_fk FOREIGN KEY (school_id) REFERENCES app.schools(id) ON DELETE CASCADE;
ALTER TABLE app.trial_windows ADD CONSTRAINT trial_windows_offering_fk FOREIGN KEY (school_id, trial_offering_id) REFERENCES app.trial_offerings(school_id, id) ON DELETE CASCADE;
