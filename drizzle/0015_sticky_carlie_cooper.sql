ALTER TABLE "app"."bookings" ADD COLUMN "channel" "app"."channel" DEFAULT 'web' NOT NULL;--> statement-breakpoint
UPDATE "app"."bookings" AS booking
SET "channel" = 'whatsapp'
WHERE EXISTS (
  SELECT 1 FROM "app"."conversations" AS conversation
  WHERE conversation."school_id" = booking."school_id"
    AND conversation."id" = booking."conversation_id"
    AND conversation."wa_id_hash" IS NOT NULL
) OR EXISTS (
  SELECT 1 FROM "app"."landing_sessions" AS session
  WHERE session."school_id" = booking."school_id"
    AND session."id" = booking."landing_session_id"
    AND session."utm_source" = 'whatsapp'
);
