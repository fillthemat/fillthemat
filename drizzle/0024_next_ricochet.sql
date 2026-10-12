CREATE TABLE "app"."booking_cancel_tokens" (
	"booking_id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "app"."booking_cancel_tokens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "app"."booking_cancel_tokens" ADD CONSTRAINT "booking_cancel_tokens_booking_fk" FOREIGN KEY ("school_id","booking_id") REFERENCES "app"."bookings"("school_id","id") ON DELETE cascade ON UPDATE no action;