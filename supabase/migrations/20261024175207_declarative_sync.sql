SET local check_function_bodies = off;

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

REVOKE ALL ON TABLE "public"."faqs" FROM "anon";

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

CREATE TABLE "public"."school_settings" (
  "school_id"          uuid                     NOT NULL,
  "name"               text                     NOT NULL DEFAULT ''::text,
  "notification_email" text                     NOT NULL DEFAULT ''::text,
  "phone"              text,
  "website"            text,
  "address"            text,
  "country"            text                     NOT NULL DEFAULT 'US'::text,
  "city"               text,
  "parking_notes"      text,
  "access_notes"       text,
  "trial_guidance"     text,
  "pricing"            text,
  "welcome_message"    text,
  "agent_instructions" text,
  "logo_url"           text,
  "primary_color"      text,
  "created_at"         timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"         timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "school_settings_logo_url" CHECK (((logo_url IS NULL) OR (logo_url ~ '^https://'::text))),
  CONSTRAINT "school_settings_pkey" PRIMARY KEY (school_id),
  CONSTRAINT "school_settings_primary_color" CHECK (((primary_color IS NULL) OR (primary_color ~ '^#[0-9A-Fa-f]{6}$'::text)))
);

ALTER TABLE "public"."school_settings"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."school_settings" FROM "anon";

CREATE TABLE "public"."schools" (
  "id"                       uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "owner_user_id"            uuid                     NOT NULL,
  "slug"                     text                     NOT NULL,
  "timezone"                 text                     NOT NULL,
  "approved_at"              timestamp with time zone,
  "published_at"             timestamp with time zone,
  "previewed_at"             timestamp with time zone,
  "created_at"               timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"               timestamp with time zone NOT NULL DEFAULT now(),
  "whatsapp_phone_number_id" text,
  "whatsapp_waba_id"         text,
  CONSTRAINT "schools_owner_user_id_unique" UNIQUE (owner_user_id),
  CONSTRAINT "schools_school_id_unique" PRIMARY KEY (id),
  CONSTRAINT "schools_slug_format" CHECK (((slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text) AND ((char_length(slug) >= 3) AND (char_length(slug) <= 48)))),
  CONSTRAINT "schools_slug_unique" UNIQUE (slug)
);

ALTER TABLE "public"."schools"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."schools" FROM "anon";

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

REVOKE ALL ON TABLE "public"."trial_occurrences" FROM "anon";

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

REVOKE ALL ON TABLE "public"."trial_offerings" FROM "anon";

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

REVOKE ALL ON TABLE "public"."trial_windows" FROM "anon";

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

CREATE OR REPLACE FUNCTION public.cancel_dashboard_booking (
  p_booking_id uuid
)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE
    v_booking public.bookings%ROWTYPE;
    v_notification_email text;
    v_sequence integer;
BEGIN
    SELECT b.* INTO v_booking
    FROM public.bookings b
    WHERE b.id = p_booking_id
      AND EXISTS (
          SELECT 1 FROM public.schools s
          WHERE s.id = b.school_id AND s.owner_user_id = (SELECT auth.uid())
      )
    FOR UPDATE;

    IF NOT FOUND THEN RETURN 'not_found'; END IF;
    IF v_booking.status = 'cancelled' THEN RETURN 'replay'; END IF;
    IF v_booking.status <> 'booked' OR v_booking.start_at <= now() THEN
        RETURN 'not_cancellable';
    END IF;

    v_sequence := v_booking.ics_sequence + 1;
    UPDATE public.bookings
    SET status = 'cancelled', cancelled_at = now(),
        ics_sequence = v_sequence, updated_at = now()
    WHERE id = v_booking.id;

    UPDATE public.trial_occurrences
    SET booked_count = booked_count - 1, updated_at = now()
    WHERE id = v_booking.trial_occurrence_id
      AND school_id = v_booking.school_id AND booked_count > 0;

    SELECT notification_email INTO v_notification_email
    FROM public.school_settings WHERE school_id = v_booking.school_id;

    IF v_booking.contact_email_snapshot IS NOT NULL THEN
        INSERT INTO public.email_deliveries (
            school_id, booking_id, kind, recipient, provider_idempotency_key
        ) VALUES (
            v_booking.school_id, v_booking.id, 'booking_cancellation',
            v_booking.contact_email_snapshot,
            'booking-cancellation/' || v_booking.id || '/' || v_sequence
        );
    END IF;
    IF v_notification_email IS NOT NULL AND v_notification_email <> '' THEN
        INSERT INTO public.email_deliveries (
            school_id, booking_id, kind, recipient, provider_idempotency_key
        ) VALUES (
            v_booking.school_id, v_booking.id, 'owner_cancellation',
            v_notification_email,
            'owner-cancellation/' || v_booking.id || '/' || v_sequence
        );
    END IF;

    INSERT INTO public.funnel_events (
        school_id, booking_id, landing_session_id, conversation_id, event_type, metadata
    ) VALUES (
        v_booking.school_id, v_booking.id, v_booking.landing_session_id,
        v_booking.conversation_id, 'booking_cancelled', jsonb_build_object('sequence', v_sequence)
    );
    RETURN 'cancelled';
END;
$function$;

REVOKE ALL ON FUNCTION "public"."cancel_dashboard_booking"(uuid) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.create_settings_faq (
  p_school_id uuid,
  p_question  text,
  p_answer    text
)
  RETURNS SETOF public.faqs
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE v_count integer;
BEGIN
    PERFORM 1 FROM public.schools
    WHERE id = p_school_id AND owner_user_id = (SELECT auth.uid()) FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'school_not_found' USING ERRCODE = '42501'; END IF;
    SELECT count(*) INTO v_count FROM public.faqs WHERE school_id = p_school_id;
    IF v_count >= 20 THEN RAISE EXCEPTION 'faq_limit_reached' USING ERRCODE = '23514'; END IF;
    RETURN QUERY INSERT INTO public.faqs (school_id, question, answer, sort_order)
    VALUES (p_school_id, p_question, p_answer, v_count) RETURNING *;
END;
$function$;

REVOKE ALL ON FUNCTION "public"."create_settings_faq"(uuid, text, text) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.delete_settings_window (
  p_window_id uuid
)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE v_school_id uuid;
BEGIN
    SELECT w.school_id INTO v_school_id FROM public.trial_windows w
    JOIN public.schools s ON s.id = w.school_id
    WHERE w.id = p_window_id AND s.owner_user_id = (SELECT auth.uid()) FOR UPDATE OF w;
    IF NOT FOUND THEN RETURN 'not_found'; END IF;
    IF EXISTS (SELECT 1 FROM public.trial_occurrences WHERE trial_window_id = p_window_id AND school_id = v_school_id) THEN
        RETURN 'on_calendar';
    END IF;
    DELETE FROM public.trial_windows WHERE id = p_window_id;
    RETURN 'deleted';
END;
$function$;

REVOKE ALL ON FUNCTION "public"."delete_settings_window"(uuid) FROM PUBLIC, "anon";

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
      AND s.owner_user_id = (SELECT auth.uid());
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
    ORDER BY w.day_of_week, w.start_minute;
$function$;

REVOKE ALL ON FUNCTION "public"."get_settings_windows"(uuid) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.prevent_published_school_identity_change()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $function$
BEGIN
  IF OLD.published_at IS NOT NULL THEN
    IF NEW.slug IS DISTINCT FROM OLD.slug OR NEW.timezone IS DISTINCT FROM OLD.timezone THEN
      RAISE EXCEPTION 'slug and timezone are immutable after publish';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION "public"."prevent_published_school_identity_change"() FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.update_booking_attendance (
  p_booking_id uuid,
  p_status     text
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE
    v_school_id uuid;
BEGIN
    IF p_status NOT IN ('showed', 'no_show') OR p_status IS NULL THEN
        RAISE EXCEPTION 'invalid_attendance_status' USING ERRCODE = '22023';
    END IF;

    UPDATE public.bookings b
    SET status = p_status::public.booking_status, updated_at = now()
    WHERE b.id = p_booking_id
      AND b.status IN ('booked', 'showed', 'no_show')
      AND EXISTS (
          SELECT 1 FROM public.schools s
          WHERE s.id = b.school_id AND s.owner_user_id = (SELECT auth.uid())
      )
    RETURNING b.school_id INTO v_school_id;

    IF NOT FOUND THEN RETURN false; END IF;

    INSERT INTO public.funnel_events (school_id, booking_id, event_type)
    VALUES (v_school_id, p_booking_id, p_status);
    RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION "public"."update_booking_attendance"(uuid, text) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.update_school_profile (
  p_school_id uuid,
  p_slug      text,
  p_timezone  text,
  p_profile   jsonb
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
BEGIN
    PERFORM 1 FROM public.schools
    WHERE id = p_school_id AND owner_user_id = (SELECT auth.uid()) FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'school_not_found' USING ERRCODE = '42501'; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = p_timezone) THEN
        RAISE EXCEPTION 'invalid_timezone' USING ERRCODE = '22023';
    END IF;
    -- The schools trigger rejects identity changes after publication.
    UPDATE public.schools SET slug = p_slug, timezone = p_timezone, updated_at = now()
    WHERE id = p_school_id;
    INSERT INTO public.school_settings (
        school_id, name, notification_email, phone, website, address, city, country,
        parking_notes, access_notes, trial_guidance
    ) VALUES (
        p_school_id, p_profile->>'name', p_profile->>'notification_email',
        p_profile->>'phone', p_profile->>'website', p_profile->>'address', p_profile->>'city',
        coalesce(p_profile->>'country', 'US'), p_profile->>'parking_notes',
        p_profile->>'access_notes', p_profile->>'trial_guidance'
    ) ON CONFLICT (school_id) DO UPDATE SET
        name = EXCLUDED.name, notification_email = EXCLUDED.notification_email,
        phone = EXCLUDED.phone, website = EXCLUDED.website, address = EXCLUDED.address,
        city = EXCLUDED.city, country = EXCLUDED.country, parking_notes = EXCLUDED.parking_notes,
        access_notes = EXCLUDED.access_notes, trial_guidance = EXCLUDED.trial_guidance, updated_at = now();
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
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE v_school_id uuid; v_booked integer;
BEGIN
    IF p_capacity IS NULL OR p_capacity NOT BETWEEN 1 AND 50 THEN
        RAISE EXCEPTION 'invalid_capacity' USING ERRCODE = '22023';
    END IF;
    SELECT w.school_id INTO v_school_id FROM public.trial_windows w
    JOIN public.schools s ON s.id = w.school_id
    WHERE w.id = p_window_id AND s.owner_user_id = (SELECT auth.uid()) FOR UPDATE OF w;
    IF NOT FOUND THEN RETURN QUERY SELECT 'not_found'::text, 0; RETURN; END IF;
    PERFORM 1 FROM public.trial_occurrences
    WHERE trial_window_id = p_window_id AND school_id = v_school_id AND start_at > now()
    ORDER BY id FOR UPDATE;
    SELECT coalesce(max(booked_count), 0) INTO v_booked FROM public.trial_occurrences
    WHERE trial_window_id = p_window_id AND school_id = v_school_id AND start_at > now();
    IF v_booked > p_capacity THEN
        RETURN QUERY SELECT 'below_booked'::text, v_booked; RETURN;
    END IF;
    UPDATE public.trial_windows SET capacity = p_capacity, updated_at = now() WHERE id = p_window_id;
    UPDATE public.trial_occurrences SET capacity = p_capacity, updated_at = now()
    WHERE trial_window_id = p_window_id AND school_id = v_school_id AND start_at > now();
    RETURN QUERY SELECT 'updated'::text, v_booked;
END;
$function$;

REVOKE ALL ON FUNCTION "public"."update_settings_window_capacity"(uuid, integer) FROM PUBLIC, "anon";

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

ALTER TABLE "public"."schools"
  ADD CONSTRAINT "schools_owner_user_id_users_id_fk" FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE CASCADE;

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

CREATE UNIQUE INDEX conversations_resume_token_hash ON public.conversations USING btree (resume_token_hash)
  WHERE (ended_at IS NULL);

CREATE UNIQUE INDEX conversations_school_wa_id_hash ON public.conversations USING btree (school_id, wa_id_hash)
  WHERE ((wa_id_hash IS NOT NULL) AND (ended_at IS NULL));

CREATE INDEX email_deliveries_due_idx ON public.email_deliveries USING btree (state, next_attempt_at);

CREATE INDEX funnel_events_school_created_idx ON public.funnel_events USING btree (school_id, created_at);

CREATE UNIQUE INDEX schools_whatsapp_phone_number_id_unique ON public.schools USING btree (whatsapp_phone_number_id)
  WHERE (whatsapp_phone_number_id IS NOT NULL);

CREATE UNIQUE INDEX whatsapp_booking_intents_active_pending ON public.whatsapp_booking_intents USING btree (conversation_id)
  WHERE (state = 'pending'::public.whatsapp_booking_intent_state);

CREATE INDEX whatsapp_deliveries_due_idx ON public.whatsapp_deliveries USING btree (state, next_attempt_at);

CREATE INDEX whatsapp_jobs_due_idx ON public.whatsapp_jobs USING btree (state, next_attempt_at);

CREATE TRIGGER schools_identity_immutable
  BEFORE UPDATE ON public.schools
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_published_school_identity_change();

CREATE POLICY "bookings_select_own_school" ON "public"."bookings"
  FOR SELECT
  TO "authenticated"
  USING ((school_id = ( SELECT s.id
   FROM public.schools s
  WHERE (s.owner_user_id = auth.uid()))));

CREATE POLICY "contacts_select_own_school" ON "public"."contacts"
  FOR SELECT
  TO "authenticated"
  USING ((school_id = ( SELECT s.id
   FROM public.schools s
  WHERE (s.owner_user_id = auth.uid()))));

CREATE POLICY "conversations_select_own_school" ON "public"."conversations"
  FOR SELECT
  TO "authenticated"
  USING ((school_id = ( SELECT s.id
   FROM public.schools s
  WHERE (s.owner_user_id = auth.uid()))));

CREATE POLICY "email_deliveries_select_own_school" ON "public"."email_deliveries"
  FOR SELECT
  TO "authenticated"
  USING ((school_id = ( SELECT s.id
   FROM public.schools s
  WHERE (s.owner_user_id = auth.uid()))));

CREATE POLICY "faqs_owner_write" ON "public"."faqs"
  FOR ALL
  TO "authenticated"
  USING ((school_id = ( SELECT schools.id
   FROM public.schools
  WHERE (schools.owner_user_id = ( SELECT auth.uid() AS uid)))))
  WITH CHECK ((school_id = ( SELECT schools.id
   FROM public.schools
  WHERE (schools.owner_user_id = ( SELECT auth.uid() AS uid)))));

CREATE POLICY "faqs_select_own_school" ON "public"."faqs"
  FOR SELECT
  TO "authenticated"
  USING ((school_id = ( SELECT s.id
   FROM public.schools s
  WHERE (s.owner_user_id = auth.uid()))));

CREATE POLICY "funnel_events_select_own_school" ON "public"."funnel_events"
  FOR SELECT
  TO "authenticated"
  USING ((school_id = ( SELECT s.id
   FROM public.schools s
  WHERE (s.owner_user_id = auth.uid()))));

CREATE POLICY "landing_sessions_select_own_school" ON "public"."landing_sessions"
  FOR SELECT
  TO "authenticated"
  USING ((school_id = ( SELECT s.id
   FROM public.schools s
  WHERE (s.owner_user_id = auth.uid()))));

CREATE POLICY "leads_select_own_school" ON "public"."leads"
  FOR SELECT
  TO "authenticated"
  USING ((school_id = ( SELECT s.id
   FROM public.schools s
  WHERE (s.owner_user_id = auth.uid()))));

CREATE POLICY "messages_select_own_school" ON "public"."messages"
  FOR SELECT
  TO "authenticated"
  USING ((EXISTS ( SELECT 1
   FROM (public.conversations c
     JOIN public.schools s ON ((s.id = c.school_id)))
  WHERE ((c.id = messages.conversation_id) AND (s.owner_user_id = auth.uid())))));

CREATE POLICY "participants_select_own_school" ON "public"."participants"
  FOR SELECT
  TO "authenticated"
  USING ((school_id = ( SELECT s.id
   FROM public.schools s
  WHERE (s.owner_user_id = auth.uid()))));

CREATE POLICY "school_settings_owner_access" ON "public"."school_settings"
  FOR ALL
  TO "authenticated"
  USING ((school_id = ( SELECT schools.id
   FROM public.schools
  WHERE (schools.owner_user_id = ( SELECT auth.uid() AS uid)))))
  WITH CHECK ((school_id = ( SELECT schools.id
   FROM public.schools
  WHERE (schools.owner_user_id = ( SELECT auth.uid() AS uid)))));

CREATE POLICY "schools_select_own" ON "public"."schools"
  FOR SELECT
  TO "authenticated"
  USING ((owner_user_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY "trial_occurrences_select_own_school" ON "public"."trial_occurrences"
  FOR SELECT
  TO "authenticated"
  USING ((school_id = ( SELECT s.id
   FROM public.schools s
  WHERE (s.owner_user_id = auth.uid()))));

CREATE POLICY "trial_offerings_owner_write" ON "public"."trial_offerings"
  FOR ALL
  TO "authenticated"
  USING ((school_id = ( SELECT schools.id
   FROM public.schools
  WHERE (schools.owner_user_id = ( SELECT auth.uid() AS uid)))))
  WITH CHECK ((school_id = ( SELECT schools.id
   FROM public.schools
  WHERE (schools.owner_user_id = ( SELECT auth.uid() AS uid)))));

CREATE POLICY "trial_offerings_select_own_school" ON "public"."trial_offerings"
  FOR SELECT
  TO "authenticated"
  USING ((school_id = ( SELECT s.id
   FROM public.schools s
  WHERE (s.owner_user_id = auth.uid()))));

CREATE POLICY "trial_windows_owner_write" ON "public"."trial_windows"
  FOR ALL
  TO "authenticated"
  USING ((school_id = ( SELECT schools.id
   FROM public.schools
  WHERE (schools.owner_user_id = ( SELECT auth.uid() AS uid)))))
  WITH CHECK ((school_id = ( SELECT schools.id
   FROM public.schools
  WHERE (schools.owner_user_id = ( SELECT auth.uid() AS uid)))));

CREATE POLICY "trial_windows_select_own_school" ON "public"."trial_windows"
  FOR SELECT
  TO "authenticated"
  USING ((school_id = ( SELECT s.id
   FROM public.schools s
  WHERE (s.owner_user_id = auth.uid()))));

CREATE POLICY "users_select_own" ON "public"."users"
  FOR SELECT
  TO "authenticated"
  USING ((id = ( SELECT auth.uid() AS uid)));

CREATE POLICY "whatsapp_booking_intents_select_own_school" ON "public"."whatsapp_booking_intents"
  FOR SELECT
  TO "authenticated"
  USING ((school_id = ( SELECT s.id
   FROM public.schools s
  WHERE (s.owner_user_id = auth.uid()))));

CREATE POLICY "whatsapp_deliveries_select_own_school" ON "public"."whatsapp_deliveries"
  FOR SELECT
  TO "authenticated"
  USING ((school_id = ( SELECT s.id
   FROM public.schools s
  WHERE (s.owner_user_id = auth.uid()))));

CREATE POLICY "whatsapp_jobs_select_own_school" ON "public"."whatsapp_jobs"
  FOR SELECT
  TO "authenticated"
  USING ((school_id = ( SELECT s.id
   FROM public.schools s
  WHERE (s.owner_user_id = auth.uid()))));

GRANT EXECUTE ON FUNCTION "public"."cancel_dashboard_booking"(uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."cancel_dashboard_booking"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."cancel_dashboard_booking"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."cancel_dashboard_booking"(uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."create_settings_faq"(uuid, text, text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."create_settings_faq"(uuid, text, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."create_settings_faq"(uuid, text, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."create_settings_faq"(uuid, text, text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."delete_settings_window"(uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."delete_settings_window"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."delete_settings_window"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."delete_settings_window"(uuid) TO "service_role";

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

GRANT EXECUTE ON FUNCTION "public"."update_booking_attendance"(uuid, text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."update_booking_attendance"(uuid, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."update_booking_attendance"(uuid, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."update_booking_attendance"(uuid, text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."update_school_profile"(uuid, text, text, jsonb) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."update_school_profile"(uuid, text, text, jsonb) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."update_school_profile"(uuid, text, text, jsonb) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."update_school_profile"(uuid, text, text, jsonb) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."update_settings_window_capacity"(uuid, integer) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."update_settings_window_capacity"(uuid, integer) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."update_settings_window_capacity"(uuid, integer) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."update_settings_window_capacity"(uuid, integer) TO "service_role";

REVOKE ALL ON TABLE "public"."bookings" FROM "authenticated";

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

GRANT SELECT ON TABLE "public"."email_deliveries" TO "authenticated";

REVOKE ALL ON TABLE "public"."email_deliveries" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."email_deliveries" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."email_deliveries" TO "service_role";

REVOKE ALL ON TABLE "public"."faqs" FROM "authenticated";

GRANT DELETE, SELECT, UPDATE ON TABLE "public"."faqs" TO "authenticated";

REVOKE ALL ON TABLE "public"."faqs" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."faqs" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."faqs" TO "service_role";

REVOKE ALL ON TABLE "public"."funnel_events" FROM "authenticated";

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

REVOKE ALL ON TABLE "public"."school_settings" FROM "authenticated";

GRANT INSERT, SELECT, UPDATE ON TABLE "public"."school_settings" TO "authenticated";

REVOKE ALL ON TABLE "public"."school_settings" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."school_settings" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."school_settings" TO "service_role";

REVOKE ALL ON TABLE "public"."schools" FROM "authenticated";

GRANT SELECT ON TABLE "public"."schools" TO "authenticated";

REVOKE ALL ON TABLE "public"."schools" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."schools" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."schools" TO "service_role";

REVOKE ALL ON TABLE "public"."trial_occurrences" FROM "authenticated";

GRANT SELECT ON TABLE "public"."trial_occurrences" TO "authenticated";

REVOKE ALL ON TABLE "public"."trial_occurrences" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."trial_occurrences" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."trial_occurrences" TO "service_role";

REVOKE ALL ON TABLE "public"."trial_offerings" FROM "authenticated";

GRANT INSERT, SELECT, UPDATE ON TABLE "public"."trial_offerings" TO "authenticated";

REVOKE ALL ON TABLE "public"."trial_offerings" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."trial_offerings" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."trial_offerings" TO "service_role";

REVOKE ALL ON TABLE "public"."trial_windows" FROM "authenticated";

REVOKE ALL ("active") ON TABLE "public"."trial_windows" FROM "authenticated";

GRANT UPDATE ("active") ON TABLE "public"."trial_windows" TO "authenticated";

REVOKE ALL ("updated_at") ON TABLE "public"."trial_windows" FROM "authenticated";

GRANT UPDATE ("updated_at") ON TABLE "public"."trial_windows" TO "authenticated";

GRANT INSERT, SELECT ON TABLE "public"."trial_windows" TO "authenticated";

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
