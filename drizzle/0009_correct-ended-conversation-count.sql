-- 0008 renamed a purge metric, but those counts do not describe ended
-- conversations. Replace it rather than relabel historic values. A forward
-- migration also repairs local databases that already applied unreleased 0008.
ALTER TABLE "app"."cron_runs" DROP COLUMN "ended_conversation_count";--> statement-breakpoint
ALTER TABLE "app"."cron_runs" ADD COLUMN "ended_conversation_count" integer DEFAULT 0 NOT NULL;
