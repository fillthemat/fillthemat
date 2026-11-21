SET local check_function_bodies = off;

-- pg-delta does not emit this schema-level revoke from 00-public.sql.
-- Preserve the trigger-only policy boundary on stacks with legacy grants.
REVOKE CREATE ON SCHEMA public FROM PUBLIC, anon, authenticated;

CREATE TABLE "public"."bookings" (
  "id"                  uuid NOT NULL DEFAULT gen_random_uuid(),
  "school_id"           uuid NOT NULL,
  "contact_id"          uuid NOT NULL,
  "participant_id"      uuid NOT NULL,
  "trial_offering_id"   uuid NOT NULL,
  "trial_window_id"     uuid NOT NULL,
  "trial_occurrence_id" uuid NOT NULL,
  "conversation_id"     uuid,
  "landing_session_id"  uuid,
  "idempotency_key"     text NOT NULL,
  CONSTRAINT "bookings_pkey" PRIMARY KEY (id),
  CONSTRAINT "bookings_school_id_id" UNIQUE (school_id, id),
  CONSTRAINT "bookings_school_idempotency" UNIQUE (school_id, idempotency_key)
);

ALTER TABLE "public"."bookings"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."bookings" FROM "anon";

CREATE TABLE "public"."contacts" (
  "id"         uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "school_id"  uuid                     NOT NULL,
  "email"      text,
  "name"       text                     NOT NULL,
  "phone"      text                     NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "contacts_pkey" PRIMARY KEY (id),
  CONSTRAINT "contacts_school_email" UNIQUE (school_id, email),
  CONSTRAINT "contacts_school_id_id" UNIQUE (school_id, id),
  CONSTRAINT "contacts_school_phone" UNIQUE (school_id, phone)
);

ALTER TABLE "public"."contacts"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."contacts" FROM "anon";

CREATE TABLE "public"."conversations" (
  "id"                 uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "school_id"          uuid                     NOT NULL,
  "landing_session_id" uuid,
  "contact_id"         uuid,
  "resume_token_hash"  text                     NOT NULL,
  "expires_at"         timestamp with time zone NOT NULL,
  "generating_at"      timestamp with time zone,
  "created_at"         timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"         timestamp with time zone NOT NULL DEFAULT now(),
  "wa_id_hash"         text,
  "ended_at"           timestamp with time zone,
  CONSTRAINT "conversations_pkey" PRIMARY KEY (id),
  CONSTRAINT "conversations_school_id_id" UNIQUE (school_id, id)
);

ALTER TABLE "public"."conversations"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."conversations" FROM "anon";

CREATE TABLE "public"."cron_runs" (
  "id"             uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "started_at"     timestamp with time zone NOT NULL DEFAULT now(),
  "finished_at"    timestamp with time zone,
  "reminder_count" integer                  NOT NULL DEFAULT 0,
  "sent_count"     integer                  NOT NULL DEFAULT 0,
  "failed_count"   integer                  NOT NULL DEFAULT 0,
  CONSTRAINT "cron_runs_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."cron_runs"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."cron_runs" FROM "anon", "authenticated";

CREATE TABLE "public"."email_deliveries" (
  "id"         uuid NOT NULL DEFAULT gen_random_uuid(),
  "school_id"  uuid NOT NULL,
  "booking_id" uuid,
  "lead_id"    uuid,
  CONSTRAINT "email_deliveries_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."email_deliveries"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."email_deliveries" FROM "anon";

CREATE TABLE "public"."faqs" (
  "id"         uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "school_id"  uuid                     NOT NULL,
  "question"   text                     NOT NULL,
  "answer"     text                     NOT NULL,
  "sort_order" integer                  NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "faqs_answer_len" CHECK (((char_length(answer) >= 1) AND (char_length(answer) <= 2000))),
  CONSTRAINT "faqs_pkey" PRIMARY KEY (id),
  CONSTRAINT "faqs_question_len" CHECK (((char_length(question) >= 1) AND (char_length(question) <= 200))),
  CONSTRAINT "faqs_school_id_id" UNIQUE (school_id, id)
);

ALTER TABLE "public"."faqs"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."funnel_events" (
  "id"                 uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "school_id"          uuid                     NOT NULL,
  "landing_session_id" uuid,
  "conversation_id"    uuid,
  "booking_id"         uuid,
  "lead_id"            uuid,
  "event_type"         text                     NOT NULL,
  "metadata"           jsonb,
  "created_at"         timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "funnel_events_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."funnel_events"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."funnel_events" FROM "anon";

CREATE TABLE "public"."landing_sessions" (
  "id"                   uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "school_id"            uuid                     NOT NULL,
  "session_key_hash"     text                     NOT NULL,
  "first_seen_at"        timestamp with time zone NOT NULL DEFAULT now(),
  "last_seen_at"         timestamp with time zone NOT NULL DEFAULT now(),
  "qualified_at"         timestamp with time zone,
  "utm_source"           text,
  "utm_medium"           text,
  "utm_campaign"         text,
  "utm_content"          text,
  "utm_term"             text,
  "is_preview"           boolean                  NOT NULL DEFAULT false,
  "bot_exclusion_reason" text,
  "created_at"           timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"           timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "landing_sessions_pkey" PRIMARY KEY (id),
  CONSTRAINT "landing_sessions_school_id_id" UNIQUE (school_id, id),
  CONSTRAINT "landing_sessions_school_key" UNIQUE (school_id, session_key_hash)
);

ALTER TABLE "public"."landing_sessions"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."landing_sessions" FROM "anon";

CREATE TABLE "public"."leads" (
  "id"                 uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "school_id"          uuid                     NOT NULL,
  "landing_session_id" uuid                     NOT NULL,
  "contact_id"         uuid                     NOT NULL,
  "participant_name"   text,
  "participant_age"    integer,
  "trial_offering_id"  uuid,
  "stated_need"        text,
  "status"             text                     NOT NULL DEFAULT 'open'::text,
  "created_at"         timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"         timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "leads_pkey" PRIMARY KEY (id),
  CONSTRAINT "leads_school_id_id" UNIQUE (school_id, id)
);

ALTER TABLE "public"."leads"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."leads" FROM "anon";

CREATE TABLE "public"."messages" (
  "id"              uuid  NOT NULL DEFAULT gen_random_uuid(),
  "conversation_id" uuid  NOT NULL,
  "message_id"      text  NOT NULL,
  "role"            text  NOT NULL,
  "parts"           jsonb NOT NULL,
  CONSTRAINT "messages_conversation_message_id" UNIQUE (conversation_id, message_id),
  CONSTRAINT "messages_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."messages"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."messages" FROM "anon";

CREATE TABLE "public"."participants" (
  "id"              uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "school_id"       uuid                     NOT NULL,
  "contact_id"      uuid                     NOT NULL,
  "name"            text                     NOT NULL,
  "normalized_name" text                     NOT NULL,
  "created_at"      timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"      timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "participants_contact_normalized_name" UNIQUE (contact_id, normalized_name),
  CONSTRAINT "participants_pkey" PRIMARY KEY (id),
  CONSTRAINT "participants_school_id_id" UNIQUE (school_id, id)
);

ALTER TABLE "public"."participants"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."participants" FROM "anon";

CREATE TABLE "public"."school_profiles" (
  "school_id"       uuid                     NOT NULL,
  "name"            text                     NOT NULL DEFAULT ''::text,
  "phone"           text,
  "website"         text,
  "address"         text,
  "country"         text                     NOT NULL DEFAULT 'US'::text,
  "city"            text,
  "parking_notes"   text,
  "access_notes"    text,
  "trial_guidance"  text,
  "pricing"         text,
  "welcome_message" text,
  "logo_url"        text,
  "primary_color"   text,
  "created_at"      timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"      timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "school_profiles_logo_url" CHECK (((logo_url IS NULL) OR (logo_url ~ '^https://'::text))),
  CONSTRAINT "school_profiles_pkey" PRIMARY KEY (school_id),
  CONSTRAINT "school_profiles_primary_color" CHECK (((primary_color IS NULL) OR (primary_color ~ '^#[0-9A-Fa-f]{6}$'::text)))
);

ALTER TABLE "public"."school_profiles"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."school_settings" (
  "school_id"                uuid                     NOT NULL,
  "owner_user_id"            uuid                     NOT NULL,
  "notification_email"       text                     NOT NULL DEFAULT ''::text,
  "agent_instructions"       text,
  "previewed_at"             timestamp with time zone,
  "whatsapp_phone_number_id" text,
  "whatsapp_waba_id"         text,
  "created_at"               timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"               timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "school_settings_owner_user_id_key" UNIQUE (owner_user_id),
  CONSTRAINT "school_settings_pkey" PRIMARY KEY (school_id)
);

ALTER TABLE "public"."school_settings"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."school_settings" FROM "anon";

CREATE TABLE "public"."schools" (
  "id"           uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "slug"         text                     NOT NULL,
  "timezone"     text                     NOT NULL,
  "approved_at"  timestamp with time zone,
  "published_at" timestamp with time zone,
  "created_at"   timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"   timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "schools_school_id_unique" PRIMARY KEY (id),
  CONSTRAINT "schools_slug_format" CHECK (((slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text) AND ((char_length(slug) >= 3) AND (char_length(slug) <= 48)))),
  CONSTRAINT "schools_slug_unique" UNIQUE (slug)
);

ALTER TABLE "public"."schools"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."trial_occurrences" (
  "id"                uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "school_id"         uuid                     NOT NULL,
  "trial_window_id"   uuid                     NOT NULL,
  "trial_offering_id" uuid                     NOT NULL,
  "start_at"          timestamp with time zone NOT NULL,
  "end_at"            timestamp with time zone NOT NULL,
  "capacity"          integer                  NOT NULL,
  "booked_count"      integer                  NOT NULL DEFAULT 0,
  "created_at"        timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"        timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "trial_occurrences_booked_count" CHECK (((booked_count >= 0) AND (booked_count <= capacity))),
  CONSTRAINT "trial_occurrences_capacity" CHECK (((capacity >= 1) AND (capacity <= 50))),
  CONSTRAINT "trial_occurrences_pkey" PRIMARY KEY (id),
  CONSTRAINT "trial_occurrences_range" CHECK ((end_at > start_at)),
  CONSTRAINT "trial_occurrences_school_id_id" UNIQUE (school_id, id),
  CONSTRAINT "trial_occurrences_window_start" UNIQUE (trial_window_id, start_at)
);

ALTER TABLE "public"."trial_occurrences"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."trial_offerings" (
  "id"           uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "school_id"    uuid                     NOT NULL,
  "name"         text                     NOT NULL,
  "description"  text,
  "minimum_age"  integer,
  "maximum_age"  integer,
  "expectations" text,
  "attire"       text,
  "waiver_notes" text,
  "active"       boolean                  NOT NULL DEFAULT true,
  "created_at"   timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"   timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "trial_offerings_age_range"
    CHECK
    ((((minimum_age IS NULL) OR ((minimum_age >= 0) AND (minimum_age <= 99))) AND ((maximum_age IS NULL) OR ((maximum_age >= 0) AND (maximum_age <= 99))) AND ((minimum_age IS NULL)
    OR (maximum_age IS NULL) OR (minimum_age <= maximum_age)))),
  CONSTRAINT "trial_offerings_name_len" CHECK (((char_length(name) >= 1) AND (char_length(name) <= 80))),
  CONSTRAINT "trial_offerings_pkey" PRIMARY KEY (id),
  CONSTRAINT "trial_offerings_school_id_id" UNIQUE (school_id, id)
);

ALTER TABLE "public"."trial_offerings"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."trial_windows" (
  "id"                uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "school_id"         uuid                     NOT NULL,
  "trial_offering_id" uuid                     NOT NULL,
  "day_of_week"       integer                  NOT NULL,
  "start_minute"      integer                  NOT NULL,
  "duration_minutes"  integer                  NOT NULL,
  "capacity"          integer                  NOT NULL,
  "label"             text,
  "active"            boolean                  NOT NULL DEFAULT true,
  "created_at"        timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"        timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "trial_windows_capacity" CHECK (((capacity >= 1) AND (capacity <= 50))),
  CONSTRAINT "trial_windows_day" CHECK (((day_of_week >= 0) AND (day_of_week <= 6))),
  CONSTRAINT "trial_windows_duration" CHECK ((duration_minutes > 0)),
  CONSTRAINT "trial_windows_pkey" PRIMARY KEY (id),
  CONSTRAINT "trial_windows_school_id_id" UNIQUE (school_id, id),
  CONSTRAINT "trial_windows_start_minute" CHECK (((start_minute >= 0) AND (start_minute <= 1439)))
);

ALTER TABLE "public"."trial_windows"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."users" (
  "id"         uuid                     NOT NULL,
  "email"      text                     NOT NULL,
  "name"       text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "users_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."users"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."users" FROM "anon";

CREATE TABLE "public"."whatsapp_booking_intents" (
  "id"               uuid    NOT NULL DEFAULT gen_random_uuid(),
  "school_id"        uuid    NOT NULL,
  "conversation_id"  uuid    NOT NULL,
  "offering_id"      uuid    NOT NULL,
  "slot_id"          text    NOT NULL,
  "participant_name" text,
  "participant_age"  integer,
  CONSTRAINT "whatsapp_booking_intents_age" CHECK (((participant_age IS NULL) OR ((participant_age >= 0) AND (participant_age <= 99)))),
  CONSTRAINT "whatsapp_booking_intents_pkey" PRIMARY KEY (id),
  CONSTRAINT "whatsapp_booking_intents_school_id_id" UNIQUE (school_id, id)
);

ALTER TABLE "public"."whatsapp_booking_intents"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."whatsapp_booking_intents" FROM "anon";

CREATE TABLE "public"."whatsapp_deliveries" (
  "id"                       uuid NOT NULL DEFAULT gen_random_uuid(),
  "school_id"                uuid NOT NULL,
  "booking_id"               uuid,
  "lead_id"                  uuid,
  "recipient_wa_id"          text NOT NULL,
  "phone_number_id"          text NOT NULL,
  "provider_idempotency_key" text NOT NULL,
  CONSTRAINT "whatsapp_deliveries_pkey" PRIMARY KEY (id),
  CONSTRAINT "whatsapp_deliveries_provider_key" UNIQUE (provider_idempotency_key)
);

ALTER TABLE "public"."whatsapp_deliveries"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."whatsapp_deliveries" FROM "anon";

CREATE TABLE "public"."whatsapp_jobs" (
  "id"              uuid  NOT NULL DEFAULT gen_random_uuid(),
  "school_id"       uuid,
  "phone_number_id" text  NOT NULL,
  "dedupe_key"      text  NOT NULL,
  "kind"            text  NOT NULL DEFAULT 'inbound_message'::text,
  "payload"         jsonb NOT NULL,
  CONSTRAINT "whatsapp_jobs_dedupe_key" UNIQUE (dedupe_key),
  CONSTRAINT "whatsapp_jobs_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."whatsapp_jobs"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."whatsapp_jobs" FROM "anon";

CREATE TYPE "public"."booking_status" AS ENUM (
  'booked',
  'showed',
  'no_show',
  'cancelled'
);

ALTER TABLE "public"."bookings"
  ADD COLUMN "status" public.booking_status NOT NULL DEFAULT 'booked'::public.booking_status;

ALTER TABLE "public"."bookings"
  ADD COLUMN "participant_name_snapshot" text NOT NULL;

ALTER TABLE "public"."bookings"
  ADD COLUMN "participant_age_snapshot" integer NOT NULL;

ALTER TABLE "public"."bookings"
  ADD COLUMN "offering_name_snapshot" text NOT NULL;

ALTER TABLE "public"."bookings"
  ADD COLUMN "timezone_snapshot" text NOT NULL;

ALTER TABLE "public"."bookings"
  ADD COLUMN "start_at" timestamp WITH time zone NOT NULL;

ALTER TABLE "public"."bookings"
  ADD COLUMN "end_at" timestamp WITH time zone NOT NULL;

ALTER TABLE "public"."bookings"
  ADD COLUMN "location_snapshot" text;

ALTER TABLE "public"."bookings"
  ADD COLUMN "instructions_snapshot" text;

ALTER TABLE "public"."bookings"
  ADD COLUMN "contact_email_snapshot" text;

ALTER TABLE "public"."bookings"
  ADD COLUMN "contact_name_snapshot" text NOT NULL;

ALTER TABLE "public"."bookings"
  ADD COLUMN "contact_phone_snapshot" text NOT NULL;

ALTER TABLE "public"."bookings"
  ADD COLUMN "ics_uid" text NOT NULL;

ALTER TABLE "public"."bookings"
  ADD COLUMN "ics_sequence" integer NOT NULL DEFAULT 0;

ALTER TABLE "public"."bookings"
  ADD COLUMN "cancelled_at" timestamp WITH time zone;

ALTER TABLE "public"."bookings"
  ADD COLUMN "created_at" timestamp WITH time zone NOT NULL DEFAULT now();

ALTER TABLE "public"."bookings"
  ADD COLUMN "updated_at" timestamp WITH time zone NOT NULL DEFAULT now();

ALTER TABLE "public"."bookings"
  ADD COLUMN "is_preview" boolean NOT NULL DEFAULT false;

CREATE TYPE "public"."conversation_end_reason" AS ENUM (
  'inactivity',
  'message_limit'
);

ALTER TABLE "public"."conversations"
  ADD COLUMN "end_reason" public.conversation_end_reason;

CREATE TYPE "public"."cron_result" AS ENUM (
  'success',
  'error'
);

ALTER TABLE "public"."cron_runs"
  ADD COLUMN "result" public.cron_result;

ALTER TABLE "public"."cron_runs"
  ADD COLUMN "error_summary" text;

ALTER TABLE "public"."cron_runs"
  ADD COLUMN "ended_conversation_count" integer NOT NULL DEFAULT 0;

CREATE TYPE "public"."email_kind" AS ENUM (
  'prospect_confirmation',
  'booking_reminder',
  'booking_cancellation',
  'owner_booking',
  'owner_cancellation',
  'owner_lead',
  'owner_whatsapp_confirmation_failed'
);

ALTER TABLE "public"."email_deliveries"
  ADD COLUMN "kind" public.email_kind NOT NULL;

ALTER TABLE "public"."email_deliveries"
  ADD COLUMN "recipient" text NOT NULL;

ALTER TABLE "public"."email_deliveries"
  ADD COLUMN "provider_idempotency_key" text NOT NULL;

CREATE TYPE "public"."email_state" AS ENUM (
  'pending',
  'claimed',
  'sent',
  'failed',
  'delivered',
  'bounced',
  'complained',
  'dead'
);

ALTER TABLE "public"."email_deliveries"
  ADD COLUMN "state" public.email_state NOT NULL DEFAULT 'pending'::public.email_state;

ALTER TABLE "public"."email_deliveries"
  ADD COLUMN "attempts" integer NOT NULL DEFAULT 0;

ALTER TABLE "public"."email_deliveries"
  ADD COLUMN "provider_id" text;

ALTER TABLE "public"."email_deliveries"
  ADD COLUMN "last_error" text;

ALTER TABLE "public"."email_deliveries"
  ADD COLUMN "next_attempt_at" timestamp WITH time zone NOT NULL DEFAULT now();

ALTER TABLE "public"."email_deliveries"
  ADD COLUMN "sent_at" timestamp WITH time zone;

ALTER TABLE "public"."email_deliveries"
  ADD COLUMN "claimed_at" timestamp WITH time zone;

ALTER TABLE "public"."email_deliveries"
  ADD COLUMN "claimed_by" text;

ALTER TABLE "public"."email_deliveries"
  ADD COLUMN "created_at" timestamp WITH time zone NOT NULL DEFAULT now();

ALTER TABLE "public"."email_deliveries"
  ADD COLUMN "updated_at" timestamp WITH time zone NOT NULL DEFAULT now();

ALTER TABLE "public"."email_deliveries"
  ADD COLUMN "failure_reason" text;

ALTER TABLE "public"."email_deliveries"
  ADD COLUMN "terminal_cause" text;

CREATE TYPE "public"."message_completion" AS ENUM (
  'complete',
  'streaming',
  'aborted',
  'error'
);

ALTER TABLE "public"."messages"
  ADD COLUMN "completion" public.message_completion NOT NULL DEFAULT 'complete'::public.message_completion;

ALTER TABLE "public"."messages"
  ADD COLUMN "created_at" timestamp WITH time zone NOT NULL DEFAULT now();

ALTER TABLE "public"."messages"
  ADD COLUMN "updated_at" timestamp WITH time zone NOT NULL DEFAULT now();

CREATE TYPE "public"."whatsapp_booking_intent_state" AS ENUM (
  'pending',
  'confirmed',
  'expired',
  'superseded'
);

ALTER TABLE "public"."whatsapp_booking_intents"
  ADD COLUMN "state" public.whatsapp_booking_intent_state NOT NULL DEFAULT 'pending'::public.whatsapp_booking_intent_state;

ALTER TABLE "public"."whatsapp_booking_intents"
  ADD COLUMN "expires_at" timestamp WITH time zone NOT NULL;

ALTER TABLE "public"."whatsapp_booking_intents"
  ADD COLUMN "created_at" timestamp WITH time zone NOT NULL DEFAULT now();

ALTER TABLE "public"."whatsapp_booking_intents"
  ADD COLUMN "updated_at" timestamp WITH time zone NOT NULL DEFAULT now();

CREATE TYPE "public"."whatsapp_delivery_state" AS ENUM (
  'pending',
  'claimed',
  'sent',
  'delivered',
  'read',
  'failed',
  'dead'
);

ALTER TABLE "public"."whatsapp_deliveries"
  ADD COLUMN "state" public.whatsapp_delivery_state NOT NULL DEFAULT 'pending'::public.whatsapp_delivery_state;

ALTER TABLE "public"."whatsapp_deliveries"
  ADD COLUMN "attempts" integer NOT NULL DEFAULT 0;

ALTER TABLE "public"."whatsapp_deliveries"
  ADD COLUMN "provider_id" text;

ALTER TABLE "public"."whatsapp_deliveries"
  ADD COLUMN "template_name" text;

ALTER TABLE "public"."whatsapp_deliveries"
  ADD COLUMN "template_params" jsonb;

ALTER TABLE "public"."whatsapp_deliveries"
  ADD COLUMN "window_expires_at" timestamp WITH time zone;

ALTER TABLE "public"."whatsapp_deliveries"
  ADD COLUMN "next_attempt_at" timestamp WITH time zone NOT NULL DEFAULT now();

ALTER TABLE "public"."whatsapp_deliveries"
  ADD COLUMN "sent_at" timestamp WITH time zone;

ALTER TABLE "public"."whatsapp_deliveries"
  ADD COLUMN "claimed_at" timestamp WITH time zone;

ALTER TABLE "public"."whatsapp_deliveries"
  ADD COLUMN "claimed_by" text;

ALTER TABLE "public"."whatsapp_deliveries"
  ADD COLUMN "last_error" text;

ALTER TABLE "public"."whatsapp_deliveries"
  ADD COLUMN "created_at" timestamp WITH time zone NOT NULL DEFAULT now();

ALTER TABLE "public"."whatsapp_deliveries"
  ADD COLUMN "updated_at" timestamp WITH time zone NOT NULL DEFAULT now();

ALTER TABLE "public"."whatsapp_deliveries"
  ADD COLUMN "body" text;

ALTER TABLE "public"."whatsapp_deliveries"
  ADD COLUMN "status_at" timestamp WITH time zone;

ALTER TABLE "public"."whatsapp_deliveries"
  ADD COLUMN "interactive_buttons" jsonb;

ALTER TABLE "public"."whatsapp_deliveries"
  ADD COLUMN "failure_reason" text;

ALTER TABLE "public"."whatsapp_deliveries"
  ADD COLUMN "failure_code" integer;

ALTER TABLE "public"."whatsapp_deliveries"
  ADD COLUMN "terminal_cause" text;

CREATE TYPE "public"."whatsapp_job_state" AS ENUM (
  'pending',
  'claimed',
  'done',
  'failed',
  'dead'
);

ALTER TABLE "public"."whatsapp_jobs"
  ADD COLUMN "state" public.whatsapp_job_state NOT NULL DEFAULT 'pending'::public.whatsapp_job_state;

ALTER TABLE "public"."whatsapp_jobs"
  ADD COLUMN "attempts" integer NOT NULL DEFAULT 0;

ALTER TABLE "public"."whatsapp_jobs"
  ADD COLUMN "next_attempt_at" timestamp WITH time zone NOT NULL DEFAULT now();

ALTER TABLE "public"."whatsapp_jobs"
  ADD COLUMN "claimed_at" timestamp WITH time zone;

ALTER TABLE "public"."whatsapp_jobs"
  ADD COLUMN "claimed_by" text;

ALTER TABLE "public"."whatsapp_jobs"
  ADD COLUMN "last_error" text;

ALTER TABLE "public"."whatsapp_jobs"
  ADD COLUMN "created_at" timestamp WITH time zone NOT NULL DEFAULT now();

ALTER TABLE "public"."whatsapp_jobs"
  ADD COLUMN "updated_at" timestamp WITH time zone NOT NULL DEFAULT now();

ALTER TABLE "public"."whatsapp_jobs"
  ADD COLUMN "failure_reason" text;

ALTER TABLE "public"."whatsapp_jobs"
  ADD COLUMN "terminal_cause" text;

CREATE TYPE "public"."whatsapp_send_outcome" AS ENUM (
  'accepted',
  'unknown',
  'rejected'
);

ALTER TABLE "public"."whatsapp_deliveries"
  ADD COLUMN "send_outcome" public.whatsapp_send_outcome;

CREATE OR REPLACE FUNCTION public.append_web_message (
  p_school_id       uuid,
  p_conversation_id uuid,
  p_generation      timestamp with time zone,
  p_id              uuid,
  p_message_id      text,
  p_role            text,
  p_parts           jsonb,
  p_completion      public.message_completion,
  p_now             timestamp with time zone
)
  RETURNS uuid
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
DECLARE v_id uuid;
BEGIN
    IF p_role NOT IN ('user', 'assistant') THEN RAISE EXCEPTION 'invalid_role' USING ERRCODE = '22023'; END IF;
    PERFORM 1 FROM public.conversations
    WHERE id = p_conversation_id AND school_id = p_school_id
      AND generating_at = p_generation AND ended_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'generation_lost' USING ERRCODE = '22023'; END IF;
    -- Transaction now() is identical for both messages of an atomic Turn.
    -- Use statement-time insertion order rather than random UUID tie-breaking.
    INSERT INTO public.messages (id, conversation_id, message_id, role, parts, completion, created_at)
    VALUES (p_id, p_conversation_id, p_message_id, p_role, p_parts, p_completion, clock_timestamp())
    ON CONFLICT (conversation_id, message_id) DO NOTHING RETURNING id INTO v_id;
    IF v_id IS NOT NULL AND p_role = 'user' THEN
        UPDATE public.conversations SET expires_at = p_now + interval '30 days' WHERE id = p_conversation_id;
    END IF;
    RETURN v_id;
END;
$function$;

REVOKE ALL
  ON FUNCTION "public"."append_web_message"(uuid, uuid, timestamp WITH time zone, uuid, text, text, jsonb, public.message_completion, timestamp WITH time zone)
  FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.apply_whatsapp_status (
  p_wamid            text,
  p_status           text,
  p_status_at        timestamp with time zone DEFAULT NULL::timestamp WITH time zone,
  p_callback_id      uuid                     DEFAULT NULL::uuid,
  p_callback_attempt integer                  DEFAULT NULL::integer,
  p_phone_number_id  text                     DEFAULT NULL::text,
  p_permanent        boolean                  DEFAULT false,
  p_code             integer                  DEFAULT NULL::integer,
  p_error            text                     DEFAULT 'delivery_failed'::text,
  p_now              timestamp with time zone DEFAULT now()
)
  RETURNS SETOF public.whatsapp_deliveries
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
DECLARE d public.whatsapp_deliveries; v_at timestamptz; v_stale boolean; v_cause text;
BEGIN
    IF p_status NOT IN ('sent', 'delivered', 'read', 'failed') THEN RETURN; END IF;
    SELECT * INTO d FROM public.whatsapp_deliveries
        WHERE provider_id = p_wamid OR (id = p_callback_id AND attempts = p_callback_attempt
            AND p_callback_attempt BETWEEN 1 AND 5 AND phone_number_id = p_phone_number_id
            AND send_outcome = 'unknown' AND provider_id IS NULL)
        LIMIT 1 FOR UPDATE;
    IF NOT FOUND THEN RETURN; END IF;
    v_at := coalesce(p_status_at, d.status_at, d.sent_at, p_now);
    IF p_status_at IS NOT NULL AND d.status_at IS NOT NULL AND v_at <= d.status_at THEN RETURN; END IF;
    IF d.state = 'read' OR (d.state = 'delivered' AND p_status <> 'read') THEN RETURN; END IF;
    IF d.state = 'dead' AND (d.send_outcome IS DISTINCT FROM 'unknown' OR p_status = 'failed') THEN RETURN; END IF;
    IF p_status = 'failed' THEN
        IF d.state <> 'sent' AND d.send_outcome IS DISTINCT FROM 'unknown' THEN RETURN; END IF;
        v_stale := d.template_name = 'booking_confirmation' AND EXISTS (
            SELECT 1 FROM public.bookings WHERE id = d.booking_id AND school_id = d.school_id AND start_at <= p_now);
        v_cause := CASE WHEN v_stale THEN 'stale' WHEN p_permanent THEN 'permanent'
            WHEN d.attempts >= 5 THEN 'attempts_exhausted' ELSE NULL END;
        RETURN QUERY UPDATE public.whatsapp_deliveries SET
            state = CASE WHEN v_cause IS NULL THEN 'failed' ELSE 'dead' END::public.whatsapp_delivery_state,
            send_outcome = 'accepted', provider_id = p_wamid, status_at = v_at,
            next_attempt_at = CASE WHEN v_cause IS NULL THEN p_now + interval '10 seconds' * power(2, greatest(0, d.attempts - 1)) ELSE next_attempt_at END,
            last_error = left(p_error, 500), failure_code = p_code,
            failure_reason = CASE WHEN v_stale THEN 'booking_confirmation_stale' ELSE 'whatsapp_error' END,
            terminal_cause = v_cause, claimed_at = NULL, claimed_by = NULL WHERE id = d.id RETURNING *;
        RETURN;
    END IF;
    -- Only delivered/read may cancel the retry of a known failed attempt.
    -- A successor start clears provider_id, invalidating the old receipt.
    IF d.state IN ('pending', 'claimed', 'failed') AND d.send_outcome IS DISTINCT FROM 'unknown'
        AND p_status = 'sent' THEN RETURN; END IF;
    RETURN QUERY UPDATE public.whatsapp_deliveries SET state = p_status::public.whatsapp_delivery_state,
        send_outcome = 'accepted', provider_id = p_wamid, status_at = v_at, sent_at = coalesce(sent_at, v_at),
        last_error = NULL, failure_code = NULL, failure_reason = NULL, terminal_cause = NULL,
        claimed_at = NULL, claimed_by = NULL WHERE id = d.id RETURNING *;
END;
$function$;

REVOKE ALL
  ON FUNCTION "public"."apply_whatsapp_status"(text, text, timestamp WITH time zone, uuid, integer, text, boolean, integer, text, timestamp WITH time zone)
  FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.book_trial (
  p_school_id          uuid,
  p_offering_id        uuid,
  p_window_id          uuid,
  p_start_at           timestamp with time zone,
  p_idempotency_key    text,
  p_contact_name       text,
  p_phone              text,
  p_participant_name   text,
  p_participant_age    integer,
  p_email              text                     DEFAULT NULL::text,
  p_landing_token_hash text                     DEFAULT NULL::text,
  p_resume_token_hash  text                     DEFAULT NULL::text,
  p_conversation_id    uuid                     DEFAULT NULL::uuid,
  p_now                timestamp with time zone DEFAULT now(),
  p_preview_owner_id   uuid                     DEFAULT NULL::uuid
)
  RETURNS TABLE (
    booking    public.bookings,
    idempotent boolean
  )
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
DECLARE
    v_booking public.bookings;
    v_school public.schools;
    v_profile public.school_profiles;
    v_offering public.trial_offerings;
    v_window public.trial_windows;
    v_occurrence public.trial_occurrences;
    v_contact_id uuid;
    v_participant_id uuid;
    v_landing_id uuid;
    v_conversation_id uuid;
    v_notification_email text;
    v_local timestamp;
    v_email text := nullif(lower(btrim(p_email)), '');
    v_name text := btrim(p_participant_name);
    v_constraint text;
BEGIN
    -- Serialize retries even when they select different occurrences.
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
        'book-trial:' || p_school_id::text || ':' || p_idempotency_key, 0));
    SELECT * INTO v_booking FROM public.bookings
    WHERE school_id = p_school_id AND idempotency_key = p_idempotency_key;
    IF FOUND THEN RETURN QUERY SELECT v_booking, true; RETURN; END IF;
    SELECT * INTO v_school FROM public.schools WHERE id = p_school_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'school_not_public'; END IF;
    IF p_preview_owner_id IS NULL THEN
        IF v_school.approved_at IS NULL OR v_school.published_at IS NULL THEN
            RAISE EXCEPTION 'school_not_public';
        END IF;
    ELSIF NOT EXISTS (
        SELECT 1 FROM public.school_settings
        WHERE school_id = p_school_id AND owner_user_id = p_preview_owner_id
    ) THEN
        RAISE EXCEPTION 'school_not_public';
    END IF;
    SELECT * INTO v_profile FROM public.school_profiles WHERE school_id = p_school_id;
    SELECT * INTO v_offering FROM public.trial_offerings
    WHERE id = p_offering_id AND school_id = p_school_id AND active;
    IF NOT FOUND OR p_participant_age IS NULL OR p_participant_age NOT BETWEEN 0 AND 99
        OR p_participant_age < v_offering.minimum_age OR p_participant_age > v_offering.maximum_age THEN
        RAISE EXCEPTION 'ineligible';
    END IF;
    -- Owner capacity propagation locks the window before its occurrences too.
    SELECT * INTO v_window FROM public.trial_windows
    WHERE id = p_window_id AND school_id = p_school_id AND trial_offering_id = p_offering_id AND active
    FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'invalid_slot'; END IF;
    v_local := p_start_at AT TIME ZONE v_school.timezone;
    -- Change these lead/horizon limits together with MIN_LEAD_MINUTES and
    -- SLOT_HORIZON_DAYS in src/lib/schedule/constants.ts.
    -- At DST fall-back both UTC instants of a repeated wall-clock hour pass
    -- this check; listOpenSlots offers only date-fns-tz's chosen instant.
    -- Trusted SQL callers must use offered slots to avoid that duplicate hour.
    IF p_start_at IS NULL OR p_start_at < p_now + interval '120 minutes'
        OR p_start_at > p_now + interval '14 days'
        OR extract(dow FROM v_local) <> v_window.day_of_week
        OR v_local::time <> time '00:00' + v_window.start_minute * interval '1 minute' THEN
        RAISE EXCEPTION 'slot_unavailable';
    END IF;
    INSERT INTO public.trial_occurrences
        (school_id, trial_window_id, trial_offering_id, start_at, end_at, capacity)
    VALUES (p_school_id, p_window_id, p_offering_id, p_start_at,
        p_start_at + v_window.duration_minutes * interval '1 minute', v_window.capacity)
    ON CONFLICT (trial_window_id, start_at) DO NOTHING;
    SELECT * INTO STRICT v_occurrence FROM public.trial_occurrences
    WHERE school_id = p_school_id AND trial_window_id = p_window_id AND start_at = p_start_at FOR UPDATE;
    IF v_occurrence.booked_count >= v_occurrence.capacity THEN RAISE EXCEPTION 'slot_unavailable'; END IF;
    IF v_email IS NOT NULL THEN
        INSERT INTO public.contacts (school_id, email, name, phone)
        VALUES (p_school_id, v_email, btrim(p_contact_name), btrim(p_phone))
        ON CONFLICT (school_id, email) DO UPDATE SET name = excluded.name, phone = excluded.phone
        RETURNING id INTO v_contact_id;
    ELSE
        INSERT INTO public.contacts (school_id, email, name, phone)
        VALUES (p_school_id, NULL, btrim(p_contact_name), btrim(p_phone))
        ON CONFLICT (school_id, phone) DO UPDATE SET name = excluded.name, phone = excluded.phone
        RETURNING id INTO v_contact_id;
    END IF;
    INSERT INTO public.participants (school_id, contact_id, name, normalized_name)
    VALUES (p_school_id, v_contact_id, v_name, lower(regexp_replace(v_name, '\s+', ' ', 'g')))
    ON CONFLICT (contact_id, normalized_name) DO UPDATE SET name = excluded.name
    RETURNING id INTO v_participant_id;
    SELECT id INTO v_landing_id FROM public.landing_sessions
    WHERE school_id = p_school_id AND session_key_hash = p_landing_token_hash;
    UPDATE public.conversations SET contact_id = coalesce(contact_id, v_contact_id)
    WHERE school_id = p_school_id AND ended_at IS NULL AND expires_at > p_now
        AND ((p_conversation_id IS NOT NULL AND id = p_conversation_id)
            OR (p_conversation_id IS NULL AND resume_token_hash = p_resume_token_hash))
    RETURNING id INTO v_conversation_id;
    v_booking.id := gen_random_uuid();
    INSERT INTO public.bookings (
        id, school_id, contact_id, participant_id, trial_offering_id, trial_window_id,
        trial_occurrence_id, conversation_id, landing_session_id, idempotency_key,
        participant_name_snapshot, participant_age_snapshot, offering_name_snapshot,
        timezone_snapshot, start_at, end_at, location_snapshot, instructions_snapshot,
        contact_email_snapshot, contact_name_snapshot, contact_phone_snapshot, ics_uid, is_preview
    ) VALUES (
        v_booking.id, p_school_id, v_contact_id, v_participant_id, p_offering_id, p_window_id,
        v_occurrence.id, v_conversation_id, v_landing_id, p_idempotency_key,
        v_name, p_participant_age, v_offering.name, v_school.timezone, p_start_at, v_occurrence.end_at,
        nullif(concat_ws(', ', nullif(v_profile.address, ''), nullif(v_profile.city, ''), nullif(v_profile.country, '')), ''),
        nullif(concat_ws(E'\n', nullif(v_profile.access_notes, ''), nullif(v_profile.parking_notes, ''),
            nullif(coalesce(v_offering.attire, v_profile.trial_guidance), '')), ''),
        v_email, btrim(p_contact_name), btrim(p_phone), v_booking.id::text || '@fillthemat.com',
        p_preview_owner_id IS NOT NULL
    ) RETURNING * INTO v_booking;
    UPDATE public.trial_occurrences SET booked_count = booked_count + 1 WHERE id = v_occurrence.id;
    SELECT notification_email INTO STRICT v_notification_email FROM public.school_settings WHERE school_id = p_school_id;
    IF v_email IS NOT NULL THEN
        PERFORM public.enqueue_email_delivery(p_school_id, 'prospect_confirmation', v_email,
            'booking-confirmation/' || v_booking.id, v_booking.id, NULL, p_now);
    END IF;
    PERFORM public.enqueue_email_delivery(p_school_id, 'owner_booking', v_notification_email,
        'owner-booking/' || v_booking.id, v_booking.id, NULL, p_now);
    INSERT INTO public.funnel_events (school_id, booking_id, landing_session_id, conversation_id, event_type, metadata)
    VALUES (p_school_id, v_booking.id, v_landing_id, v_conversation_id, 'booking_confirmed',
        jsonb_build_object('source', CASE WHEN v_conversation_id IS NULL THEN 'direct' ELSE 'chat' END)
        || CASE WHEN p_preview_owner_id IS NULL THEN '{}'::jsonb ELSE '{"preview": true}'::jsonb END);
    RETURN QUERY SELECT v_booking, false;
EXCEPTION WHEN unique_violation THEN
    -- Roll back every effect, including contact changes and a new occurrence.
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    IF v_constraint = 'bookings_active_participant_occurrence' THEN RAISE EXCEPTION 'already_booked'; END IF;
    RAISE;
END;
$function$;

REVOKE ALL
  ON FUNCTION "public"."book_trial"(uuid, uuid, uuid, timestamp WITH time zone, text, text, text, text, integer, text, text, text, uuid, timestamp WITH time zone, uuid)
  FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.cancel_dashboard_booking (
  p_booking_id uuid
)
  RETURNS text
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
DECLARE v_booking public.bookings%ROWTYPE;
BEGIN
    SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
    IF NOT FOUND THEN RETURN 'not_found'; END IF;
    IF v_booking.status = 'cancelled' THEN RETURN 'replay'; END IF;
    IF v_booking.status <> 'booked' OR v_booking.start_at <= now() THEN RETURN 'not_cancellable'; END IF;
    UPDATE public.bookings SET status = 'cancelled' WHERE id = p_booking_id;
    RETURN 'cancelled';
END;
$function$;

REVOKE ALL ON FUNCTION "public"."cancel_dashboard_booking"(uuid) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.claim_email_deliveries (
  p_run_id text,
  p_limit  integer                  DEFAULT 25,
  p_now    timestamp with time zone DEFAULT now(),
  p_ids    uuid[]                   DEFAULT NULL::uuid[]
)
  RETURNS SETOF public.email_deliveries
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
DECLARE
    v_ids uuid[] := '{}';
    v_lane integer;
    v_capacity integer;
    v_fresh boolean;
BEGIN
    IF p_limit <= 0 THEN RETURN; END IF;
    FOR v_lane IN 1..4 LOOP
        v_fresh := v_lane IN (1, 3);
        v_capacity := CASE v_lane WHEN 1 THEN p_limit - p_limit / 5
            WHEN 2 THEN p_limit / 5 ELSE p_limit - cardinality(v_ids) END;
        v_ids := v_ids || ARRAY(
            SELECT id FROM public.email_deliveries
            WHERE state IN ('pending', 'failed') AND next_attempt_at <= p_now
                AND (attempts = 0) = v_fresh
                AND (p_ids IS NULL OR id = ANY(p_ids)) AND NOT (id = ANY(v_ids))
            ORDER BY created_at, id LIMIT v_capacity FOR UPDATE SKIP LOCKED
        );
    END LOOP;
    RETURN QUERY WITH claimed AS (
        UPDATE public.email_deliveries SET state = 'claimed', claimed_at = p_now, claimed_by = p_run_id
        WHERE id = ANY(v_ids) RETURNING *
    ) SELECT * FROM claimed ORDER BY (attempts > 0), created_at, id;
END;
$function$;

REVOKE ALL ON FUNCTION "public"."claim_email_deliveries"(text, integer, timestamp WITH time zone, uuid[]) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.claim_whatsapp_deliveries (
  p_run_id           text,
  p_limit            integer                  DEFAULT 25,
  p_now              timestamp with time zone DEFAULT now(),
  p_ids              uuid[]                   DEFAULT NULL::uuid[],
  p_retry_only       boolean                  DEFAULT false,
  p_phone_number_ids text[]                   DEFAULT NULL::text[]
)
  RETURNS SETOF public.whatsapp_deliveries
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
DECLARE v_ids uuid[] := '{}'; v_lane integer; v_capacity integer; v_fresh boolean;
BEGIN
    IF p_limit <= 0 THEN RETURN; END IF;
    FOR v_lane IN 1..4 LOOP
        v_fresh := v_lane IN (1, 3);
        IF p_retry_only AND v_fresh THEN CONTINUE; END IF;
        v_capacity := CASE WHEN p_retry_only THEN p_limit - cardinality(v_ids)
            WHEN v_lane = 1 THEN p_limit - p_limit / 5 WHEN v_lane = 2 THEN p_limit / 5
            ELSE p_limit - cardinality(v_ids) END;
        v_ids := v_ids || ARRAY(SELECT id FROM public.whatsapp_deliveries
            WHERE state IN ('pending', 'failed') AND next_attempt_at <= p_now
                AND (attempts = 0) = v_fresh AND NOT (id = ANY(v_ids))
                AND (p_ids IS NULL OR id = ANY(p_ids))
                AND (p_phone_number_ids IS NULL OR phone_number_id = ANY(p_phone_number_ids))
            ORDER BY created_at, id LIMIT v_capacity FOR UPDATE SKIP LOCKED);
    END LOOP;
    RETURN QUERY WITH claimed AS (
        UPDATE public.whatsapp_deliveries SET state = 'claimed', claimed_at = p_now, claimed_by = p_run_id
        WHERE id = ANY(v_ids) RETURNING *
    ) SELECT * FROM claimed ORDER BY (attempts > 0), created_at, id;
END;
$function$;

REVOKE ALL ON FUNCTION "public"."claim_whatsapp_deliveries"(text, integer, timestamp WITH time zone, uuid[], boolean, text[]) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.claim_whatsapp_jobs (
  p_run_id           text,
  p_limit            integer                  DEFAULT 10,
  p_now              timestamp with time zone DEFAULT now(),
  p_retry_only       boolean                  DEFAULT false,
  p_phone_number_ids text[]                   DEFAULT NULL::text[]
)
  RETURNS SETOF public.whatsapp_jobs
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
DECLARE v_ids uuid[] := '{}'; v_lane integer; v_capacity integer; v_fresh boolean;
BEGIN
    IF p_limit <= 0 THEN RETURN; END IF;
    FOR v_lane IN 1..4 LOOP
        v_fresh := v_lane IN (1, 3);
        IF p_retry_only AND v_fresh THEN CONTINUE; END IF;
        v_capacity := CASE WHEN p_retry_only THEN p_limit - cardinality(v_ids)
            WHEN v_lane = 1 THEN p_limit - p_limit / 5 WHEN v_lane = 2 THEN p_limit / 5
            ELSE p_limit - cardinality(v_ids) END;
        v_ids := v_ids || ARRAY(SELECT id FROM public.whatsapp_jobs
            WHERE state IN ('pending', 'failed') AND next_attempt_at <= p_now
                AND (attempts = 0) = v_fresh AND NOT (id = ANY(v_ids))
                AND (p_phone_number_ids IS NULL OR phone_number_id = ANY(p_phone_number_ids))
            ORDER BY created_at, id LIMIT v_capacity FOR UPDATE SKIP LOCKED);
    END LOOP;
    RETURN QUERY WITH claimed AS (
        UPDATE public.whatsapp_jobs SET state = 'claimed', claimed_at = p_now, claimed_by = p_run_id
        WHERE id = ANY(v_ids) RETURNING *
    ) SELECT * FROM claimed ORDER BY (attempts > 0), created_at, id;
END;
$function$;

REVOKE ALL ON FUNCTION "public"."claim_whatsapp_jobs"(text, integer, timestamp WITH time zone, boolean, text[]) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.commit_whatsapp_turn (
  p_school_id        uuid,
  p_conversation_id  uuid,
  p_generation       timestamp with time zone,
  p_wa_id            text,
  p_phone_number_id  text,
  p_wamid            text,
  p_inbound_id       uuid,
  p_inbound_text     text,
  p_reply_id         uuid,
  p_reply_message_id text,
  p_reply_text       text,
  p_reply_chunks     jsonb,
  p_effect           jsonb,
  p_now              timestamp with time zone
)
  RETURNS TABLE (
    already_committed boolean,
    reply_message_id  uuid,
    lead_id           uuid,
    delivery_ids      uuid[]
  )
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
DECLARE
    v_hash text := encode(sha256(convert_to('wa:' || p_wa_id, 'UTF8')), 'hex');
    v_kind text := p_effect->>'kind';
    v_intent_id uuid;
    v_lead public.leads;
    v_delivery uuid;
    v_deliveries uuid[] := '{}';
    v_chunk text;
    v_slot text;
    v_index integer := 0;
BEGIN
    PERFORM 1 FROM public.conversations c JOIN public.school_settings s ON s.school_id = c.school_id
        JOIN public.schools school ON school.id = c.school_id
    WHERE c.id = p_conversation_id AND c.school_id = p_school_id AND c.wa_id_hash = v_hash
        AND c.ended_at IS NULL AND c.generating_at = p_generation
        AND s.whatsapp_phone_number_id = p_phone_number_id
        AND school.approved_at IS NOT NULL AND school.published_at IS NOT NULL FOR UPDATE OF c;
    IF NOT FOUND THEN RAISE EXCEPTION 'generation_or_scope_lost' USING ERRCODE = '22023'; END IF;
    IF v_kind IS NULL OR v_kind NOT IN ('reply', 'booking_intent', 'lead_request') THEN
        RAISE EXCEPTION 'invalid_prepared_effect' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM public.messages m JOIN public.conversations c ON c.id = m.conversation_id
        WHERE c.school_id = p_school_id AND c.wa_id_hash = v_hash AND m.message_id = p_wamid) THEN
        already_committed := true;
        delivery_ids := '{}';
        RETURN NEXT;
        RETURN;
    END IF;
    already_committed := false;
    PERFORM public.append_web_message(p_school_id, p_conversation_id, p_generation,
        p_inbound_id, p_wamid, 'user', jsonb_build_array(jsonb_build_object('type', 'text', 'text', p_inbound_text)), 'complete', p_now);
    IF v_kind = 'booking_intent' THEN
        -- Slot IDs encode window UUID | start timestamp as base64url. Validate
        -- tenant/offering scope here; confirmation rechecks live availability.
        v_slot := convert_from(decode(translate(p_effect->>'slotId', '-_', '+/') ||
            repeat('=', (4 - length(p_effect->>'slotId') % 4) % 4), 'base64'), 'UTF8');
        PERFORM split_part(v_slot, '|', 2)::timestamptz;
        PERFORM 1 FROM public.trial_windows WHERE id = split_part(v_slot, '|', 1)::uuid
            AND school_id = p_school_id AND trial_offering_id = (p_effect->>'trialOfferingId')::uuid;
        IF NOT FOUND THEN RAISE EXCEPTION 'invalid_slot_scope' USING ERRCODE = '22023'; END IF;
        UPDATE public.whatsapp_booking_intents SET state = 'superseded'
        WHERE conversation_id = p_conversation_id AND state = 'pending';
        INSERT INTO public.whatsapp_booking_intents (school_id, conversation_id, offering_id, slot_id,
            participant_name, participant_age, expires_at)
        VALUES (p_school_id, p_conversation_id, (p_effect->>'trialOfferingId')::uuid, p_effect->>'slotId',
            p_effect->>'participantName', (p_effect->>'participantAge')::integer, p_now + interval '30 minutes')
        RETURNING id INTO v_intent_id;
    ELSIF v_kind = 'lead_request' THEN
        v_lead := public.create_lead(p_school_id, p_effect->>'contactName', p_wa_id, 'whatsapp',
            encode(sha256(convert_to('wa:whatsapp-landing:' || p_wa_id, 'UTF8')), 'hex'), NULL,
            p_effect->>'participantName', (p_effect->>'participantAge')::integer,
            (p_effect->>'trialOfferingId')::uuid, p_effect->>'statedNeed');
        UPDATE public.conversations SET contact_id = coalesce(contact_id, v_lead.contact_id) WHERE id = p_conversation_id;
    END IF;
    reply_message_id := public.append_web_message(p_school_id, p_conversation_id, p_generation,
        p_reply_id, p_reply_message_id, 'assistant',
        CASE WHEN p_reply_text = '' THEN '[]'::jsonb ELSE
            jsonb_build_array(jsonb_build_object('type', 'text', 'text', p_reply_text)) END, 'complete', p_now);
    IF v_kind = 'booking_intent' THEN
        v_delivery := public.enqueue_whatsapp_delivery(p_school_id, p_wa_id, p_phone_number_id,
            'wa-confirm/' || p_wamid,
            p_body => p_reply_text,
            p_buttons => jsonb_build_array(
                jsonb_build_object('id', 'confirm_booking:' || v_intent_id, 'title', 'Confirm booking'),
                jsonb_build_object('id', 'choose_another_time', 'title', 'Choose another time')),
            p_window_expires_at => p_now + interval '24 hours', p_now => p_now);
        IF v_delivery IS NOT NULL THEN v_deliveries := array_append(v_deliveries, v_delivery); END IF;
    ELSE
        IF jsonb_typeof(p_reply_chunks) IS DISTINCT FROM 'array'
            OR (jsonb_array_length(p_reply_chunks) = 0 AND p_reply_text <> '') THEN
            RAISE EXCEPTION 'reply_chunks_required' USING ERRCODE = '22023';
        END IF;
        FOR v_chunk IN SELECT jsonb_array_elements_text(p_reply_chunks) LOOP
            IF v_chunk IS NULL OR btrim(v_chunk) = '' THEN
                RAISE EXCEPTION 'invalid_reply_chunk' USING ERRCODE = '22023';
            END IF;
            v_delivery := public.enqueue_whatsapp_delivery(p_school_id, p_wa_id, p_phone_number_id,
                'wa-reply/' || p_wamid || '/' || v_index, p_body => v_chunk,
                p_window_expires_at => p_now + interval '24 hours', p_now => p_now);
            IF v_delivery IS NOT NULL THEN v_deliveries := array_append(v_deliveries, v_delivery); END IF;
            v_index := v_index + 1;
        END LOOP;
    END IF;
    lead_id := v_lead.id;
    delivery_ids := v_deliveries;
    RETURN NEXT;
END;
$function$;

REVOKE ALL
  ON FUNCTION "public"."commit_whatsapp_turn"(uuid, uuid, timestamp WITH time zone, text, text, text, uuid, text, uuid, text, text, jsonb, jsonb, timestamp WITH time zone)
  FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.confirm_whatsapp_booking (
  p_school_id        uuid,
  p_conversation_id  uuid,
  p_generation       timestamp with time zone,
  p_wa_id            text,
  p_phone_number_id  text,
  p_wamid            text,
  p_inbound_id       uuid,
  p_inbound_text     text,
  p_reply_id         uuid,
  p_reply_message_id text,
  p_intent_id        uuid                     DEFAULT NULL::uuid,
  p_profile_name     text                     DEFAULT NULL::text,
  p_now              timestamp with time zone DEFAULT now()
)
  RETURNS TABLE (
    already_committed boolean,
    outcome           text,
    booking_id        uuid,
    reply_message_id  uuid,
    reply_text        text,
    delivery_ids      uuid[]
  )
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
DECLARE
    v_hash text := encode(sha256(convert_to('wa:' || p_wa_id, 'UTF8')), 'hex');
    v_intent public.whatsapp_booking_intents;
    v_booking public.bookings;
    v_slot text;
    v_name text;
    v_school_name text;
    v_when text;
    v_delivery uuid;
BEGIN
    -- Same lock order as Turn supersession: conversation, then intent.
    PERFORM 1 FROM public.conversations c JOIN public.school_settings s ON s.school_id = c.school_id
        JOIN public.schools school ON school.id = c.school_id
    WHERE c.id = p_conversation_id AND c.school_id = p_school_id AND c.wa_id_hash = v_hash
        AND c.ended_at IS NULL AND c.generating_at = p_generation
        AND s.whatsapp_phone_number_id = p_phone_number_id
        AND school.approved_at IS NOT NULL AND school.published_at IS NOT NULL FOR UPDATE OF c;
    IF NOT FOUND THEN RAISE EXCEPTION 'generation_or_scope_lost' USING ERRCODE = '22023'; END IF;
    delivery_ids := '{}';
    IF EXISTS (SELECT 1 FROM public.messages m JOIN public.conversations c ON c.id = m.conversation_id
        WHERE c.school_id = p_school_id AND c.wa_id_hash = v_hash AND m.message_id = p_wamid) THEN
        already_committed := true;
        outcome := 'already_committed';
        RETURN NEXT;
        RETURN;
    END IF;
    already_committed := false;
    SELECT * INTO v_intent FROM public.whatsapp_booking_intents
    WHERE id = p_intent_id AND school_id = p_school_id AND conversation_id = p_conversation_id FOR UPDATE;
    outcome := 'expired';
    reply_text := 'That booking option has expired or was replaced. Please ask for available times again.';
    -- Clock timestamps in the append helper preserve user-before-assistant order.
    -- Extend the live generation's deadline before book_trial links the row.
    PERFORM public.append_web_message(p_school_id, p_conversation_id, p_generation,
        p_inbound_id, p_wamid, 'user', jsonb_build_array(jsonb_build_object('type', 'text', 'text', p_inbound_text)), 'complete', p_now);
    IF v_intent.id IS NOT NULL AND v_intent.state = 'pending' AND v_intent.expires_at > p_now THEN
        -- This boundary owns the six-per-24-hours booking cap. Serialize the
        -- quota across replacement conversations for the same recipient.
        PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
            'wa-booking-quota:' || p_school_id::text || ':' || v_hash, 0));
        IF (SELECT count(*) FROM public.bookings WHERE school_id = p_school_id
            AND contact_phone_snapshot = p_wa_id AND created_at >= p_now - interval '24 hours') >= 6 THEN
            outcome := 'rate_limited';
            reply_text := 'You''ve reached the daily booking limit for today. Please try again tomorrow.';
        ELSIF v_intent.participant_age IS NULL THEN
            outcome := 'incomplete';
            reply_text := 'I still need the participant''s age to complete the booking. Could you tell me their age in years?';
        ELSE
            v_slot := convert_from(decode(translate(v_intent.slot_id, '-_', '+/') ||
                repeat('=', (4 - length(v_intent.slot_id) % 4) % 4), 'base64'), 'UTF8');
            v_name := coalesce(nullif(btrim(coalesce(v_intent.participant_name, p_profile_name)), ''), 'Guest');
            BEGIN
                SELECT (b.booking).* INTO v_booking FROM public.book_trial(p_school_id, v_intent.offering_id,
                    split_part(v_slot, '|', 1)::uuid, split_part(v_slot, '|', 2)::timestamptz,
                    'wa-confirmation/' || p_wamid, v_name, p_wa_id, v_name, v_intent.participant_age,
                    p_conversation_id => p_conversation_id, p_now => p_now) b;
                outcome := 'booked';
            EXCEPTION WHEN raise_exception THEN
                -- Only expected Book Trial failures become notices. All other
                -- errors, including append/outbox failures, roll back everything.
                IF SQLERRM NOT IN ('invalid_slot', 'slot_unavailable', 'ineligible', 'already_booked') THEN RAISE; END IF;
                outcome := SQLERRM;
                reply_text := CASE SQLERRM
                    WHEN 'already_booked' THEN 'This participant is already booked into that slot.'
                    WHEN 'ineligible' THEN 'That participant doesn''t meet the offering''s age range.'
                    ELSE 'That time is no longer open — please pick another time.' END;
            END;
        END IF;
    ELSIF v_intent.state = 'pending' AND v_intent.expires_at <= p_now THEN
        UPDATE public.whatsapp_booking_intents SET state = 'expired' WHERE id = v_intent.id;
    END IF;
    IF outcome = 'booked' THEN
        booking_id := v_booking.id;
        UPDATE public.whatsapp_booking_intents SET state = 'confirmed' WHERE id = v_intent.id;
        SELECT name INTO STRICT v_school_name FROM public.school_profiles WHERE school_id = p_school_id;
        v_when := to_char(v_booking.start_at AT TIME ZONE v_booking.timezone_snapshot, 'FMDay FMMon FMDD "at" FMHH12:MI AM');
        reply_text := 'Booked! ' || v_booking.participant_name_snapshot || '''s trial for ' ||
            v_booking.offering_name_snapshot || ' is ' || v_when || '. ' || v_school_name || ' will see you there.';
        reply_message_id := public.append_web_message(p_school_id, p_conversation_id, p_generation,
            p_reply_id, p_reply_message_id, 'assistant', jsonb_build_array(jsonb_build_object('type', 'text', 'text', reply_text)), 'complete', p_now);
        v_delivery := public.enqueue_whatsapp_delivery(p_school_id, p_wa_id, p_phone_number_id,
            'booking-confirmation-template/' || v_booking.id, p_template_name => 'booking_confirmation',
            p_template_params => jsonb_build_array(v_school_name, v_booking.participant_name_snapshot,
                v_booking.offering_name_snapshot, v_when), p_booking_id => v_booking.id, p_now => p_now);
    ELSE
        -- Existing failure responses are notices, not assistant transcript rows.
        v_delivery := public.enqueue_whatsapp_delivery(p_school_id, p_wa_id, p_phone_number_id,
            'wa-notice/' || p_wa_id || '/' || p_wamid, p_body => reply_text,
            p_window_expires_at => p_now + interval '24 hours', p_now => p_now);
    END IF;
    IF v_delivery IS NOT NULL THEN delivery_ids := array_append(delivery_ids, v_delivery); END IF;
    RETURN NEXT;
END;
$function$;

REVOKE ALL
  ON FUNCTION "public"."confirm_whatsapp_booking"(uuid, uuid, timestamp WITH time zone, text, text, text, uuid, text, uuid, text, uuid, text, timestamp WITH time zone)
  FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.create_lead (
  p_school_id          uuid,
  p_contact_name       text,
  p_phone              text,
  p_channel            text,
  p_landing_token_hash text,
  p_email              text    DEFAULT NULL::text,
  p_participant_name   text    DEFAULT NULL::text,
  p_participant_age    integer DEFAULT NULL::integer,
  p_offering_id        uuid    DEFAULT NULL::uuid,
  p_stated_need        text    DEFAULT NULL::text
)
  RETURNS public.leads
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
DECLARE
    v_lead public.leads;
    v_contact_id uuid;
    v_landing_id uuid;
    v_notification_email text;
    v_email text := nullif(lower(btrim(p_email)), '');
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.schools WHERE id = p_school_id
        AND approved_at IS NOT NULL AND published_at IS NOT NULL) THEN
        RAISE EXCEPTION 'school_not_public';
    END IF;
    IF p_channel IS NULL OR p_channel NOT IN ('web', 'whatsapp') THEN
        RAISE EXCEPTION 'invalid_channel';
    END IF;
    IF p_landing_token_hash IS NULL OR p_landing_token_hash = '' THEN
        RAISE EXCEPTION 'session_required';
    END IF;
    IF v_email IS NOT NULL THEN
        INSERT INTO public.contacts (school_id, email, name, phone)
        VALUES (p_school_id, v_email, btrim(p_contact_name), btrim(p_phone))
        ON CONFLICT (school_id, email) DO UPDATE SET name = excluded.name, phone = excluded.phone
        RETURNING id INTO v_contact_id;
    ELSE
        INSERT INTO public.contacts (school_id, email, name, phone)
        VALUES (p_school_id, NULL, btrim(p_contact_name), btrim(p_phone))
        ON CONFLICT (school_id, phone) DO UPDATE SET name = excluded.name, phone = excluded.phone
        RETURNING id INTO v_contact_id;
    END IF;
    IF p_channel = 'whatsapp' THEN
        INSERT INTO public.landing_sessions (school_id, session_key_hash, utm_source)
        VALUES (p_school_id, p_landing_token_hash, 'whatsapp')
        ON CONFLICT (school_id, session_key_hash) DO UPDATE
        SET last_seen_at = now(), utm_source = 'whatsapp'
        RETURNING id INTO v_landing_id;
    ELSE
        SELECT id INTO v_landing_id FROM public.landing_sessions
        WHERE school_id = p_school_id AND session_key_hash = p_landing_token_hash;
        IF NOT FOUND THEN RAISE EXCEPTION 'session_required'; END IF;
    END IF;
    -- Composite foreign keys also reject offerings/sessions from another school.
    INSERT INTO public.leads (school_id, landing_session_id, contact_id,
        participant_name, participant_age, trial_offering_id, stated_need)
    VALUES (p_school_id, v_landing_id, v_contact_id, p_participant_name,
        p_participant_age, p_offering_id, p_stated_need)
    RETURNING * INTO v_lead;
    SELECT nullif(btrim(notification_email), '') INTO STRICT v_notification_email
    FROM public.school_settings WHERE school_id = p_school_id;
    IF v_notification_email IS NOT NULL THEN
        PERFORM public.enqueue_email_delivery(p_school_id, 'owner_lead', v_notification_email,
            'owner-lead/' || v_lead.id, NULL, v_lead.id);
    END IF;
    INSERT INTO public.funnel_events (school_id, landing_session_id, lead_id, event_type, metadata)
    VALUES (p_school_id, v_landing_id, v_lead.id, 'lead_captured',
        jsonb_build_object('hasOffering', p_offering_id IS NOT NULL) ||
        CASE WHEN p_channel = 'whatsapp' THEN jsonb_build_object('channel', 'whatsapp') ELSE '{}'::jsonb END);
    RETURN v_lead;
END;
$function$;

REVOKE ALL ON FUNCTION "public"."create_lead"(uuid, text, text, text, text, text, text, integer, uuid, text) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.create_onboarding_school (
  p_owner_user_id      uuid,
  p_owner_email        text,
  p_name               text,
  p_slug               text,
  p_timezone           text,
  p_city               text,
  p_notification_email text,
  p_self_approve       boolean DEFAULT false
)
  RETURNS text
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
DECLARE
    v_school_id uuid;
    v_constraint text;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = p_timezone) THEN
        RAISE EXCEPTION 'invalid_timezone' USING ERRCODE = '22023';
    END IF;

    -- No auth-to-public user trigger exists. The FK verifies the auth identity;
    -- the user row lock serializes concurrent onboarding for this owner.
    INSERT INTO public.users (id, email) VALUES (p_owner_user_id, p_owner_email)
    ON CONFLICT (id) DO NOTHING;
    PERFORM 1 FROM public.users WHERE id = p_owner_user_id FOR NO KEY UPDATE;
    IF EXISTS (SELECT 1 FROM public.school_settings WHERE owner_user_id = p_owner_user_id) THEN
        RETURN 'already_exists';
    END IF;

    INSERT INTO public.schools (slug, timezone, approved_at)
    VALUES (p_slug, p_timezone, CASE WHEN p_self_approve THEN now() ELSE NULL END)
    RETURNING id INTO v_school_id;
    INSERT INTO public.school_profiles (school_id, name, city)
    VALUES (v_school_id, p_name, nullif(p_city, ''));
    INSERT INTO public.school_settings (school_id, owner_user_id, notification_email)
    VALUES (v_school_id, p_owner_user_id, p_notification_email);
    RETURN 'created';
EXCEPTION WHEN unique_violation THEN
    -- The exception block rolls back every insert, including the new user row.
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    IF v_constraint = 'schools_slug_unique' THEN RETURN 'slug_taken'; END IF;
    RAISE;
END;
$function$;

REVOKE ALL ON FUNCTION "public"."create_onboarding_school"(uuid, text, text, text, text, text, text, boolean) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.create_settings_faq (
  p_school_id uuid,
  p_question  text,
  p_answer    text
)
  RETURNS SETOF public.faqs
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
BEGIN
    PERFORM 1 FROM public.school_settings
    WHERE school_id = p_school_id AND owner_user_id = (SELECT auth.uid()) FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'school_not_found' USING ERRCODE = '42501'; END IF;
    RETURN QUERY INSERT INTO public.faqs (school_id, question, answer, sort_order)
    VALUES (p_school_id, p_question, p_answer, (SELECT count(*)::integer FROM public.faqs WHERE school_id = p_school_id))
    RETURNING *;
END;
$function$;

REVOKE ALL ON FUNCTION "public"."create_settings_faq"(uuid, text, text) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.delete_school_after_account()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
BEGIN
    DELETE FROM public.schools WHERE id = OLD.school_id;
    RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION "public"."delete_school_after_account"() FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.delete_settings_window (
  p_window_id uuid
)
  RETURNS text
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
DECLARE v_school_id uuid;
BEGIN
    SELECT w.school_id INTO v_school_id FROM public.trial_windows w
    WHERE w.id = p_window_id AND w.school_id = (
        SELECT school_id FROM public.school_settings WHERE owner_user_id = (SELECT auth.uid())
    ) FOR UPDATE;
    IF NOT FOUND THEN RETURN 'not_found'; END IF;
    IF EXISTS (SELECT 1 FROM public.trial_occurrences WHERE trial_window_id = p_window_id AND school_id = v_school_id) THEN
        RETURN 'on_calendar';
    END IF;
    DELETE FROM public.trial_windows WHERE id = p_window_id;
    RETURN 'deleted';
END;
$function$;

REVOKE ALL ON FUNCTION "public"."delete_settings_window"(uuid) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.end_inactive_conversations (
  p_now timestamp with time zone
)
  RETURNS integer
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
DECLARE v_count integer;
BEGIN
    UPDATE public.conversations SET ended_at = p_now, end_reason = 'inactivity'
    WHERE ended_at IS NULL AND expires_at <= p_now
        AND (generating_at IS NULL OR generating_at < p_now - interval '10 minutes');
    GET DIAGNOSTICS v_count = ROW_COUNT;
    UPDATE public.whatsapp_booking_intents SET state = 'expired'
    WHERE state = 'pending' AND expires_at <= p_now;
    RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION "public"."end_inactive_conversations"(timestamp WITH time zone) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.end_web_conversation_at_limit (
  p_school_id       uuid,
  p_conversation_id uuid,
  p_generation      timestamp with time zone,
  p_now             timestamp with time zone
)
  RETURNS boolean
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
BEGIN
    PERFORM 1 FROM public.conversations WHERE id = p_conversation_id AND school_id = p_school_id
    AND generating_at = p_generation AND ended_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'generation_lost' USING ERRCODE = '22023'; END IF;
    IF (SELECT count(*) FROM public.messages WHERE conversation_id = p_conversation_id) < 30 THEN RETURN false; END IF;
    UPDATE public.conversations SET ended_at = p_now, end_reason = 'message_limit' WHERE id = p_conversation_id;
    RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION "public"."end_web_conversation_at_limit"(uuid, uuid, timestamp WITH time zone, timestamp WITH time zone) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.enforce_faq_limit()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
BEGIN
    PERFORM 1 FROM public.school_settings WHERE school_id = NEW.school_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'school_not_found' USING ERRCODE = '42501'; END IF;
    IF (SELECT count(*) FROM public.faqs WHERE school_id = NEW.school_id) >= 20 THEN
        RAISE EXCEPTION 'faq_limit_reached' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION "public"."enforce_faq_limit"() FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.enqueue_email_delivery (
  p_school_id  uuid,
  p_kind       public.email_kind,
  p_recipient  text,
  p_key        text,
  p_booking_id uuid                     DEFAULT NULL::uuid,
  p_lead_id    uuid                     DEFAULT NULL::uuid,
  p_now        timestamp with time zone DEFAULT now()
)
  RETURNS uuid
  LANGUAGE sql
  SET search_path TO ''
  AS $function$
    INSERT INTO public.email_deliveries
        (school_id, kind, recipient, provider_idempotency_key, booking_id, lead_id, next_attempt_at)
    VALUES (p_school_id, p_kind, p_recipient, p_key, p_booking_id, p_lead_id, p_now)
    ON CONFLICT (provider_idempotency_key) DO NOTHING RETURNING id;
$function$;

REVOKE ALL ON FUNCTION "public"."enqueue_email_delivery"(uuid, public.email_kind, text, text, uuid, uuid, timestamp WITH time zone) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.enqueue_email_reminders (
  p_now timestamp with time zone DEFAULT now()
)
  RETURNS integer
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
DECLARE v_count integer;
BEGIN
    INSERT INTO public.email_deliveries
        (school_id, booking_id, kind, recipient, provider_idempotency_key, next_attempt_at)
    SELECT school_id, id, 'booking_reminder', contact_email_snapshot, 'booking-reminder/' || id, p_now
    FROM public.bookings
    WHERE status = 'booked' AND contact_email_snapshot IS NOT NULL
        AND start_at > p_now AND start_at <= p_now + interval '24 hours'
        AND start_at - created_at >= interval '36 hours'
    ON CONFLICT (provider_idempotency_key) DO NOTHING;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION "public"."enqueue_email_reminders"(timestamp WITH time zone) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.enqueue_whatsapp_delivery (
  p_school_id         uuid,
  p_recipient         text,
  p_phone_number_id   text,
  p_key               text,
  p_template_name     text                     DEFAULT NULL::text,
  p_template_params   jsonb                    DEFAULT NULL::jsonb,
  p_body              text                     DEFAULT NULL::text,
  p_buttons           jsonb                    DEFAULT NULL::jsonb,
  p_window_expires_at timestamp with time zone DEFAULT NULL::timestamp WITH time zone,
  p_booking_id        uuid                     DEFAULT NULL::uuid,
  p_lead_id           uuid                     DEFAULT NULL::uuid,
  p_now               timestamp with time zone DEFAULT now()
)
  RETURNS uuid
  LANGUAGE sql
  SET search_path TO ''
  AS $function$
    INSERT INTO public.whatsapp_deliveries (school_id, recipient_wa_id, phone_number_id,
        provider_idempotency_key, template_name, template_params, body, interactive_buttons,
        window_expires_at, booking_id, lead_id, next_attempt_at)
    VALUES (p_school_id, p_recipient, p_phone_number_id, p_key, p_template_name, p_template_params,
        p_body, p_buttons, p_window_expires_at, p_booking_id, p_lead_id, p_now)
    ON CONFLICT (provider_idempotency_key) DO NOTHING RETURNING id;
$function$;

REVOKE ALL
  ON FUNCTION "public"."enqueue_whatsapp_delivery"(uuid, text, text, text, text, jsonb, text, jsonb, timestamp WITH time zone, uuid, uuid, timestamp WITH time zone)
  FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.expire_ended_conversation_intents()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
BEGIN
    UPDATE public.whatsapp_booking_intents SET state = 'expired'
    WHERE conversation_id = NEW.id AND state = 'pending';
    RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION "public"."expire_ended_conversation_intents"() FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.get_overview_metrics (
  p_school_id uuid,
  p_now       timestamp with time zone DEFAULT now()
)
  RETURNS TABLE (
    upcoming_bookings            integer,
    leads                        integer,
    eligible_bookings            integer,
    converted_sessions           integer,
    chat_assisted_booking_events integer,
    active_trial_classes         integer,
    active_class_times           integer,
    failed_emails                integer
  )
  LANGUAGE sql
  STABLE
  SET search_path TO ''
  AS $function$
    SELECT
        (
            SELECT count(*)::integer
            FROM public.bookings b
            WHERE b.school_id = s.id
              AND b.status = 'booked'
              AND NOT b.is_preview
              AND b.start_at >= p_now
        ),
        (
            SELECT count(*)::integer
            FROM public.leads l
            WHERE l.school_id = s.id
        ),
        (
            SELECT count(*)::integer
            FROM public.landing_sessions ls
            WHERE ls.school_id = s.id
              AND ls.qualified_at IS NOT NULL
        ),
        (
            SELECT count(*)::integer
            FROM public.landing_sessions ls
            WHERE ls.school_id = s.id
              AND ls.qualified_at IS NOT NULL
              AND EXISTS (
                  SELECT 1
                  FROM public.bookings b
                  WHERE b.school_id = s.id
                    AND b.landing_session_id = ls.id
              )
        ),
        (
            SELECT count(*)::integer
            FROM public.funnel_events fe
            WHERE fe.school_id = s.id
              AND fe.event_type = 'booking_confirmed'
              AND fe.metadata ->> 'source' = 'chat'
              AND fe.metadata ->> 'preview' IS NULL
        ),
        (
            SELECT count(*)::integer
            FROM public.trial_offerings o
            WHERE o.school_id = s.id
              AND o.active = true
        ),
        (
            SELECT count(*)::integer
            FROM public.trial_windows w
            WHERE w.school_id = s.id
              AND w.active = true
        ),
        (
            SELECT count(*)::integer
            FROM public.email_deliveries e
            WHERE e.school_id = s.id
              AND e.state = 'failed'
        )
    FROM public.schools s
    WHERE s.id = p_school_id
      AND s.id = (SELECT school_id FROM public.school_settings WHERE owner_user_id = (SELECT auth.uid()));
$function$;

REVOKE ALL ON FUNCTION "public"."get_overview_metrics"(uuid, timestamp WITH time zone) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.get_settings_windows (
  p_school_id uuid
)
  RETURNS TABLE (
    id                   uuid,
    trial_offering_id    uuid,
    offering_name        text,
    offering_active      boolean,
    day_of_week          integer,
    start_minute         integer,
    duration_minutes     integer,
    capacity             integer,
    label                text,
    active               boolean,
    on_calendar          boolean,
    has_upcoming_booking boolean,
    max_upcoming_booked  integer
  )
  LANGUAGE sql
  STABLE
  SET search_path TO ''
  AS $function$
    SELECT w.id, w.trial_offering_id, o.name, o.active, w.day_of_week, w.start_minute,
        w.duration_minutes, w.capacity, w.label, w.active,
        EXISTS (SELECT 1 FROM public.trial_occurrences t WHERE t.trial_window_id = w.id AND t.school_id = w.school_id),
        EXISTS (SELECT 1 FROM public.bookings b WHERE b.trial_window_id = w.id AND b.school_id = w.school_id AND b.status <> 'cancelled' AND b.start_at > now()),
        (SELECT coalesce(max(t.booked_count), 0) FROM public.trial_occurrences t WHERE t.trial_window_id = w.id AND t.school_id = w.school_id AND t.start_at > now())
    FROM public.trial_windows w
    JOIN public.trial_offerings o ON o.id = w.trial_offering_id AND o.school_id = w.school_id
    WHERE w.school_id = p_school_id
      AND w.school_id = (SELECT school_id FROM public.school_settings WHERE owner_user_id = (SELECT auth.uid()))
    ORDER BY w.day_of_week, w.start_minute;
$function$;

REVOKE ALL ON FUNCTION "public"."get_settings_windows"(uuid) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.prevent_published_school_identity_change()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
BEGIN
    IF OLD.published_at IS NOT NULL AND (
        NEW.slug IS DISTINCT FROM OLD.slug OR NEW.timezone IS DISTINCT FROM OLD.timezone
        OR NEW.published_at IS DISTINCT FROM OLD.published_at
    ) THEN
        RAISE EXCEPTION 'slug, timezone and publication timestamp are immutable after publish';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = NEW.timezone) THEN
        RAISE EXCEPTION 'invalid_timezone' USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION "public"."prevent_published_school_identity_change"() FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.record_landing_session (
  p_school_id            uuid,
  p_session_key_hash     text,
  p_is_preview           boolean,
  p_bot_exclusion_reason text    DEFAULT NULL::text,
  p_utm                  jsonb   DEFAULT '{}'::jsonb
)
  RETURNS boolean
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
DECLARE
    v_session public.landing_sessions;
    v_qualified boolean;
BEGIN
    SELECT NOT p_is_preview AND p_bot_exclusion_reason IS NULL
        AND approved_at IS NOT NULL AND published_at IS NOT NULL
    INTO v_qualified FROM public.schools WHERE id = p_school_id;

    INSERT INTO public.landing_sessions (
        school_id, session_key_hash, qualified_at, is_preview, bot_exclusion_reason,
        utm_source, utm_medium, utm_campaign, utm_content, utm_term
    ) VALUES (
        p_school_id, p_session_key_hash, CASE WHEN v_qualified THEN now() END,
        p_is_preview, p_bot_exclusion_reason,
        p_utm->>'utm_source', p_utm->>'utm_medium', p_utm->>'utm_campaign',
        p_utm->>'utm_content', p_utm->>'utm_term'
    ) ON CONFLICT (school_id, session_key_hash) DO NOTHING RETURNING * INTO v_session;

    IF FOUND THEN
        IF v_session.qualified_at IS NOT NULL THEN
            INSERT INTO public.funnel_events (school_id, landing_session_id, event_type, metadata)
            VALUES (p_school_id, v_session.id, 'session_qualified', '{"source":"landing"}');
        END IF;
    ELSE
        -- Repeat visits (including concurrent first visits) reuse the stored
        -- session. Only touch last_seen_at; previews/bots are never requalified.
        UPDATE public.landing_sessions SET last_seen_at = now()
        WHERE school_id = p_school_id AND session_key_hash = p_session_key_hash
        RETURNING * INTO v_session;
    END IF;
    RETURN v_session.qualified_at IS NOT NULL;
END;
$function$;

REVOKE ALL ON FUNCTION "public"."record_landing_session"(uuid, text, boolean, text, jsonb) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.record_owner_booking_transition()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
DECLARE v_notification_email text;
BEGIN
    IF current_user <> 'authenticated' OR NEW.status = OLD.status THEN RETURN NULL; END IF;
    IF NEW.status IN ('showed', 'no_show') THEN
        INSERT INTO public.funnel_events (school_id, booking_id, event_type)
        VALUES (NEW.school_id, NEW.id, NEW.status::text);
        RETURN NULL;
    END IF;
    UPDATE public.trial_occurrences SET booked_count = booked_count - 1
    WHERE id = NEW.trial_occurrence_id AND school_id = NEW.school_id AND booked_count > 0;
    SELECT notification_email INTO v_notification_email
    FROM public.school_settings WHERE school_id = NEW.school_id;
    IF NEW.contact_email_snapshot IS NOT NULL THEN
        INSERT INTO public.email_deliveries (school_id, booking_id, kind, recipient, provider_idempotency_key)
        VALUES (NEW.school_id, NEW.id, 'booking_cancellation', NEW.contact_email_snapshot,
                'booking-cancellation/' || NEW.id || '/' || NEW.ics_sequence);
    END IF;
    IF v_notification_email IS NOT NULL AND v_notification_email <> '' THEN
        INSERT INTO public.email_deliveries (school_id, booking_id, kind, recipient, provider_idempotency_key)
        VALUES (NEW.school_id, NEW.id, 'owner_cancellation', v_notification_email,
                'owner-cancellation/' || NEW.id || '/' || NEW.ics_sequence);
    END IF;
    INSERT INTO public.funnel_events (school_id, booking_id, landing_session_id, conversation_id, event_type, metadata)
    VALUES (NEW.school_id, NEW.id, NEW.landing_session_id, NEW.conversation_id,
            'booking_cancelled', jsonb_build_object('sequence', NEW.ics_sequence));
    RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION "public"."record_owner_booking_transition"() FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.recover_email_deliveries (
  p_stale_before timestamp with time zone,
  p_ids          uuid[]                   DEFAULT NULL::uuid[]
)
  RETURNS SETOF public.email_deliveries
  LANGUAGE sql
  SET search_path TO ''
  AS $function$
    WITH stale AS (
        SELECT id FROM public.email_deliveries
        WHERE state = 'claimed' AND claimed_at < p_stale_before
            AND (p_ids IS NULL OR id = ANY(p_ids))
        FOR UPDATE SKIP LOCKED
    )
    UPDATE public.email_deliveries d SET
        state = CASE WHEN attempts >= 5 THEN 'dead' ELSE 'pending' END::public.email_state,
        claimed_at = NULL, claimed_by = NULL,
        failure_reason = CASE WHEN attempts >= 5 THEN coalesce(failure_reason, 'worker_crashed') ELSE failure_reason END,
        last_error = CASE WHEN attempts >= 5 THEN coalesce(last_error, 'worker_crashed') ELSE last_error END,
        terminal_cause = CASE WHEN attempts >= 5 THEN 'attempts_exhausted' ELSE NULL END
    FROM stale WHERE d.id = stale.id RETURNING d.*;
$function$;

REVOKE ALL ON FUNCTION "public"."recover_email_deliveries"(timestamp WITH time zone, uuid[]) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.recover_whatsapp_deliveries (
  p_stale_before     timestamp with time zone,
  p_phone_number_ids text[]                   DEFAULT NULL::text[],
  p_now              timestamp with time zone DEFAULT now()
)
  RETURNS SETOF public.whatsapp_deliveries
  LANGUAGE sql
  SET search_path TO ''
  AS $function$
    WITH stale AS (SELECT d.id, (d.template_name = 'booking_confirmation' AND EXISTS (
            SELECT 1 FROM public.bookings b WHERE b.id = d.booking_id AND b.school_id = d.school_id AND b.start_at <= p_now)) AS expired
        FROM public.whatsapp_deliveries d
        WHERE d.state = 'claimed' AND d.claimed_at < p_stale_before
            AND (p_phone_number_ids IS NULL OR d.phone_number_id = ANY(p_phone_number_ids))
        FOR UPDATE OF d SKIP LOCKED)
    UPDATE public.whatsapp_deliveries d SET
        state = CASE WHEN stale.expired OR attempts >= 5 THEN 'dead' ELSE 'pending' END::public.whatsapp_delivery_state,
        claimed_at = NULL, claimed_by = NULL,
        failure_reason = CASE WHEN stale.expired THEN 'booking_confirmation_stale'
            WHEN attempts >= 5 THEN coalesce(failure_reason, 'worker_crashed') ELSE failure_reason END,
        last_error = CASE WHEN stale.expired OR attempts >= 5 THEN coalesce(last_error, 'worker_crashed') ELSE last_error END,
        terminal_cause = CASE WHEN stale.expired THEN 'stale' WHEN attempts >= 5 THEN 'attempts_exhausted' ELSE NULL END
    FROM stale WHERE d.id = stale.id RETURNING d.*;
$function$;

REVOKE ALL ON FUNCTION "public"."recover_whatsapp_deliveries"(timestamp WITH time zone, text[], timestamp WITH time zone) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.recover_whatsapp_jobs (
  p_stale_before     timestamp with time zone,
  p_phone_number_ids text[]                   DEFAULT NULL::text[]
)
  RETURNS SETOF public.whatsapp_jobs
  LANGUAGE sql
  SET search_path TO ''
  AS $function$
    WITH stale AS (SELECT id FROM public.whatsapp_jobs
        WHERE state = 'claimed' AND claimed_at < p_stale_before
            AND (p_phone_number_ids IS NULL OR phone_number_id = ANY(p_phone_number_ids))
        FOR UPDATE SKIP LOCKED)
    UPDATE public.whatsapp_jobs j SET
        state = CASE WHEN attempts >= 5 THEN 'dead' ELSE 'pending' END::public.whatsapp_job_state,
        claimed_at = NULL, claimed_by = NULL,
        failure_reason = CASE WHEN attempts >= 5 THEN coalesce(failure_reason, 'worker_crashed') ELSE failure_reason END,
        last_error = CASE WHEN attempts >= 5 THEN coalesce(last_error, 'worker_crashed') ELSE last_error END,
        terminal_cause = CASE WHEN attempts >= 5 THEN 'attempts_exhausted' ELSE NULL END
    FROM stale WHERE j.id = stale.id RETURNING j.*;
$function$;

REVOKE ALL ON FUNCTION "public"."recover_whatsapp_jobs"(timestamp WITH time zone, text[]) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.resolve_web_conversation (
  p_school_id  uuid,
  p_token_hash text,
  p_now        timestamp with time zone
)
  RETURNS uuid
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
DECLARE v_id uuid; v_expires_at timestamptz;
BEGIN
    -- Serialize first creation: there may not be a row to lock yet.
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_school_id::text || ':' || p_token_hash, 0));
    -- Coordinate with message saves/deadline extensions, which lock this row.
    SELECT id, expires_at INTO v_id, v_expires_at FROM public.conversations
    WHERE school_id = p_school_id AND resume_token_hash = p_token_hash AND ended_at IS NULL FOR UPDATE;
    IF FOUND THEN
        IF v_expires_at > p_now THEN RETURN v_id; END IF;
        UPDATE public.conversations SET ended_at = p_now, end_reason = 'inactivity' WHERE id = v_id;
    END IF;
    INSERT INTO public.conversations (school_id, resume_token_hash, expires_at)
    VALUES (p_school_id, p_token_hash, p_now + interval '30 days') RETURNING id INTO v_id;
    RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION "public"."resolve_web_conversation"(uuid, text, timestamp WITH time zone) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.resolve_whatsapp_conversation (
  p_school_id  uuid,
  p_wa_id_hash text,
  p_token_hash text,
  p_now        timestamp with time zone
)
  RETURNS uuid
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
DECLARE v_conversation public.conversations;
BEGIN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
        'whatsapp:' || p_school_id::text || ':' || p_wa_id_hash, 0));
    SELECT * INTO v_conversation FROM public.conversations
    WHERE school_id = p_school_id AND wa_id_hash = p_wa_id_hash AND ended_at IS NULL FOR UPDATE;
    IF FOUND THEN
        IF v_conversation.expires_at > p_now OR v_conversation.generating_at >= p_now - interval '10 minutes' THEN
            RETURN v_conversation.id;
        END IF;
        UPDATE public.conversations SET ended_at = p_now, end_reason = 'inactivity' WHERE id = v_conversation.id;
    END IF;
    INSERT INTO public.conversations (school_id, wa_id_hash, resume_token_hash, expires_at)
    VALUES (p_school_id, p_wa_id_hash, p_token_hash, p_now + interval '30 days') RETURNING id INTO v_conversation.id;
    RETURN v_conversation.id;
END;
$function$;

REVOKE ALL ON FUNCTION "public"."resolve_whatsapp_conversation"(uuid, text, text, timestamp WITH time zone) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.set_updated_at()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
BEGIN
    NEW.updated_at := statement_timestamp();
    RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION "public"."set_updated_at"() FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.start_email_delivery (
  p_id         uuid,
  p_claimed_by text,
  p_claimed_at timestamp with time zone,
  p_attempts   integer
)
  RETURNS SETOF public.email_deliveries
  LANGUAGE sql
  SET search_path TO ''
  AS $function$
    UPDATE public.email_deliveries SET attempts = attempts + 1
    WHERE id = p_id AND state = 'claimed' AND claimed_by = p_claimed_by
        AND claimed_at = p_claimed_at AND attempts = p_attempts AND attempts < 5
    RETURNING *;
$function$;

REVOKE ALL ON FUNCTION "public"."start_email_delivery"(uuid, text, timestamp WITH time zone, integer) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.start_whatsapp_delivery (
  p_id         uuid,
  p_claimed_by text,
  p_claimed_at timestamp with time zone,
  p_attempts   integer
)
  RETURNS SETOF public.whatsapp_deliveries
  LANGUAGE sql
  SET search_path TO ''
  AS $function$
    UPDATE public.whatsapp_deliveries SET attempts = attempts + 1,
        send_outcome = 'unknown', provider_id = NULL, status_at = NULL
    WHERE id = p_id AND state = 'claimed' AND claimed_by = p_claimed_by
        AND claimed_at = p_claimed_at AND attempts = p_attempts AND attempts < 5 RETURNING *;
$function$;

REVOKE ALL ON FUNCTION "public"."start_whatsapp_delivery"(uuid, text, timestamp WITH time zone, integer) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.start_whatsapp_job (
  p_id         uuid,
  p_claimed_by text,
  p_claimed_at timestamp with time zone,
  p_attempts   integer,
  p_school_id  uuid                     DEFAULT NULL::uuid
)
  RETURNS SETOF public.whatsapp_jobs
  LANGUAGE sql
  SET search_path TO ''
  AS $function$
    UPDATE public.whatsapp_jobs SET attempts = attempts + 1, school_id = coalesce(p_school_id, school_id)
    WHERE id = p_id AND state = 'claimed' AND claimed_by = p_claimed_by
        AND claimed_at = p_claimed_at AND attempts = p_attempts AND attempts < 5 RETURNING *;
$function$;

REVOKE ALL ON FUNCTION "public"."start_whatsapp_job"(uuid, text, timestamp WITH time zone, integer, uuid) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.sync_window_capacity()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
BEGIN
    PERFORM 1 FROM public.trial_occurrences
    WHERE trial_window_id = NEW.id AND school_id = NEW.school_id AND start_at > now()
    ORDER BY id FOR UPDATE;
    UPDATE public.trial_occurrences SET capacity = NEW.capacity
    WHERE trial_window_id = NEW.id AND school_id = NEW.school_id AND start_at > now();
    RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION "public"."sync_window_capacity"() FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.update_booking_attendance (
  p_booking_id uuid,
  p_status     text
)
  RETURNS boolean
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
BEGIN
    IF p_status NOT IN ('showed', 'no_show') OR p_status IS NULL THEN
        RAISE EXCEPTION 'invalid_attendance_status' USING ERRCODE = '22023';
    END IF;
    UPDATE public.bookings SET status = p_status::public.booking_status
    WHERE id = p_booking_id AND status IN ('booked', 'showed', 'no_show');
    RETURN FOUND;
END;
$function$;

REVOKE ALL ON FUNCTION "public"."update_booking_attendance"(uuid, text) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.update_school_agent (
  p_school_id          uuid,
  p_welcome_message    text,
  p_agent_instructions text
)
  RETURNS void
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
BEGIN
    UPDATE public.school_settings SET agent_instructions = nullif(p_agent_instructions, '')
    WHERE school_id = p_school_id AND owner_user_id = (SELECT auth.uid());
    IF NOT FOUND THEN RAISE EXCEPTION 'school_not_found' USING ERRCODE = '42501'; END IF;
    UPDATE public.school_profiles SET welcome_message = nullif(p_welcome_message, '') WHERE school_id = p_school_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'school_profile_missing'; END IF;
END;
$function$;

REVOKE ALL ON FUNCTION "public"."update_school_agent"(uuid, text, text) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.update_school_profile (
  p_school_id uuid,
  p_slug      text,
  p_timezone  text,
  p_profile   jsonb
)
  RETURNS void
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
BEGIN
    PERFORM 1 FROM public.school_settings
    WHERE school_id = p_school_id AND owner_user_id = (SELECT auth.uid()) FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'school_not_found' USING ERRCODE = '42501'; END IF;
    UPDATE public.schools SET slug = p_slug, timezone = p_timezone WHERE id = p_school_id;
    UPDATE public.school_settings SET notification_email = p_profile->>'notification_email'
    WHERE school_id = p_school_id;
    INSERT INTO public.school_profiles (
        school_id, name, phone, website, address, city, country,
        parking_notes, access_notes, trial_guidance
    ) VALUES (
        p_school_id, p_profile->>'name', p_profile->>'phone', p_profile->>'website',
        p_profile->>'address', p_profile->>'city', coalesce(p_profile->>'country', 'US'),
        p_profile->>'parking_notes', p_profile->>'access_notes', p_profile->>'trial_guidance'
    ) ON CONFLICT (school_id) DO UPDATE SET
        name = EXCLUDED.name, phone = EXCLUDED.phone, website = EXCLUDED.website,
        address = EXCLUDED.address, city = EXCLUDED.city, country = EXCLUDED.country,
        parking_notes = EXCLUDED.parking_notes, access_notes = EXCLUDED.access_notes,
        trial_guidance = EXCLUDED.trial_guidance;
END;
$function$;

REVOKE ALL ON FUNCTION "public"."update_school_profile"(uuid, text, text, jsonb) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.update_settings_window_capacity (
  p_window_id uuid,
  p_capacity  integer
)
  RETURNS TABLE (
    result     text,
    max_booked integer
  )
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
DECLARE v_school_id uuid; v_booked integer;
BEGIN
    IF p_capacity IS NULL OR p_capacity NOT BETWEEN 1 AND 50 THEN
        RAISE EXCEPTION 'invalid_capacity' USING ERRCODE = '22023';
    END IF;
    SELECT w.school_id INTO v_school_id FROM public.trial_windows w
    WHERE w.id = p_window_id AND w.school_id = (
        SELECT school_id FROM public.school_settings WHERE owner_user_id = (SELECT auth.uid())
    ) FOR UPDATE;
    IF NOT FOUND THEN RETURN QUERY SELECT 'not_found'::text, 0; RETURN; END IF;
    SELECT coalesce(max(booked_count), 0) INTO v_booked FROM public.trial_occurrences
    WHERE trial_window_id = p_window_id AND school_id = v_school_id AND start_at > now();
    IF v_booked > p_capacity THEN
        RETURN QUERY SELECT 'below_booked'::text, v_booked; RETURN;
    END IF;
    UPDATE public.trial_windows SET capacity = p_capacity WHERE id = p_window_id;
    RETURN QUERY SELECT 'updated'::text, v_booked;
END;
$function$;

REVOKE ALL ON FUNCTION "public"."update_settings_window_capacity"(uuid, integer) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.validate_owner_booking_transition()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
BEGIN
    IF current_user <> 'authenticated' OR NEW.status = OLD.status THEN RETURN NEW; END IF;
    IF NEW.status IN ('showed', 'no_show') AND OLD.status IN ('booked', 'showed', 'no_show') THEN
        RETURN NEW;
    END IF;
    IF NEW.status = 'cancelled' AND OLD.status = 'booked' AND OLD.start_at > now() THEN
        NEW.cancelled_at := now();
        NEW.ics_sequence := OLD.ics_sequence + 1;
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'invalid_booking_status_change' USING ERRCODE = '22023';
END;
$function$;

REVOKE ALL ON FUNCTION "public"."validate_owner_booking_transition"() FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.whatsapp_confirmation_hook()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
DECLARE v_email text;
BEGIN
    IF NEW.booking_id IS NULL OR NEW.template_name IS DISTINCT FROM 'booking_confirmation' THEN RETURN NEW; END IF;
    IF NEW.state = 'dead' AND OLD.state <> 'dead' AND NEW.terminal_cause <> 'stale'
        AND EXISTS (SELECT 1 FROM public.bookings WHERE id = NEW.booking_id AND school_id = NEW.school_id AND start_at > now()) THEN
        SELECT notification_email INTO v_email FROM public.school_settings WHERE school_id = NEW.school_id;
        v_email := nullif(btrim(v_email), '');
        IF v_email IS NOT NULL THEN
            PERFORM public.enqueue_email_delivery(NEW.school_id, 'owner_whatsapp_confirmation_failed', v_email,
                'owner-whatsapp-confirmation-failed/' || NEW.booking_id, NEW.booking_id);
        END IF;
    ELSIF NEW.state IN ('delivered', 'read') THEN
        DELETE FROM public.email_deliveries WHERE school_id = NEW.school_id AND booking_id = NEW.booking_id
            AND kind = 'owner_whatsapp_confirmation_failed' AND state IN ('pending', 'failed') AND attempts = 0;
    END IF;
    RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION "public"."whatsapp_confirmation_hook"() FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.whatsapp_job_death_hook()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
DECLARE v_school uuid; v_window timestamptz; v_recipient text;
BEGIN
    IF NEW.state <> 'dead' OR OLD.state = 'dead' OR NEW.terminal_cause IS DISTINCT FROM 'attempts_exhausted'
        OR NEW.kind <> 'inbound_message' THEN RETURN NEW; END IF;
    v_recipient := NEW.payload->>'waId';
    IF coalesce(v_recipient, '') = '' THEN RETURN NEW; END IF;
    SELECT max(created_at) + interval '24 hours' INTO v_window FROM public.whatsapp_jobs
        WHERE kind = 'inbound_message' AND phone_number_id = NEW.phone_number_id
            AND payload->>'waId' = v_recipient AND created_at <= now();
    IF v_window IS NULL OR v_window <= now() THEN RETURN NEW; END IF;
    SELECT school_id INTO v_school FROM public.school_settings
        WHERE whatsapp_phone_number_id = NEW.phone_number_id
            AND (NEW.school_id IS NULL OR school_id = NEW.school_id);
    IF v_school IS NOT NULL THEN
        PERFORM public.enqueue_whatsapp_delivery(v_school, v_recipient, NEW.phone_number_id,
            'job-fallback/' || NEW.id, p_body => 'Sorry, we''re having trouble replying right now. Please message us again in a bit.',
            p_window_expires_at => v_window);
    END IF;
    RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION "public"."whatsapp_job_death_hook"() FROM PUBLIC, "anon", "authenticated";

ALTER TABLE "public"."bookings"
  ADD CONSTRAINT "bookings_participant_age" CHECK (((participant_age_snapshot >= 0) AND (participant_age_snapshot <= 99)));

ALTER TABLE "public"."bookings"
  ADD CONSTRAINT "bookings_contact_fk" FOREIGN KEY (school_id, contact_id) REFERENCES public.contacts(school_id, id) ON DELETE RESTRICT;

ALTER TABLE "public"."conversations"
  ADD CONSTRAINT "conversations_contact_fk" FOREIGN KEY (school_id, contact_id) REFERENCES public.contacts(school_id, id) ON DELETE SET NULL (contact_id);

ALTER TABLE "public"."bookings"
  ADD CONSTRAINT "bookings_conversation_fk" FOREIGN KEY (school_id, conversation_id) REFERENCES public.conversations(school_id, id) ON DELETE SET NULL (conversation_id);

ALTER TABLE "public"."email_deliveries"
  ADD CONSTRAINT "email_deliveries_booking_fk" FOREIGN KEY (school_id, booking_id) REFERENCES public.bookings(school_id, id) ON DELETE CASCADE;

ALTER TABLE "public"."email_deliveries"
  ADD CONSTRAINT "email_deliveries_provider_key" UNIQUE (provider_idempotency_key);

ALTER TABLE "public"."bookings"
  ADD CONSTRAINT "bookings_landing_session_fk" FOREIGN KEY (school_id, landing_session_id) REFERENCES public.landing_sessions(school_id, id) ON DELETE SET NULL (landing_session_id);

ALTER TABLE "public"."conversations"
  ADD CONSTRAINT "conversations_landing_session_fk" FOREIGN KEY (school_id, landing_session_id) REFERENCES public.landing_sessions(school_id, id) ON DELETE
    SET NULL (landing_session_id);

ALTER TABLE "public"."leads"
  ADD CONSTRAINT "leads_contact_fk" FOREIGN KEY (school_id, contact_id) REFERENCES public.contacts(school_id, id) ON DELETE RESTRICT;

ALTER TABLE "public"."leads"
  ADD CONSTRAINT "leads_landing_session_fk" FOREIGN KEY (school_id, landing_session_id) REFERENCES public.landing_sessions(school_id, id) ON DELETE RESTRICT;

ALTER TABLE "public"."email_deliveries"
  ADD CONSTRAINT "email_deliveries_lead_fk" FOREIGN KEY (school_id, lead_id) REFERENCES public.leads(school_id, id) ON DELETE CASCADE;

ALTER TABLE "public"."messages"
  ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;

ALTER TABLE "public"."participants"
  ADD CONSTRAINT "participants_contact_fk" FOREIGN KEY (school_id, contact_id) REFERENCES public.contacts(school_id, id) ON DELETE CASCADE;

ALTER TABLE "public"."bookings"
  ADD CONSTRAINT "bookings_participant_fk" FOREIGN KEY (school_id, participant_id) REFERENCES public.participants(school_id, id) ON DELETE RESTRICT;

ALTER TABLE "public"."bookings"
  ADD CONSTRAINT "bookings_school_id_fk" FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;

ALTER TABLE "public"."contacts"
  ADD CONSTRAINT "contacts_school_id_fk" FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;

ALTER TABLE "public"."conversations"
  ADD CONSTRAINT "conversations_school_id_fk" FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;

ALTER TABLE "public"."email_deliveries"
  ADD CONSTRAINT "email_deliveries_school_id_fk" FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;

ALTER TABLE "public"."faqs"
  ADD CONSTRAINT "faqs_school_id_fk" FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;

ALTER TABLE "public"."funnel_events"
  ADD CONSTRAINT "funnel_events_school_id_fk" FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;

ALTER TABLE "public"."landing_sessions"
  ADD CONSTRAINT "landing_sessions_school_id_fk" FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;

ALTER TABLE "public"."leads"
  ADD CONSTRAINT "leads_school_id_fk" FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;

ALTER TABLE "public"."participants"
  ADD CONSTRAINT "participants_school_id_fk" FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;

ALTER TABLE "public"."school_profiles"
  ADD CONSTRAINT "school_profiles_school_id_fkey" FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;

ALTER TABLE "public"."school_settings"
  ADD CONSTRAINT "school_settings_school_id_fkey" FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;

ALTER TABLE "public"."trial_occurrences"
  ADD CONSTRAINT "trial_occurrences_school_id_fk" FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;

ALTER TABLE "public"."bookings"
  ADD CONSTRAINT "bookings_occurrence_fk" FOREIGN KEY (school_id, trial_occurrence_id) REFERENCES public.trial_occurrences(school_id, id) ON DELETE RESTRICT;

ALTER TABLE "public"."trial_offerings"
  ADD CONSTRAINT "trial_offerings_school_id_fk" FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;

ALTER TABLE "public"."bookings"
  ADD CONSTRAINT "bookings_offering_fk" FOREIGN KEY (school_id, trial_offering_id) REFERENCES public.trial_offerings(school_id, id) ON DELETE RESTRICT;

ALTER TABLE "public"."leads"
  ADD CONSTRAINT "leads_offering_fk" FOREIGN KEY (school_id, trial_offering_id) REFERENCES public.trial_offerings(school_id, id) ON DELETE SET NULL (trial_offering_id);

ALTER TABLE "public"."trial_occurrences"
  ADD CONSTRAINT "trial_occurrences_offering_fk" FOREIGN KEY (school_id, trial_offering_id) REFERENCES public.trial_offerings(school_id, id) ON DELETE RESTRICT;

ALTER TABLE "public"."trial_windows"
  ADD CONSTRAINT "trial_windows_offering_fk" FOREIGN KEY (school_id, trial_offering_id) REFERENCES public.trial_offerings(school_id, id) ON DELETE CASCADE;

ALTER TABLE "public"."trial_windows"
  ADD CONSTRAINT "trial_windows_school_id_fk" FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;

ALTER TABLE "public"."bookings"
  ADD CONSTRAINT "bookings_window_fk" FOREIGN KEY (school_id, trial_window_id) REFERENCES public.trial_windows(school_id, id) ON DELETE RESTRICT;

ALTER TABLE "public"."trial_occurrences"
  ADD CONSTRAINT "trial_occurrences_window_fk" FOREIGN KEY (school_id, trial_window_id) REFERENCES public.trial_windows(school_id, id) ON DELETE RESTRICT;

ALTER TABLE "public"."users"
  ADD CONSTRAINT "users_id_auth_users_fk" FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."school_settings"
  ADD CONSTRAINT "school_settings_owner_user_id_fkey" FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."whatsapp_booking_intents"
  ADD CONSTRAINT "whatsapp_booking_intents_conversation_fk" FOREIGN KEY (school_id, conversation_id) REFERENCES public.conversations(school_id, id) ON DELETE CASCADE;

ALTER TABLE "public"."whatsapp_booking_intents"
  ADD CONSTRAINT "whatsapp_booking_intents_offering_fk" FOREIGN KEY (school_id, offering_id) REFERENCES public.trial_offerings(school_id, id) ON DELETE CASCADE;

ALTER TABLE "public"."whatsapp_booking_intents"
  ADD CONSTRAINT "whatsapp_booking_intents_school_id_fk" FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;

ALTER TABLE "public"."whatsapp_deliveries"
  ADD CONSTRAINT "whatsapp_deliveries_booking_fk" FOREIGN KEY (school_id, booking_id) REFERENCES public.bookings(school_id, id) ON DELETE CASCADE;

ALTER TABLE "public"."whatsapp_deliveries"
  ADD CONSTRAINT "whatsapp_deliveries_lead_fk" FOREIGN KEY (school_id, lead_id) REFERENCES public.leads(school_id, id) ON DELETE CASCADE;

ALTER TABLE "public"."whatsapp_deliveries"
  ADD CONSTRAINT "whatsapp_deliveries_school_id_fk" FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;

ALTER TABLE "public"."whatsapp_jobs"
  ADD CONSTRAINT "whatsapp_jobs_school_id_fk" FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX bookings_active_participant_occurrence ON public.bookings USING btree (trial_occurrence_id, participant_id)
  WHERE (status <> 'cancelled'::public.booking_status);

CREATE INDEX bookings_email_quota_idx ON public.bookings USING btree (school_id, contact_email_snapshot, created_at);

CREATE INDEX bookings_phone_quota_idx ON public.bookings USING btree (school_id, contact_phone_snapshot, created_at);

CREATE UNIQUE INDEX conversations_resume_token_hash ON public.conversations USING btree (school_id, resume_token_hash)
  WHERE (ended_at IS NULL);

CREATE UNIQUE INDEX conversations_school_wa_id_hash ON public.conversations USING btree (school_id, wa_id_hash)
  WHERE ((wa_id_hash IS NOT NULL) AND (ended_at IS NULL));

CREATE INDEX email_deliveries_booking_id_idx ON public.email_deliveries USING btree (booking_id);

CREATE INDEX email_deliveries_due_idx ON public.email_deliveries USING btree (state, next_attempt_at);

CREATE INDEX email_deliveries_lead_id_idx ON public.email_deliveries USING btree (lead_id);

CREATE INDEX email_deliveries_provider_id_idx ON public.email_deliveries USING btree (provider_id);

CREATE INDEX email_deliveries_recipient_quota_idx ON public.email_deliveries USING btree (school_id, recipient, created_at);

CREATE INDEX funnel_events_school_created_idx ON public.funnel_events USING btree (school_id, created_at);

CREATE INDEX messages_transcript_order ON public.messages USING btree (conversation_id, created_at, id);

CREATE UNIQUE INDEX school_settings_whatsapp_phone_number_id_unique ON public.school_settings USING btree (whatsapp_phone_number_id)
  WHERE (whatsapp_phone_number_id IS NOT NULL);

CREATE UNIQUE INDEX whatsapp_booking_intents_active_pending ON public.whatsapp_booking_intents USING btree (conversation_id)
  WHERE (state = 'pending'::public.whatsapp_booking_intent_state);

CREATE INDEX whatsapp_deliveries_due_idx ON public.whatsapp_deliveries USING btree (state, next_attempt_at);

CREATE INDEX whatsapp_deliveries_provider_idx ON public.whatsapp_deliveries USING btree (provider_id)
  WHERE (provider_id IS NOT NULL);

CREATE INDEX whatsapp_deliveries_recipient_quota_idx ON public.whatsapp_deliveries USING btree (school_id, recipient_wa_id, created_at);

CREATE INDEX whatsapp_jobs_due_idx ON public.whatsapp_jobs USING btree (state, next_attempt_at);

CREATE INDEX whatsapp_jobs_recipient_idx ON public.whatsapp_jobs USING btree (phone_number_id, ((payload ->> 'waId'::text)), created_at);

CREATE TRIGGER bookings_owner_side_effects
  AFTER UPDATE OF status ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.record_owner_booking_transition();

CREATE TRIGGER bookings_owner_transition
  BEFORE UPDATE OF status ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_owner_booking_transition();

CREATE TRIGGER bookings_set_updated_at
  BEFORE UPDATE ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER contacts_set_updated_at
  BEFORE UPDATE ON public.contacts
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER conversations_expire_intents
  AFTER UPDATE ON public.conversations
  FOR EACH ROW
  WHEN (((old.ended_at IS NULL) AND (new.ended_at IS NOT NULL)))
  EXECUTE FUNCTION public.expire_ended_conversation_intents();

CREATE TRIGGER conversations_set_updated_at
  BEFORE UPDATE ON public.conversations
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER email_deliveries_set_updated_at
  BEFORE UPDATE ON public.email_deliveries
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER faqs_enforce_limit
  BEFORE INSERT ON public.faqs
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_faq_limit();

CREATE TRIGGER faqs_set_updated_at
  BEFORE UPDATE ON public.faqs
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER landing_sessions_set_updated_at
  BEFORE UPDATE ON public.landing_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER leads_set_updated_at
  BEFORE UPDATE ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER messages_set_updated_at
  BEFORE UPDATE ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER participants_set_updated_at
  BEFORE UPDATE ON public.participants
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER school_profiles_set_updated_at
  BEFORE UPDATE ON public.school_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER school_settings_delete_school
  AFTER DELETE ON public.school_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.delete_school_after_account();

CREATE TRIGGER school_settings_set_updated_at
  BEFORE UPDATE ON public.school_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER schools_identity_immutable
  BEFORE UPDATE ON public.schools
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_published_school_identity_change();

CREATE TRIGGER schools_set_updated_at
  BEFORE UPDATE ON public.schools
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trial_occurrences_set_updated_at
  BEFORE UPDATE ON public.trial_occurrences
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trial_offerings_set_updated_at
  BEFORE UPDATE ON public.trial_offerings
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trial_windows_set_updated_at
  BEFORE UPDATE ON public.trial_windows
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trial_windows_sync_capacity
  AFTER UPDATE OF capacity ON public.trial_windows
  FOR EACH ROW
  WHEN ((old.capacity IS DISTINCT FROM new.capacity))
  EXECUTE FUNCTION public.sync_window_capacity();

CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER whatsapp_booking_intents_set_updated_at
  BEFORE UPDATE ON public.whatsapp_booking_intents
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER whatsapp_confirmation
  AFTER UPDATE ON public.whatsapp_deliveries
  FOR EACH ROW
  EXECUTE FUNCTION public.whatsapp_confirmation_hook();

CREATE TRIGGER whatsapp_deliveries_set_updated_at
  BEFORE UPDATE ON public.whatsapp_deliveries
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER whatsapp_job_death
  AFTER UPDATE ON public.whatsapp_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.whatsapp_job_death_hook();

CREATE TRIGGER whatsapp_jobs_set_updated_at
  BEFORE UPDATE ON public.whatsapp_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE POLICY "bookings_select_own_school" ON "public"."bookings"
  FOR SELECT
  TO "authenticated"
  USING ((school_id = ( SELECT s.school_id
   FROM public.school_settings s
  WHERE (s.owner_user_id = auth.uid()))));

CREATE POLICY "bookings_update_own_school" ON "public"."bookings"
  FOR UPDATE
  TO "authenticated"
  USING ((school_id = ( SELECT school_settings.school_id
   FROM public.school_settings
  WHERE (school_settings.owner_user_id = ( SELECT auth.uid() AS uid)))))
  WITH CHECK ((school_id = ( SELECT school_settings.school_id
   FROM public.school_settings
  WHERE (school_settings.owner_user_id = ( SELECT auth.uid() AS uid)))));

CREATE POLICY "contacts_select_own_school" ON "public"."contacts"
  FOR SELECT
  TO "authenticated"
  USING ((school_id = ( SELECT s.school_id
   FROM public.school_settings s
  WHERE (s.owner_user_id = auth.uid()))));

CREATE POLICY "conversations_select_own_school" ON "public"."conversations"
  FOR SELECT
  TO "authenticated"
  USING ((school_id = ( SELECT s.school_id
   FROM public.school_settings s
  WHERE (s.owner_user_id = auth.uid()))));

CREATE POLICY "email_deliveries_owner_trigger_insert" ON "public"."email_deliveries"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (((pg_trigger_depth() > 0) AND (pg_my_temp_schema() = (0)::oid) AND (school_id = ( SELECT school_settings.school_id
   FROM public.school_settings
  WHERE (school_settings.owner_user_id = ( SELECT auth.uid() AS uid))))));

CREATE POLICY "email_deliveries_select_own_school" ON "public"."email_deliveries"
  FOR SELECT
  TO "authenticated"
  USING ((school_id = ( SELECT s.school_id
   FROM public.school_settings s
  WHERE (s.owner_user_id = auth.uid()))));

CREATE POLICY "faqs_owner_write" ON "public"."faqs"
  FOR ALL
  TO "authenticated"
  USING ((school_id = ( SELECT school_settings.school_id
   FROM public.school_settings
  WHERE (school_settings.owner_user_id = ( SELECT auth.uid() AS uid)))))
  WITH CHECK ((school_id = ( SELECT school_settings.school_id
   FROM public.school_settings
  WHERE (school_settings.owner_user_id = ( SELECT auth.uid() AS uid)))));

CREATE POLICY "faqs_public_read" ON "public"."faqs"
  FOR SELECT
  TO "anon", "authenticated"
  USING ((EXISTS ( SELECT 1
   FROM public.schools s
  WHERE ((s.id = faqs.school_id) AND (s.approved_at IS NOT NULL) AND (s.published_at IS NOT NULL)))));

CREATE POLICY "faqs_select_own_school" ON "public"."faqs"
  FOR SELECT
  TO "authenticated"
  USING ((school_id = ( SELECT s.school_id
   FROM public.school_settings s
  WHERE (s.owner_user_id = auth.uid()))));

CREATE POLICY "funnel_events_owner_trigger_insert" ON "public"."funnel_events"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (((pg_trigger_depth() > 0) AND (pg_my_temp_schema() = (0)::oid) AND (school_id = ( SELECT school_settings.school_id
   FROM public.school_settings
  WHERE (school_settings.owner_user_id = ( SELECT auth.uid() AS uid))))));

CREATE POLICY "funnel_events_select_own_school" ON "public"."funnel_events"
  FOR SELECT
  TO "authenticated"
  USING ((school_id = ( SELECT s.school_id
   FROM public.school_settings s
  WHERE (s.owner_user_id = auth.uid()))));

CREATE POLICY "landing_sessions_select_own_school" ON "public"."landing_sessions"
  FOR SELECT
  TO "authenticated"
  USING ((school_id = ( SELECT s.school_id
   FROM public.school_settings s
  WHERE (s.owner_user_id = auth.uid()))));

CREATE POLICY "leads_select_own_school" ON "public"."leads"
  FOR SELECT
  TO "authenticated"
  USING ((school_id = ( SELECT s.school_id
   FROM public.school_settings s
  WHERE (s.owner_user_id = auth.uid()))));

CREATE POLICY "messages_select_own_school" ON "public"."messages"
  FOR SELECT
  TO "authenticated"
  USING ((EXISTS ( SELECT 1
   FROM (public.conversations c
     JOIN public.school_settings s ON ((s.school_id = c.school_id)))
  WHERE ((c.id = messages.conversation_id) AND (s.owner_user_id = auth.uid())))));

CREATE POLICY "participants_select_own_school" ON "public"."participants"
  FOR SELECT
  TO "authenticated"
  USING ((school_id = ( SELECT s.school_id
   FROM public.school_settings s
  WHERE (s.owner_user_id = auth.uid()))));

CREATE POLICY "school_profiles_owner_access" ON "public"."school_profiles"
  FOR ALL
  TO "authenticated"
  USING ((school_id = ( SELECT school_settings.school_id
   FROM public.school_settings
  WHERE (school_settings.owner_user_id = ( SELECT auth.uid() AS uid)))))
  WITH CHECK ((school_id = ( SELECT school_settings.school_id
   FROM public.school_settings
  WHERE (school_settings.owner_user_id = ( SELECT auth.uid() AS uid)))));

CREATE POLICY "school_profiles_public_read" ON "public"."school_profiles"
  FOR SELECT
  TO "anon", "authenticated"
  USING ((EXISTS ( SELECT 1
   FROM public.schools s
  WHERE ((s.id = school_profiles.school_id) AND (s.approved_at IS NOT NULL) AND (s.published_at IS NOT NULL)))));

CREATE POLICY "school_settings_owner_access" ON "public"."school_settings"
  FOR ALL
  TO "authenticated"
  USING ((owner_user_id = ( SELECT auth.uid() AS uid)))
  WITH CHECK ((owner_user_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY "schools_select_own" ON "public"."schools"
  FOR SELECT
  TO "authenticated"
  USING ((id = ( SELECT school_settings.school_id
   FROM public.school_settings
  WHERE (school_settings.owner_user_id = ( SELECT auth.uid() AS uid)))));

CREATE POLICY "schools_select_public" ON "public"."schools"
  FOR SELECT
  TO "anon", "authenticated"
  USING (((approved_at IS NOT NULL) AND (published_at IS NOT NULL)));

CREATE POLICY "schools_update_own" ON "public"."schools"
  FOR UPDATE
  TO "authenticated"
  USING ((id = ( SELECT school_settings.school_id
   FROM public.school_settings
  WHERE (school_settings.owner_user_id = ( SELECT auth.uid() AS uid)))))
  WITH CHECK ((id = ( SELECT school_settings.school_id
   FROM public.school_settings
  WHERE (school_settings.owner_user_id = ( SELECT auth.uid() AS uid)))));

CREATE POLICY "trial_occurrences_owner_trigger_update" ON "public"."trial_occurrences"
  FOR UPDATE
  TO "authenticated"
  USING (((pg_trigger_depth() > 0) AND (pg_my_temp_schema() = (0)::oid) AND (school_id = ( SELECT school_settings.school_id
   FROM public.school_settings
  WHERE (school_settings.owner_user_id = ( SELECT auth.uid() AS uid))))))
  WITH CHECK (((pg_trigger_depth() > 0) AND (pg_my_temp_schema() = (0)::oid) AND (school_id = ( SELECT school_settings.school_id
   FROM public.school_settings
  WHERE (school_settings.owner_user_id = ( SELECT auth.uid() AS uid))))));

CREATE POLICY "trial_occurrences_public_read" ON "public"."trial_occurrences"
  FOR SELECT
  TO "anon", "authenticated"
  USING (((EXISTS ( SELECT 1
   FROM public.schools s
  WHERE ((s.id = trial_occurrences.school_id) AND (s.approved_at IS NOT NULL) AND (s.published_at IS NOT NULL)))) AND (EXISTS ( SELECT 1
   FROM public.trial_windows w
  WHERE ((w.id = trial_occurrences.trial_window_id) AND w.active)))));

CREATE POLICY "trial_occurrences_select_own_school" ON "public"."trial_occurrences"
  FOR SELECT
  TO "authenticated"
  USING ((school_id = ( SELECT s.school_id
   FROM public.school_settings s
  WHERE (s.owner_user_id = auth.uid()))));

CREATE POLICY "trial_offerings_owner_write" ON "public"."trial_offerings"
  FOR ALL
  TO "authenticated"
  USING ((school_id = ( SELECT school_settings.school_id
   FROM public.school_settings
  WHERE (school_settings.owner_user_id = ( SELECT auth.uid() AS uid)))))
  WITH CHECK ((school_id = ( SELECT school_settings.school_id
   FROM public.school_settings
  WHERE (school_settings.owner_user_id = ( SELECT auth.uid() AS uid)))));

CREATE POLICY "trial_offerings_public_read" ON "public"."trial_offerings"
  FOR SELECT
  TO "anon", "authenticated"
  USING ((active AND (EXISTS ( SELECT 1
   FROM public.schools s
  WHERE ((s.id = trial_offerings.school_id) AND (s.approved_at IS NOT NULL) AND (s.published_at IS NOT NULL))))));

CREATE POLICY "trial_offerings_select_own_school" ON "public"."trial_offerings"
  FOR SELECT
  TO "authenticated"
  USING ((school_id = ( SELECT s.school_id
   FROM public.school_settings s
  WHERE (s.owner_user_id = auth.uid()))));

CREATE POLICY "trial_windows_owner_write" ON "public"."trial_windows"
  FOR ALL
  TO "authenticated"
  USING ((school_id = ( SELECT school_settings.school_id
   FROM public.school_settings
  WHERE (school_settings.owner_user_id = ( SELECT auth.uid() AS uid)))))
  WITH CHECK ((school_id = ( SELECT school_settings.school_id
   FROM public.school_settings
  WHERE (school_settings.owner_user_id = ( SELECT auth.uid() AS uid)))));

CREATE POLICY "trial_windows_public_read" ON "public"."trial_windows"
  FOR SELECT
  TO "anon", "authenticated"
  USING ((active AND (EXISTS ( SELECT 1
   FROM public.schools s
  WHERE ((s.id = trial_windows.school_id) AND (s.approved_at IS NOT NULL) AND (s.published_at IS NOT NULL)))) AND (EXISTS ( SELECT 1
   FROM public.trial_offerings o
  WHERE ((o.id = trial_windows.trial_offering_id) AND o.active)))));

CREATE POLICY "trial_windows_select_own_school" ON "public"."trial_windows"
  FOR SELECT
  TO "authenticated"
  USING ((school_id = ( SELECT s.school_id
   FROM public.school_settings s
  WHERE (s.owner_user_id = auth.uid()))));

CREATE POLICY "users_select_own" ON "public"."users"
  FOR SELECT
  TO "authenticated"
  USING ((id = ( SELECT auth.uid() AS uid)));

CREATE POLICY "whatsapp_booking_intents_select_own_school" ON "public"."whatsapp_booking_intents"
  FOR SELECT
  TO "authenticated"
  USING ((school_id = ( SELECT s.school_id
   FROM public.school_settings s
  WHERE (s.owner_user_id = auth.uid()))));

CREATE POLICY "whatsapp_deliveries_select_own_school" ON "public"."whatsapp_deliveries"
  FOR SELECT
  TO "authenticated"
  USING ((school_id = ( SELECT s.school_id
   FROM public.school_settings s
  WHERE (s.owner_user_id = auth.uid()))));

CREATE POLICY "whatsapp_jobs_select_own_school" ON "public"."whatsapp_jobs"
  FOR SELECT
  TO "authenticated"
  USING ((school_id = ( SELECT s.school_id
   FROM public.school_settings s
  WHERE (s.owner_user_id = auth.uid()))));

REVOKE ALL
  ON FUNCTION "public"."append_web_message"(uuid, uuid, timestamp WITH time zone, uuid, text, text, jsonb, public.message_completion, timestamp WITH time zone)
  FROM "postgres";

GRANT EXECUTE
  ON FUNCTION "public"."append_web_message"(uuid, uuid, timestamp WITH time zone, uuid, text, text, jsonb, public.message_completion, timestamp WITH time zone)
  TO "postgres";

GRANT EXECUTE
  ON FUNCTION "public"."append_web_message"(uuid, uuid, timestamp WITH time zone, uuid, text, text, jsonb, public.message_completion, timestamp WITH time zone)
  TO "service_role";

REVOKE ALL ON FUNCTION "public"."apply_whatsapp_status"(text, text, timestamp WITH time zone, uuid, integer, text, boolean, integer, text, timestamp WITH time zone) FROM "postgres";

GRANT EXECUTE
  ON FUNCTION "public"."apply_whatsapp_status"(text, text, timestamp WITH time zone, uuid, integer, text, boolean, integer, text, timestamp WITH time zone)
  TO "postgres";

GRANT EXECUTE
  ON FUNCTION "public"."apply_whatsapp_status"(text, text, timestamp WITH time zone, uuid, integer, text, boolean, integer, text, timestamp WITH time zone)
  TO "service_role";

REVOKE ALL
  ON FUNCTION "public"."book_trial"(uuid, uuid, uuid, timestamp WITH time zone, text, text, text, text, integer, text, text, text, uuid, timestamp WITH time zone, uuid)
  FROM "postgres";

GRANT EXECUTE
  ON FUNCTION "public"."book_trial"(uuid, uuid, uuid, timestamp WITH time zone, text, text, text, text, integer, text, text, text, uuid, timestamp WITH time zone, uuid)
  TO "postgres";

GRANT EXECUTE
  ON FUNCTION "public"."book_trial"(uuid, uuid, uuid, timestamp WITH time zone, text, text, text, text, integer, text, text, text, uuid, timestamp WITH time zone, uuid)
  TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."cancel_dashboard_booking"(uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."cancel_dashboard_booking"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."cancel_dashboard_booking"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."cancel_dashboard_booking"(uuid) TO "service_role";

REVOKE ALL ON FUNCTION "public"."claim_email_deliveries"(text, integer, timestamp WITH time zone, uuid[]) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."claim_email_deliveries"(text, integer, timestamp WITH time zone, uuid[]) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."claim_email_deliveries"(text, integer, timestamp WITH time zone, uuid[]) TO "service_role";

REVOKE ALL ON FUNCTION "public"."claim_whatsapp_deliveries"(text, integer, timestamp WITH time zone, uuid[], boolean, text[]) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."claim_whatsapp_deliveries"(text, integer, timestamp WITH time zone, uuid[], boolean, text[]) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."claim_whatsapp_deliveries"(text, integer, timestamp WITH time zone, uuid[], boolean, text[]) TO "service_role";

REVOKE ALL ON FUNCTION "public"."claim_whatsapp_jobs"(text, integer, timestamp WITH time zone, boolean, text[]) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."claim_whatsapp_jobs"(text, integer, timestamp WITH time zone, boolean, text[]) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."claim_whatsapp_jobs"(text, integer, timestamp WITH time zone, boolean, text[]) TO "service_role";

REVOKE ALL
  ON FUNCTION "public"."commit_whatsapp_turn"(uuid, uuid, timestamp WITH time zone, text, text, text, uuid, text, uuid, text, text, jsonb, jsonb, timestamp WITH time zone)
  FROM "postgres";

GRANT EXECUTE
  ON FUNCTION "public"."commit_whatsapp_turn"(uuid, uuid, timestamp WITH time zone, text, text, text, uuid, text, uuid, text, text, jsonb, jsonb, timestamp WITH time zone)
  TO "postgres";

GRANT EXECUTE
  ON FUNCTION "public"."commit_whatsapp_turn"(uuid, uuid, timestamp WITH time zone, text, text, text, uuid, text, uuid, text, text, jsonb, jsonb, timestamp WITH time zone)
  TO "service_role";

REVOKE ALL
  ON FUNCTION "public"."confirm_whatsapp_booking"(uuid, uuid, timestamp WITH time zone, text, text, text, uuid, text, uuid, text, uuid, text, timestamp WITH time zone)
  FROM "postgres";

GRANT EXECUTE
  ON FUNCTION "public"."confirm_whatsapp_booking"(uuid, uuid, timestamp WITH time zone, text, text, text, uuid, text, uuid, text, uuid, text, timestamp WITH time zone)
  TO "postgres";

GRANT EXECUTE
  ON FUNCTION "public"."confirm_whatsapp_booking"(uuid, uuid, timestamp WITH time zone, text, text, text, uuid, text, uuid, text, uuid, text, timestamp WITH time zone)
  TO "service_role";

REVOKE ALL ON FUNCTION "public"."create_lead"(uuid, text, text, text, text, text, text, integer, uuid, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."create_lead"(uuid, text, text, text, text, text, text, integer, uuid, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."create_lead"(uuid, text, text, text, text, text, text, integer, uuid, text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."create_onboarding_school"(uuid, text, text, text, text, text, text, boolean) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."create_onboarding_school"(uuid, text, text, text, text, text, text, boolean) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."create_onboarding_school"(uuid, text, text, text, text, text, text, boolean) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."create_settings_faq"(uuid, text, text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."create_settings_faq"(uuid, text, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."create_settings_faq"(uuid, text, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."create_settings_faq"(uuid, text, text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."delete_school_after_account"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."delete_school_after_account"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."delete_school_after_account"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."delete_settings_window"(uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."delete_settings_window"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."delete_settings_window"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."delete_settings_window"(uuid) TO "service_role";

REVOKE ALL ON FUNCTION "public"."end_inactive_conversations"(timestamp WITH time zone) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."end_inactive_conversations"(timestamp WITH time zone) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."end_inactive_conversations"(timestamp WITH time zone) TO "service_role";

REVOKE ALL ON FUNCTION "public"."end_web_conversation_at_limit"(uuid, uuid, timestamp WITH time zone, timestamp WITH time zone) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."end_web_conversation_at_limit"(uuid, uuid, timestamp WITH time zone, timestamp WITH time zone) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."end_web_conversation_at_limit"(uuid, uuid, timestamp WITH time zone, timestamp WITH time zone) TO "service_role";

REVOKE ALL ON FUNCTION "public"."enforce_faq_limit"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."enforce_faq_limit"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."enforce_faq_limit"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."enqueue_email_delivery"(uuid, public.email_kind, text, text, uuid, uuid, timestamp WITH time zone) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."enqueue_email_delivery"(uuid, public.email_kind, text, text, uuid, uuid, timestamp WITH time zone) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."enqueue_email_delivery"(uuid, public.email_kind, text, text, uuid, uuid, timestamp WITH time zone) TO "service_role";

REVOKE ALL ON FUNCTION "public"."enqueue_email_reminders"(timestamp WITH time zone) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."enqueue_email_reminders"(timestamp WITH time zone) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."enqueue_email_reminders"(timestamp WITH time zone) TO "service_role";

REVOKE ALL
  ON FUNCTION "public"."enqueue_whatsapp_delivery"(uuid, text, text, text, text, jsonb, text, jsonb, timestamp WITH time zone, uuid, uuid, timestamp WITH time zone)
  FROM "postgres";

GRANT EXECUTE
  ON FUNCTION "public"."enqueue_whatsapp_delivery"(uuid, text, text, text, text, jsonb, text, jsonb, timestamp WITH time zone, uuid, uuid, timestamp WITH time zone)
  TO "postgres";

GRANT EXECUTE
  ON FUNCTION "public"."enqueue_whatsapp_delivery"(uuid, text, text, text, text, jsonb, text, jsonb, timestamp WITH time zone, uuid, uuid, timestamp WITH time zone)
  TO "service_role";

REVOKE ALL ON FUNCTION "public"."expire_ended_conversation_intents"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."expire_ended_conversation_intents"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."expire_ended_conversation_intents"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."get_overview_metrics"(uuid, timestamp WITH time zone) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."get_overview_metrics"(uuid, timestamp WITH time zone) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."get_overview_metrics"(uuid, timestamp WITH time zone) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."get_overview_metrics"(uuid, timestamp WITH time zone) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."get_settings_windows"(uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."get_settings_windows"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."get_settings_windows"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."get_settings_windows"(uuid) TO "service_role";

REVOKE ALL ON FUNCTION "public"."prevent_published_school_identity_change"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."prevent_published_school_identity_change"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."prevent_published_school_identity_change"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."record_landing_session"(uuid, text, boolean, text, jsonb) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."record_landing_session"(uuid, text, boolean, text, jsonb) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."record_landing_session"(uuid, text, boolean, text, jsonb) TO "service_role";

REVOKE ALL ON FUNCTION "public"."record_owner_booking_transition"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."record_owner_booking_transition"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."record_owner_booking_transition"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."recover_email_deliveries"(timestamp WITH time zone, uuid[]) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."recover_email_deliveries"(timestamp WITH time zone, uuid[]) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."recover_email_deliveries"(timestamp WITH time zone, uuid[]) TO "service_role";

REVOKE ALL ON FUNCTION "public"."recover_whatsapp_deliveries"(timestamp WITH time zone, text[], timestamp WITH time zone) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."recover_whatsapp_deliveries"(timestamp WITH time zone, text[], timestamp WITH time zone) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."recover_whatsapp_deliveries"(timestamp WITH time zone, text[], timestamp WITH time zone) TO "service_role";

REVOKE ALL ON FUNCTION "public"."recover_whatsapp_jobs"(timestamp WITH time zone, text[]) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."recover_whatsapp_jobs"(timestamp WITH time zone, text[]) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."recover_whatsapp_jobs"(timestamp WITH time zone, text[]) TO "service_role";

REVOKE ALL ON FUNCTION "public"."resolve_web_conversation"(uuid, text, timestamp WITH time zone) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."resolve_web_conversation"(uuid, text, timestamp WITH time zone) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."resolve_web_conversation"(uuid, text, timestamp WITH time zone) TO "service_role";

REVOKE ALL ON FUNCTION "public"."resolve_whatsapp_conversation"(uuid, text, text, timestamp WITH time zone) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."resolve_whatsapp_conversation"(uuid, text, text, timestamp WITH time zone) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."resolve_whatsapp_conversation"(uuid, text, text, timestamp WITH time zone) TO "service_role";

REVOKE ALL ON FUNCTION "public"."set_updated_at"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_updated_at"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_updated_at"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."start_email_delivery"(uuid, text, timestamp WITH time zone, integer) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."start_email_delivery"(uuid, text, timestamp WITH time zone, integer) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."start_email_delivery"(uuid, text, timestamp WITH time zone, integer) TO "service_role";

REVOKE ALL ON FUNCTION "public"."start_whatsapp_delivery"(uuid, text, timestamp WITH time zone, integer) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."start_whatsapp_delivery"(uuid, text, timestamp WITH time zone, integer) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."start_whatsapp_delivery"(uuid, text, timestamp WITH time zone, integer) TO "service_role";

REVOKE ALL ON FUNCTION "public"."start_whatsapp_job"(uuid, text, timestamp WITH time zone, integer, uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."start_whatsapp_job"(uuid, text, timestamp WITH time zone, integer, uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."start_whatsapp_job"(uuid, text, timestamp WITH time zone, integer, uuid) TO "service_role";

REVOKE ALL ON FUNCTION "public"."sync_window_capacity"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."sync_window_capacity"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."sync_window_capacity"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."update_booking_attendance"(uuid, text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."update_booking_attendance"(uuid, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."update_booking_attendance"(uuid, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."update_booking_attendance"(uuid, text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."update_school_agent"(uuid, text, text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."update_school_agent"(uuid, text, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."update_school_agent"(uuid, text, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."update_school_agent"(uuid, text, text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."update_school_profile"(uuid, text, text, jsonb) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."update_school_profile"(uuid, text, text, jsonb) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."update_school_profile"(uuid, text, text, jsonb) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."update_school_profile"(uuid, text, text, jsonb) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."update_settings_window_capacity"(uuid, integer) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."update_settings_window_capacity"(uuid, integer) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."update_settings_window_capacity"(uuid, integer) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."update_settings_window_capacity"(uuid, integer) TO "service_role";

REVOKE ALL ON FUNCTION "public"."validate_owner_booking_transition"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."validate_owner_booking_transition"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."validate_owner_booking_transition"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."whatsapp_confirmation_hook"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."whatsapp_confirmation_hook"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."whatsapp_confirmation_hook"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."whatsapp_job_death_hook"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."whatsapp_job_death_hook"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."whatsapp_job_death_hook"() TO "service_role";

REVOKE ALL ON TABLE "public"."bookings" FROM "authenticated";

REVOKE ALL ("status") ON TABLE "public"."bookings" FROM "authenticated";

GRANT UPDATE ("status") ON TABLE "public"."bookings" TO "authenticated";

GRANT SELECT ON TABLE "public"."bookings" TO "authenticated";

REVOKE ALL ON TABLE "public"."bookings" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."bookings" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."bookings" TO "service_role";

REVOKE ALL ON TABLE "public"."contacts" FROM "authenticated";

GRANT SELECT ON TABLE "public"."contacts" TO "authenticated";

REVOKE ALL ON TABLE "public"."contacts" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."contacts" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."contacts" TO "service_role";

REVOKE ALL ON TABLE "public"."conversations" FROM "authenticated";

GRANT SELECT ON TABLE "public"."conversations" TO "authenticated";

REVOKE ALL ON TABLE "public"."conversations" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."conversations" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."conversations" TO "service_role";

REVOKE ALL ON TABLE "public"."cron_runs" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."cron_runs" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."cron_runs" TO "service_role";

REVOKE ALL ON TABLE "public"."email_deliveries" FROM "authenticated";

REVOKE ALL ("booking_id") ON TABLE "public"."email_deliveries" FROM "authenticated";

GRANT INSERT ("booking_id") ON TABLE "public"."email_deliveries" TO "authenticated";

REVOKE ALL ("kind") ON TABLE "public"."email_deliveries" FROM "authenticated";

GRANT INSERT ("kind") ON TABLE "public"."email_deliveries" TO "authenticated";

REVOKE ALL ("provider_idempotency_key") ON TABLE "public"."email_deliveries" FROM "authenticated";

GRANT INSERT ("provider_idempotency_key") ON TABLE "public"."email_deliveries" TO "authenticated";

REVOKE ALL ("recipient") ON TABLE "public"."email_deliveries" FROM "authenticated";

GRANT INSERT ("recipient") ON TABLE "public"."email_deliveries" TO "authenticated";

REVOKE ALL ("school_id") ON TABLE "public"."email_deliveries" FROM "authenticated";

GRANT INSERT ("school_id") ON TABLE "public"."email_deliveries" TO "authenticated";

GRANT SELECT ON TABLE "public"."email_deliveries" TO "authenticated";

REVOKE ALL ON TABLE "public"."email_deliveries" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."email_deliveries" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."email_deliveries" TO "service_role";

REVOKE ALL ON TABLE "public"."faqs" FROM "anon";

GRANT SELECT ON TABLE "public"."faqs" TO "anon";

REVOKE ALL ON TABLE "public"."faqs" FROM "authenticated";

GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE "public"."faqs" TO "authenticated";

REVOKE ALL ON TABLE "public"."faqs" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."faqs" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."faqs" TO "service_role";

REVOKE ALL ON TABLE "public"."funnel_events" FROM "authenticated";

REVOKE ALL ("booking_id") ON TABLE "public"."funnel_events" FROM "authenticated";

GRANT INSERT ("booking_id") ON TABLE "public"."funnel_events" TO "authenticated";

REVOKE ALL ("conversation_id") ON TABLE "public"."funnel_events" FROM "authenticated";

GRANT INSERT ("conversation_id") ON TABLE "public"."funnel_events" TO "authenticated";

REVOKE ALL ("event_type") ON TABLE "public"."funnel_events" FROM "authenticated";

GRANT INSERT ("event_type") ON TABLE "public"."funnel_events" TO "authenticated";

REVOKE ALL ("landing_session_id") ON TABLE "public"."funnel_events" FROM "authenticated";

GRANT INSERT ("landing_session_id") ON TABLE "public"."funnel_events" TO "authenticated";

REVOKE ALL ("metadata") ON TABLE "public"."funnel_events" FROM "authenticated";

GRANT INSERT ("metadata") ON TABLE "public"."funnel_events" TO "authenticated";

REVOKE ALL ("school_id") ON TABLE "public"."funnel_events" FROM "authenticated";

GRANT INSERT ("school_id") ON TABLE "public"."funnel_events" TO "authenticated";

GRANT SELECT ON TABLE "public"."funnel_events" TO "authenticated";

REVOKE ALL ON TABLE "public"."funnel_events" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."funnel_events" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."funnel_events" TO "service_role";

REVOKE ALL ON TABLE "public"."landing_sessions" FROM "authenticated";

GRANT SELECT ON TABLE "public"."landing_sessions" TO "authenticated";

REVOKE ALL ON TABLE "public"."landing_sessions" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."landing_sessions" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."landing_sessions" TO "service_role";

REVOKE ALL ON TABLE "public"."leads" FROM "authenticated";

GRANT SELECT ON TABLE "public"."leads" TO "authenticated";

REVOKE ALL ON TABLE "public"."leads" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."leads" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."leads" TO "service_role";

REVOKE ALL ON TABLE "public"."messages" FROM "authenticated";

GRANT SELECT ON TABLE "public"."messages" TO "authenticated";

REVOKE ALL ON TABLE "public"."messages" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."messages" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."messages" TO "service_role";

REVOKE ALL ON TABLE "public"."participants" FROM "authenticated";

GRANT SELECT ON TABLE "public"."participants" TO "authenticated";

REVOKE ALL ON TABLE "public"."participants" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."participants" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."participants" TO "service_role";

REVOKE ALL ON TABLE "public"."school_profiles" FROM "anon";

GRANT SELECT ON TABLE "public"."school_profiles" TO "anon";

REVOKE ALL ON TABLE "public"."school_profiles" FROM "authenticated";

GRANT INSERT, SELECT, UPDATE ON TABLE "public"."school_profiles" TO "authenticated";

REVOKE ALL ON TABLE "public"."school_profiles" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."school_profiles" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."school_profiles" TO "service_role";

REVOKE ALL ON TABLE "public"."school_settings" FROM "authenticated";

REVOKE ALL ("agent_instructions") ON TABLE "public"."school_settings" FROM "authenticated";

GRANT UPDATE ("agent_instructions") ON TABLE "public"."school_settings" TO "authenticated";

REVOKE ALL ("notification_email") ON TABLE "public"."school_settings" FROM "authenticated";

GRANT UPDATE ("notification_email") ON TABLE "public"."school_settings" TO "authenticated";

REVOKE ALL ("previewed_at") ON TABLE "public"."school_settings" FROM "authenticated";

GRANT UPDATE ("previewed_at") ON TABLE "public"."school_settings" TO "authenticated";

REVOKE ALL ("updated_at") ON TABLE "public"."school_settings" FROM "authenticated";

GRANT UPDATE ("updated_at") ON TABLE "public"."school_settings" TO "authenticated";

GRANT SELECT ON TABLE "public"."school_settings" TO "authenticated";

REVOKE ALL ON TABLE "public"."school_settings" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."school_settings" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."school_settings" TO "service_role";

REVOKE ALL ON TABLE "public"."schools" FROM "anon";

GRANT SELECT ON TABLE "public"."schools" TO "anon";

REVOKE ALL ON TABLE "public"."schools" FROM "authenticated";

REVOKE ALL ("published_at") ON TABLE "public"."schools" FROM "authenticated";

GRANT UPDATE ("published_at") ON TABLE "public"."schools" TO "authenticated";

REVOKE ALL ("slug") ON TABLE "public"."schools" FROM "authenticated";

GRANT UPDATE ("slug") ON TABLE "public"."schools" TO "authenticated";

REVOKE ALL ("timezone") ON TABLE "public"."schools" FROM "authenticated";

GRANT UPDATE ("timezone") ON TABLE "public"."schools" TO "authenticated";

GRANT SELECT ON TABLE "public"."schools" TO "authenticated";

REVOKE ALL ON TABLE "public"."schools" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."schools" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."schools" TO "service_role";

REVOKE ALL ON TABLE "public"."trial_occurrences" FROM "anon";

GRANT SELECT ON TABLE "public"."trial_occurrences" TO "anon";

REVOKE ALL ON TABLE "public"."trial_occurrences" FROM "authenticated";

REVOKE ALL ("booked_count") ON TABLE "public"."trial_occurrences" FROM "authenticated";

GRANT UPDATE ("booked_count") ON TABLE "public"."trial_occurrences" TO "authenticated";

REVOKE ALL ("capacity") ON TABLE "public"."trial_occurrences" FROM "authenticated";

GRANT UPDATE ("capacity") ON TABLE "public"."trial_occurrences" TO "authenticated";

GRANT SELECT ON TABLE "public"."trial_occurrences" TO "authenticated";

REVOKE ALL ON TABLE "public"."trial_occurrences" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."trial_occurrences" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."trial_occurrences" TO "service_role";

REVOKE ALL ON TABLE "public"."trial_offerings" FROM "anon";

GRANT SELECT ON TABLE "public"."trial_offerings" TO "anon";

REVOKE ALL ON TABLE "public"."trial_offerings" FROM "authenticated";

GRANT INSERT, SELECT, UPDATE ON TABLE "public"."trial_offerings" TO "authenticated";

REVOKE ALL ON TABLE "public"."trial_offerings" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."trial_offerings" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."trial_offerings" TO "service_role";

REVOKE ALL ON TABLE "public"."trial_windows" FROM "anon";

GRANT SELECT ON TABLE "public"."trial_windows" TO "anon";

REVOKE ALL ON TABLE "public"."trial_windows" FROM "authenticated";

REVOKE ALL ("active") ON TABLE "public"."trial_windows" FROM "authenticated";

GRANT UPDATE ("active") ON TABLE "public"."trial_windows" TO "authenticated";

REVOKE ALL ("capacity") ON TABLE "public"."trial_windows" FROM "authenticated";

GRANT UPDATE ("capacity") ON TABLE "public"."trial_windows" TO "authenticated";

REVOKE ALL ("updated_at") ON TABLE "public"."trial_windows" FROM "authenticated";

GRANT UPDATE ("updated_at") ON TABLE "public"."trial_windows" TO "authenticated";

GRANT DELETE, INSERT, SELECT ON TABLE "public"."trial_windows" TO "authenticated";

REVOKE ALL ON TABLE "public"."trial_windows" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."trial_windows" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."trial_windows" TO "service_role";

REVOKE ALL ON TABLE "public"."users" FROM "authenticated";

GRANT SELECT ON TABLE "public"."users" TO "authenticated";

REVOKE ALL ON TABLE "public"."users" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."users" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."users" TO "service_role";

REVOKE ALL ON TABLE "public"."whatsapp_booking_intents" FROM "authenticated";

GRANT SELECT ON TABLE "public"."whatsapp_booking_intents" TO "authenticated";

REVOKE ALL ON TABLE "public"."whatsapp_booking_intents" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."whatsapp_booking_intents" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."whatsapp_booking_intents" TO "service_role";

REVOKE ALL ON TABLE "public"."whatsapp_deliveries" FROM "authenticated";

GRANT SELECT ON TABLE "public"."whatsapp_deliveries" TO "authenticated";

REVOKE ALL ON TABLE "public"."whatsapp_deliveries" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."whatsapp_deliveries" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."whatsapp_deliveries" TO "service_role";

REVOKE ALL ON TABLE "public"."whatsapp_jobs" FROM "authenticated";

GRANT SELECT ON TABLE "public"."whatsapp_jobs" TO "authenticated";

REVOKE ALL ON TABLE "public"."whatsapp_jobs" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."whatsapp_jobs" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."whatsapp_jobs" TO "service_role";
