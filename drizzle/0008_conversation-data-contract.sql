ALTER TABLE "app"."cron_runs" RENAME COLUMN "purged_count" TO "ended_conversation_count";--> statement-breakpoint
DROP INDEX "app"."messages_purge_at_idx";--> statement-breakpoint
ALTER TABLE "app"."messages" DROP COLUMN "purge_at";