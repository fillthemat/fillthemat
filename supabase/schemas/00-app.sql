-- Desired state after drizzle/0000 through 0014. Keep the private app namespace.
CREATE SCHEMA app;

CREATE TYPE app.booking_status AS ENUM ('booked', 'showed', 'no_show', 'cancelled');
CREATE TYPE app.conversation_end_reason AS ENUM ('inactivity', 'message_limit');
CREATE TYPE app.cron_result AS ENUM ('success', 'error');
CREATE TYPE app.email_kind AS ENUM (
    'prospect_confirmation', 'booking_reminder', 'booking_cancellation',
    'owner_booking', 'owner_cancellation', 'owner_lead', 'owner_whatsapp_confirmation_failed'
);
CREATE TYPE app.email_state AS ENUM ('pending', 'claimed', 'sent', 'failed', 'delivered', 'bounced', 'complained', 'dead');
CREATE TYPE app.message_completion AS ENUM ('complete', 'streaming', 'aborted', 'error');
CREATE TYPE app.whatsapp_booking_intent_state AS ENUM ('pending', 'confirmed', 'expired', 'superseded');
CREATE TYPE app.whatsapp_delivery_state AS ENUM ('pending', 'claimed', 'sent', 'delivered', 'read', 'failed', 'dead');
CREATE TYPE app.whatsapp_job_state AS ENUM ('pending', 'claimed', 'done', 'failed', 'dead');
CREATE TYPE app.whatsapp_send_outcome AS ENUM ('accepted', 'unknown', 'rejected');
