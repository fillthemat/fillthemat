ALTER TYPE "app"."whatsapp_delivery_state" ADD VALUE 'dead';--> statement-breakpoint
ALTER TABLE "app"."whatsapp_deliveries" ADD COLUMN "failure_reason" text;--> statement-breakpoint
ALTER TABLE "app"."whatsapp_deliveries" ADD COLUMN "failure_code" integer;--> statement-breakpoint
ALTER TABLE "app"."whatsapp_deliveries" ADD COLUMN "terminal_cause" text;--> statement-breakpoint
-- Legacy accepted sends that later failed consumed at least one execution.
-- Do not claim an exact history or lower an existing failure count. Exhausted
-- rows stop on their next claim, without starting another outbound request.
UPDATE "app"."whatsapp_deliveries"
SET "attempts" = GREATEST("attempts", 1)
WHERE "state" = 'failed' AND "provider_id" IS NOT NULL AND "attempts" < 1;
