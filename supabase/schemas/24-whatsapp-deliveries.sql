CREATE TABLE public.whatsapp_deliveries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    school_id uuid NOT NULL
        CONSTRAINT whatsapp_deliveries_school_id_fk REFERENCES public.schools(id) ON DELETE CASCADE,
    booking_id uuid,
    lead_id uuid,
    recipient_wa_id text NOT NULL,
    phone_number_id text NOT NULL,
    provider_idempotency_key text NOT NULL
        CONSTRAINT whatsapp_deliveries_provider_key UNIQUE,
    state public.whatsapp_delivery_state DEFAULT 'pending' NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    provider_id text,
    template_name text,
    template_params jsonb,
    window_expires_at timestamp with time zone,
    next_attempt_at timestamp with time zone DEFAULT now() NOT NULL,
    sent_at timestamp with time zone,
    claimed_at timestamp with time zone,
    claimed_by text,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    body text,
    status_at timestamp with time zone,
    interactive_buttons jsonb,
    failure_reason text,
    failure_code integer,
    terminal_cause text,
    send_outcome public.whatsapp_send_outcome,
    CONSTRAINT whatsapp_deliveries_booking_fk FOREIGN KEY (school_id, booking_id) REFERENCES public.bookings(school_id, id) ON DELETE CASCADE,
    CONSTRAINT whatsapp_deliveries_lead_fk FOREIGN KEY (school_id, lead_id) REFERENCES public.leads(school_id, id) ON DELETE CASCADE
);

CREATE INDEX whatsapp_deliveries_due_idx ON public.whatsapp_deliveries USING btree (state, next_attempt_at);

CREATE TRIGGER whatsapp_deliveries_set_updated_at
BEFORE UPDATE ON public.whatsapp_deliveries
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.whatsapp_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.whatsapp_deliveries FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.whatsapp_deliveries to authenticated;

CREATE POLICY whatsapp_deliveries_select_own_school
on public.whatsapp_deliveries
FOR SELECT
TO authenticated
USING (
    school_id = (
        SELECT s.school_id
        FROM public.school_settings s
        WHERE s.owner_user_id = auth.uid()
    )
);
