CREATE TABLE public.funnel_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    school_id uuid NOT NULL,
    landing_session_id uuid,
    conversation_id uuid,
    booking_id uuid,
    lead_id uuid,
    event_type text NOT NULL,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.funnel_events ADD CONSTRAINT funnel_events_school_id_fk FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;

CREATE INDEX funnel_events_school_created_idx ON public.funnel_events USING btree (school_id, created_at);

ALTER TABLE public.funnel_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.funnel_events FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.funnel_events to authenticated;

CREATE POLICY funnel_events_select_own_school
on public.funnel_events
FOR SELECT
TO authenticated
USING (
    school_id = (
        SELECT s.id
        FROM public.schools s
        WHERE s.owner_user_id = auth.uid()
    )
);
