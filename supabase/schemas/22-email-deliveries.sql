CREATE TABLE public.email_deliveries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    school_id uuid NOT NULL,
    booking_id uuid,
    lead_id uuid,
    kind public.email_kind NOT NULL,
    recipient text NOT NULL,
    provider_idempotency_key text NOT NULL,
    state public.email_state DEFAULT 'pending' NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    provider_id text,
    last_error text,
    next_attempt_at timestamp with time zone DEFAULT now() NOT NULL,
    sent_at timestamp with time zone,
    claimed_at timestamp with time zone,
    claimed_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    failure_reason text,
    terminal_cause text,
    CONSTRAINT email_deliveries_provider_key UNIQUE (provider_idempotency_key)
);

ALTER TABLE public.email_deliveries ADD CONSTRAINT email_deliveries_school_id_fk FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;
ALTER TABLE public.email_deliveries ADD CONSTRAINT email_deliveries_booking_fk FOREIGN KEY (school_id, booking_id) REFERENCES public.bookings(school_id, id) ON DELETE CASCADE;
ALTER TABLE public.email_deliveries ADD CONSTRAINT email_deliveries_lead_fk FOREIGN KEY (school_id, lead_id) REFERENCES public.leads(school_id, id) ON DELETE CASCADE;

CREATE INDEX email_deliveries_due_idx ON public.email_deliveries USING btree (state, next_attempt_at);

ALTER TABLE public.email_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.email_deliveries FROM PUBLIC, anon, authenticated, service_role;
