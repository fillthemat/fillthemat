CREATE TABLE "app"."poppy_blocked_clients" (
	"client_id" text PRIMARY KEY NOT NULL,
	"blocked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."poppy_blocked_clients" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "app"."poppy_client_admissions" (
	"client_id" text PRIMARY KEY NOT NULL,
	"lease_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."poppy_client_admissions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "poppy_client_admissions_expiry_idx" ON "app"."poppy_client_admissions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "poppy_clients_first_seen_idx" ON "app"."poppy_clients" USING btree ("first_seen_at");