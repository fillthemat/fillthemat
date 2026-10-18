CREATE TABLE app.trial_offerings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    school_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    minimum_age integer,
    maximum_age integer,
    expectations text,
    attire text,
    waiver_notes text,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT trial_offerings_school_id_id UNIQUE (school_id, id),
    CONSTRAINT trial_offerings_age_range CHECK (
        (minimum_age IS NULL OR minimum_age BETWEEN 0 AND 99)
        AND (maximum_age IS NULL OR maximum_age BETWEEN 0 AND 99)
        AND (minimum_age IS NULL OR maximum_age IS NULL OR minimum_age <= maximum_age)
    ),
    CONSTRAINT trial_offerings_name_len CHECK (char_length(name) BETWEEN 1 AND 80)
);

ALTER TABLE app.trial_offerings ADD CONSTRAINT trial_offerings_school_id_fk FOREIGN KEY (school_id) REFERENCES app.schools(id) ON DELETE CASCADE;
