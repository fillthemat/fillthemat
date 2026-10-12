ALTER TYPE "app"."email_kind" ADD VALUE 'owner_poppy_domain_dropped';--> statement-breakpoint
ALTER TABLE "app"."email_deliveries" ADD COLUMN "domain_snapshot" text;