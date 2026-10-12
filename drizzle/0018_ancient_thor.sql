CREATE TABLE "app"."poppy_clients" (
	"client_id" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"extensions" jsonb NOT NULL,
	"jwks" jsonb NOT NULL,
	"cached_until" timestamp with time zone NOT NULL,
	"refresh_after" timestamp with time zone NOT NULL,
	"refreshing_until" timestamp with time zone,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."poppy_clients" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "app"."poppy_replays" (
	"key_hash" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."poppy_replays" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "app"."poppy_session_tokens" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"dpop_thumbprint" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."poppy_session_tokens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "app"."poppy_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"client_id" text NOT NULL,
	"user_id" text NOT NULL,
	"dpop_thumbprint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	CONSTRAINT "poppy_sessions_school_id_id" UNIQUE("school_id","id")
);
--> statement-breakpoint
ALTER TABLE "app"."poppy_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "app"."poppy_session_tokens" ADD CONSTRAINT "poppy_session_tokens_session_fk" FOREIGN KEY ("school_id","session_id") REFERENCES "app"."poppy_sessions"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."poppy_sessions" ADD CONSTRAINT "poppy_sessions_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "app"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."poppy_sessions" ADD CONSTRAINT "poppy_sessions_client_id_poppy_clients_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "app"."poppy_clients"("client_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "poppy_replays_expiry_idx" ON "app"."poppy_replays" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "poppy_session_tokens_session_idx" ON "app"."poppy_session_tokens" USING btree ("school_id","session_id");--> statement-breakpoint
CREATE INDEX "poppy_session_tokens_expiry_idx" ON "app"."poppy_session_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "poppy_sessions_client_created_idx" ON "app"."poppy_sessions" USING btree ("client_id","created_at");