CREATE TABLE "app"."poppy_budget_usages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."poppy_budget_usages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "poppy_budget_usages_key_expiry" ON "app"."poppy_budget_usages" USING btree ("key","expires_at");--> statement-breakpoint
CREATE INDEX "poppy_budget_usages_expiry" ON "app"."poppy_budget_usages" USING btree ("expires_at");