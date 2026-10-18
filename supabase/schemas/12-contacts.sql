CREATE TABLE app.contacts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    school_id uuid NOT NULL,
    email text,
    name text NOT NULL,
    phone text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT contacts_school_id_id UNIQUE (school_id, id),
    CONSTRAINT contacts_school_email UNIQUE (school_id, email),
    CONSTRAINT contacts_school_phone UNIQUE (school_id, phone)
);

ALTER TABLE app.contacts ADD CONSTRAINT contacts_school_id_fk FOREIGN KEY (school_id) REFERENCES app.schools(id) ON DELETE CASCADE;
