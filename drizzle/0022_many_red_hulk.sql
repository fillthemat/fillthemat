CREATE TABLE "app"."poppy_operation_revisions" (
	"operation_id" text NOT NULL,
	"revision" integer NOT NULL,
	"summary" text NOT NULL,
	"terms" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "poppy_operation_revisions_id_revision" UNIQUE("operation_id","revision")
);
--> statement-breakpoint
ALTER TABLE "app"."poppy_operation_revisions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "app"."poppy_operations" (
	"id" text PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"conversation_id" uuid,
	"kind" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"state" text NOT NULL,
	"summary" text NOT NULL,
	"terms" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"user_approval_required" boolean DEFAULT true NOT NULL,
	"confirmation" jsonb,
	"result" jsonb,
	"booking_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "poppy_operations_school_id_id" UNIQUE("school_id","id"),
	CONSTRAINT "poppy_operations_revision" CHECK ("app"."poppy_operations"."revision" > 0),
	CONSTRAINT "poppy_operations_state" CHECK ("app"."poppy_operations"."state" IN ('proposed', 'in_progress', 'succeeded', 'failed', 'cancelled', 'expired')),
	CONSTRAINT "poppy_operations_kind" CHECK ("app"."poppy_operations"."kind" IN ('booking', 'lead'))
);
--> statement-breakpoint
ALTER TABLE "app"."poppy_operations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "app"."bookings" ADD COLUMN "poppy_client_id" text;--> statement-breakpoint
ALTER TABLE "app"."bookings" ADD COLUMN "poppy_session_id" uuid;--> statement-breakpoint
ALTER TABLE "app"."poppy_operation_revisions" ADD CONSTRAINT "poppy_operation_revisions_operation_id_poppy_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "app"."poppy_operations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."poppy_operations" ADD CONSTRAINT "poppy_operations_session_fk" FOREIGN KEY ("school_id","session_id") REFERENCES "app"."poppy_sessions"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."poppy_operations" ADD CONSTRAINT "poppy_operations_conversation_fk" FOREIGN KEY ("school_id","conversation_id") REFERENCES "app"."conversations"("school_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."poppy_operations" ADD CONSTRAINT "poppy_operations_booking_fk" FOREIGN KEY ("school_id","booking_id") REFERENCES "app"."bookings"("school_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "poppy_operations_session" ON "app"."poppy_operations" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "poppy_operations_conversation" ON "app"."poppy_operations" USING btree ("conversation_id");--> statement-breakpoint
ALTER TABLE "app"."bookings" ADD CONSTRAINT "bookings_poppy_client_id_poppy_clients_client_id_fk" FOREIGN KEY ("poppy_client_id") REFERENCES "app"."poppy_clients"("client_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."bookings" ADD CONSTRAINT "bookings_poppy_session_fk" FOREIGN KEY ("school_id","poppy_session_id") REFERENCES "app"."poppy_sessions"("school_id","id") ON DELETE restrict ON UPDATE no action;