ALTER TYPE "app"."channel" ADD VALUE 'poppy';--> statement-breakpoint
ALTER TYPE "app"."conversation_end_reason" ADD VALUE 'closed';--> statement-breakpoint
CREATE TABLE "app"."poppy_conversation_events" (
	"id" text PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"event" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "poppy_events_conversation_sequence" UNIQUE("conversation_id","sequence")
);
--> statement-breakpoint
ALTER TABLE "app"."poppy_conversation_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "app"."poppy_conversation_messages" (
	"key" text PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"message" jsonb NOT NULL,
	"context" jsonb NOT NULL,
	"sequence" integer NOT NULL,
	"response" jsonb,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."poppy_conversation_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "app"."conversations" ADD COLUMN "poppy_client_id" text;--> statement-breakpoint
ALTER TABLE "app"."conversations" ADD COLUMN "poppy_user_id" text;--> statement-breakpoint
ALTER TABLE "app"."conversations" ADD COLUMN "poppy_context" jsonb;--> statement-breakpoint
ALTER TABLE "app"."conversations" ADD COLUMN "poppy_status" text DEFAULT 'idle' NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."conversations" ADD COLUMN "poppy_event_sequence" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."poppy_conversation_events" ADD CONSTRAINT "poppy_events_conversation_fk" FOREIGN KEY ("school_id","conversation_id") REFERENCES "app"."conversations"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."poppy_conversation_messages" ADD CONSTRAINT "poppy_messages_conversation_fk" FOREIGN KEY ("school_id","conversation_id") REFERENCES "app"."conversations"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."poppy_conversation_messages" ADD CONSTRAINT "poppy_messages_session_fk" FOREIGN KEY ("school_id","session_id") REFERENCES "app"."poppy_sessions"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "poppy_messages_pending" ON "app"."poppy_conversation_messages" USING btree ("conversation_id","sequence") WHERE "app"."poppy_conversation_messages"."completed_at" IS NULL;--> statement-breakpoint
ALTER TABLE "app"."conversations" ADD CONSTRAINT "conversations_poppy_client_id_poppy_clients_client_id_fk" FOREIGN KEY ("poppy_client_id") REFERENCES "app"."poppy_clients"("client_id") ON DELETE no action ON UPDATE no action;