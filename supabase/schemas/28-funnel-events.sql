CREATE TABLE public.funnel_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    school_id uuid NOT NULL
        CONSTRAINT funnel_events_school_id_fk REFERENCES public.schools(id) ON DELETE CASCADE,
    landing_session_id uuid,
    conversation_id uuid,
    booking_id uuid,
    lead_id uuid,
    event_type text NOT NULL,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

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
        SELECT s.school_id
        FROM public.school_settings s
        WHERE s.owner_user_id = auth.uid()
    )
);

GRANT INSERT (school_id, booking_id, landing_session_id, conversation_id, event_type, metadata)
ON public.funnel_events TO authenticated;
CREATE POLICY funnel_events_owner_trigger_insert ON public.funnel_events
FOR INSERT TO authenticated
WITH CHECK (pg_catalog.pg_trigger_depth() > 0 AND pg_catalog.pg_my_temp_schema() = 0 AND school_id = (
    SELECT school_id FROM public.school_settings WHERE owner_user_id = (SELECT auth.uid())
));
