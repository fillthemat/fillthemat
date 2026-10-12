CREATE TABLE "app"."school_domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"domain" text NOT NULL,
	"mode" text DEFAULT 'redirect' NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"last_checked_at" timestamp with time zone,
	"last_check_result" text,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"verified_at" timestamp with time zone,
	"check_id" uuid,
	"checking_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "school_domains_school_domain_unique" UNIQUE("school_id","domain"),
	CONSTRAINT "school_domains_state" CHECK ("app"."school_domains"."state" IN ('pending', 'verified', 'failing')),
	CONSTRAINT "school_domains_mode" CHECK ("app"."school_domains"."mode" IN ('redirect', 'copy')),
	CONSTRAINT "school_domains_failures" CHECK ("app"."school_domains"."consecutive_failures" >= 0),
	CONSTRAINT "school_domains_domain" CHECK (char_length("app"."school_domains"."domain") BETWEEN 3 AND 253 AND "app"."school_domains"."domain" = lower("app"."school_domains"."domain") AND "app"."school_domains"."domain" !~ '^www\.')
);
--> statement-breakpoint
ALTER TABLE "app"."school_domains" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "app"."school_domains" ADD CONSTRAINT "school_domains_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "app"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "school_domains_live_domain_unique" ON "app"."school_domains" USING btree ("domain") WHERE "app"."school_domains"."state" IN ('verified', 'failing');