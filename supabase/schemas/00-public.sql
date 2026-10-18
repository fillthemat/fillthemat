-- Side-by-side copies of Drizzle app objects; public already exists in Supabase.
CREATE SCHEMA IF NOT EXISTS public;

CREATE TYPE public.booking_status AS ENUM ('booked', 'showed', 'no_show', 'cancelled');
CREATE TYPE public.conversation_end_reason AS ENUM ('inactivity', 'message_limit');
CREATE TYPE public.cron_result AS ENUM ('success', 'error');
CREATE TYPE public.email_kind AS ENUM (
    'prospect_confirmation', 'booking_reminder', 'booking_cancellation',
    'owner_booking', 'owner_cancellation', 'owner_lead', 'owner_whatsapp_confirmation_failed'
);
CREATE TYPE public.email_state AS ENUM ('pending', 'claimed', 'sent', 'failed', 'delivered', 'bounced', 'complained', 'dead');
CREATE TYPE public.message_completion AS ENUM ('complete', 'streaming', 'aborted', 'error');
CREATE TYPE public.whatsapp_booking_intent_state AS ENUM ('pending', 'confirmed', 'expired', 'superseded');
CREATE TYPE public.whatsapp_delivery_state AS ENUM ('pending', 'claimed', 'sent', 'delivered', 'read', 'failed', 'dead');
CREATE TYPE public.whatsapp_job_state AS ENUM ('pending', 'claimed', 'done', 'failed', 'dead');
CREATE TYPE public.whatsapp_send_outcome AS ENUM ('accepted', 'unknown', 'rejected');
