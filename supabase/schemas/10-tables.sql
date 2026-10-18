-- Physical column order and constraint names match replayed Drizzle SQL, not just
-- the latest TypeScript snapshot. Foreign keys are declared in 20-relations.sql.
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

CREATE TABLE app.cron_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    reminder_count integer DEFAULT 0 NOT NULL,
    sent_count integer DEFAULT 0 NOT NULL,
    failed_count integer DEFAULT 0 NOT NULL,
    result app.cron_result,
    error_summary text,
    ended_conversation_count integer DEFAULT 0 NOT NULL
);

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

CREATE TABLE app.faqs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    school_id uuid NOT NULL,
    question text NOT NULL,
    answer text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT faqs_school_id_id UNIQUE (school_id, id),
    CONSTRAINT faqs_question_len CHECK (char_length(question) BETWEEN 1 AND 200),
    CONSTRAINT faqs_answer_len CHECK (char_length(answer) BETWEEN 1 AND 2000)
);

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

CREATE TABLE app.leads (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    school_id uuid NOT NULL,
    landing_session_id uuid NOT NULL,
    contact_id uuid NOT NULL,
    participant_name text,
    participant_age integer,
    trial_offering_id uuid,
    stated_need text,
    status text DEFAULT 'open' NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT leads_school_id_id UNIQUE (school_id, id)
);

CREATE TABLE app.messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid NOT NULL,
    message_id text NOT NULL,
    role text NOT NULL,
    parts jsonb NOT NULL,
    completion app.message_completion DEFAULT 'complete' NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT messages_conversation_message_id UNIQUE (conversation_id, message_id)
);

CREATE TABLE app.participants (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    school_id uuid NOT NULL,
    contact_id uuid NOT NULL,
    name text NOT NULL,
    normalized_name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT participants_school_id_id UNIQUE (school_id, id),
    CONSTRAINT participants_contact_normalized_name UNIQUE (contact_id, normalized_name)
);

CREATE TABLE app.schools (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_user_id uuid NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    timezone text NOT NULL,
    approved_at timestamp with time zone,
    published_at timestamp with time zone,
    previewed_at timestamp with time zone,
    notification_email text NOT NULL,
    phone text,
    website text,
    address text,
    country text DEFAULT 'US' NOT NULL,
    city text,
    parking_notes text,
    access_notes text,
    trial_guidance text,
    pricing text,
    welcome_message text,
    agent_instructions text,
    logo_url text,
    primary_color text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    whatsapp_phone_number_id text,
    whatsapp_waba_id text,
    CONSTRAINT schools_school_id_unique PRIMARY KEY (id),
    CONSTRAINT schools_owner_user_id_unique UNIQUE (owner_user_id),
    CONSTRAINT schools_slug_unique UNIQUE (slug),
    CONSTRAINT schools_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(slug) BETWEEN 3 AND 48),
    CONSTRAINT schools_primary_color CHECK (primary_color IS NULL OR primary_color ~ '^#[0-9A-Fa-f]{6}$'),
    CONSTRAINT schools_logo_url CHECK (logo_url IS NULL OR logo_url ~ '^https://')
);

CREATE TABLE app.trial_occurrences (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    school_id uuid NOT NULL,
    trial_window_id uuid NOT NULL,
    trial_offering_id uuid NOT NULL,
    start_at timestamp with time zone NOT NULL,
    end_at timestamp with time zone NOT NULL,
    capacity integer NOT NULL,
    booked_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT trial_occurrences_school_id_id UNIQUE (school_id, id),
    CONSTRAINT trial_occurrences_window_start UNIQUE (trial_window_id, start_at),
    CONSTRAINT trial_occurrences_booked_count CHECK (booked_count >= 0 AND booked_count <= capacity),
    CONSTRAINT trial_occurrences_capacity CHECK (capacity BETWEEN 1 AND 50),
    CONSTRAINT trial_occurrences_range CHECK (end_at > start_at)
);

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

CREATE TABLE app.users (
    id uuid PRIMARY KEY NOT NULL,
    email text NOT NULL,
    name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE app.whatsapp_booking_intents (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    school_id uuid NOT NULL,
    conversation_id uuid NOT NULL,
    offering_id uuid NOT NULL,
    slot_id text NOT NULL,
    participant_name text,
    participant_age integer,
    state app.whatsapp_booking_intent_state DEFAULT 'pending' NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT whatsapp_booking_intents_school_id_id UNIQUE (school_id, id),
    CONSTRAINT whatsapp_booking_intents_age CHECK (participant_age IS NULL OR participant_age BETWEEN 0 AND 99)
);

CREATE TABLE app.whatsapp_deliveries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    school_id uuid NOT NULL,
    booking_id uuid,
    lead_id uuid,
    recipient_wa_id text NOT NULL,
    phone_number_id text NOT NULL,
    provider_idempotency_key text NOT NULL,
    state app.whatsapp_delivery_state DEFAULT 'pending' NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    provider_id text,
    template_name text,
    template_params jsonb,
    window_expires_at timestamp with time zone,
    next_attempt_at timestamp with time zone DEFAULT now() NOT NULL,
    sent_at timestamp with time zone,
    claimed_at timestamp with time zone,
    claimed_by text,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    body text,
    status_at timestamp with time zone,
    interactive_buttons jsonb,
    failure_reason text,
    failure_code integer,
    terminal_cause text,
    send_outcome app.whatsapp_send_outcome,
    CONSTRAINT whatsapp_deliveries_provider_key UNIQUE (provider_idempotency_key)
);

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
