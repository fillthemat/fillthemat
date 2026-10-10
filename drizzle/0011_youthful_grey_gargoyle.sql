ALTER TYPE "app"."email_state" ADD VALUE 'dead';--> statement-breakpoint
ALTER TABLE "app"."email_deliveries" ADD COLUMN "failure_reason" text;--> statement-breakpoint
ALTER TABLE "app"."email_deliveries" ADD COLUMN "terminal_cause" text;