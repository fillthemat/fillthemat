CREATE TYPE "app"."channel" AS ENUM('web', 'whatsapp');--> statement-breakpoint
ALTER TABLE "app"."leads" ADD COLUMN "channel" "app"."channel" DEFAULT 'web' NOT NULL;--> statement-breakpoint
UPDATE "app"."leads" AS lead
SET "channel" = 'whatsapp'
WHERE EXISTS (
  SELECT 1 FROM "app"."landing_sessions" AS session
  WHERE session."school_id" = lead."school_id"
    AND session."id" = lead."landing_session_id"
    AND session."utm_source" = 'whatsapp'
);
