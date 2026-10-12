ALTER TABLE "app"."schools" ADD COLUMN "whatsapp_signup_attempt_id" uuid;--> statement-breakpoint
ALTER TABLE "app"."schools" ADD COLUMN "whatsapp_verification_code" text;--> statement-breakpoint
ALTER TABLE "app"."schools" ADD COLUMN "whatsapp_verification_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."schools" ADD COLUMN "whatsapp_verification_message_ids" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."schools" ADD COLUMN "whatsapp_registration_pin_encrypted" text;
