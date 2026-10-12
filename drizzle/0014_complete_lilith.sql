ALTER TABLE "app"."schools" ADD COLUMN "whatsapp_token_encrypted" text;--> statement-breakpoint
ALTER TABLE "app"."schools" ADD COLUMN "whatsapp_token_expires_at" timestamp with time zone;