ALTER TYPE "app"."whatsapp_delivery_state" ADD VALUE 'dead';--> statement-breakpoint
ALTER TABLE "app"."whatsapp_deliveries" ADD COLUMN "failure_reason" text;--> statement-breakpoint
ALTER TABLE "app"."whatsapp_deliveries" ADD COLUMN "failure_code" integer;--> statement-breakpoint
ALTER TABLE "app"."whatsapp_deliveries" ADD COLUMN "terminal_cause" text;