CREATE TABLE app.users (
    id uuid PRIMARY KEY NOT NULL,
    email text NOT NULL,
    name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Supabase owns auth.users; only the existing app-side reference is declared.
ALTER TABLE app.users ADD CONSTRAINT users_id_auth_users_fk FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
