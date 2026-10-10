ALTER TYPE "app"."whatsapp_job_state" ADD VALUE 'dead';--> statement-breakpoint
ALTER TABLE "app"."whatsapp_jobs" ADD COLUMN "failure_reason" text;--> statement-breakpoint
ALTER TABLE "app"."whatsapp_jobs" ADD COLUMN "terminal_cause" text;