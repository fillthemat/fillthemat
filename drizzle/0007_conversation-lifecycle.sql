CREATE TYPE "app"."conversation_end_reason" AS ENUM('inactivity', 'message_limit');--> statement-breakpoint
ALTER TABLE "app"."conversations" DROP CONSTRAINT "conversations_resume_token_hash";--> statement-breakpoint
DROP INDEX "app"."conversations_school_wa_id_hash";--> statement-breakpoint
ALTER TABLE "app"."conversations" ADD COLUMN "ended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."conversations" ADD COLUMN "end_reason" "app"."conversation_end_reason";--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_resume_token_hash" ON "app"."conversations" USING btree ("resume_token_hash") WHERE "app"."conversations"."ended_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_school_wa_id_hash" ON "app"."conversations" USING btree ("school_id","wa_id_hash") WHERE "app"."conversations"."wa_id_hash" IS NOT NULL AND "app"."conversations"."ended_at" IS NULL;