CREATE TYPE "app"."conversation_channel" AS ENUM('web', 'whatsapp');--> statement-breakpoint
ALTER TABLE "app"."conversations" ADD COLUMN "channel" "app"."conversation_channel";--> statement-breakpoint
UPDATE "app"."conversations"
SET "channel" = CASE WHEN "wa_id_hash" IS NOT NULL
  THEN 'whatsapp'::"app"."conversation_channel"
  ELSE 'web'::"app"."conversation_channel" END;--> statement-breakpoint
ALTER TABLE "app"."conversations" ALTER COLUMN "channel" SET NOT NULL;
