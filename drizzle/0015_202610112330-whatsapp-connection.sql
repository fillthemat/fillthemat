CREATE TYPE "app"."whatsapp_connection_state" AS ENUM('off', 'buying', 'popup', 'cancelled', 'popup-failed', 'failed', 'needs-card', 'registering', 'live', 'cooling', 'released', 'broken-card', 'broken-access', 'broken-restricted', 'broken-number');--> statement-breakpoint
ALTER TABLE "app"."schools" ADD COLUMN "whatsapp_connection_state" "app"."whatsapp_connection_state" DEFAULT 'off' NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."schools" ADD COLUMN "whatsapp_number" text;--> statement-breakpoint
ALTER TABLE "app"."schools" ADD COLUMN "whatsapp_provider_resource_id" text;--> statement-breakpoint
ALTER TABLE "app"."schools" ADD COLUMN "whatsapp_allocation_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "schools_whatsapp_provider_resource_id_unique" ON "app"."schools" USING btree ("whatsapp_provider_resource_id") WHERE "app"."schools"."whatsapp_provider_resource_id" IS NOT NULL;