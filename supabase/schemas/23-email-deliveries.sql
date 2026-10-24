CREATE TABLE public.email_deliveries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    school_id uuid NOT NULL
        CONSTRAINT email_deliveries_school_id_fk REFERENCES public.schools(id) ON DELETE CASCADE,
    booking_id uuid,
    lead_id uuid,
    kind public.email_kind NOT NULL,
    recipient text NOT NULL,
    provider_idempotency_key text NOT NULL
        CONSTRAINT email_deliveries_provider_key UNIQUE,
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
    CONSTRAINT email_deliveries_booking_fk FOREIGN KEY (school_id, booking_id) REFERENCES public.bookings(school_id, id) ON DELETE CASCADE,
    CONSTRAINT email_deliveries_lead_fk FOREIGN KEY (school_id, lead_id) REFERENCES public.leads(school_id, id) ON DELETE CASCADE
);

CREATE INDEX email_deliveries_due_idx ON public.email_deliveries USING btree (state, next_attempt_at);

CREATE TRIGGER email_deliveries_set_updated_at
BEFORE UPDATE ON public.email_deliveries
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.email_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.email_deliveries FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.email_deliveries to authenticated;

CREATE POLICY email_deliveries_select_own_school
on public.email_deliveries
FOR SELECT
TO authenticated
USING (
    school_id = (
        SELECT s.school_id
        FROM public.school_settings s
        WHERE s.owner_user_id = auth.uid()
    )
);

GRANT INSERT (school_id, booking_id, kind, recipient, provider_idempotency_key)
ON public.email_deliveries TO authenticated;
CREATE POLICY email_deliveries_owner_trigger_insert ON public.email_deliveries
FOR INSERT TO authenticated
WITH CHECK (pg_catalog.pg_trigger_depth() > 0 AND pg_catalog.pg_my_temp_schema() = 0 AND school_id = (
    SELECT school_id FROM public.school_settings WHERE owner_user_id = (SELECT auth.uid())
));
