CREATE TABLE public.whatsapp_jobs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    school_id uuid
        CONSTRAINT whatsapp_jobs_school_id_fk REFERENCES public.schools(id) ON DELETE SET NULL,
    phone_number_id text NOT NULL,
    dedupe_key text NOT NULL
        CONSTRAINT whatsapp_jobs_dedupe_key UNIQUE,
    kind text DEFAULT 'inbound_message' NOT NULL,
    payload jsonb NOT NULL,
    state public.whatsapp_job_state DEFAULT 'pending' NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    next_attempt_at timestamp with time zone DEFAULT now() NOT NULL,
    claimed_at timestamp with time zone,
    claimed_by text,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    failure_reason text,
    terminal_cause text
);

CREATE INDEX whatsapp_jobs_due_idx ON public.whatsapp_jobs USING btree (state, next_attempt_at);

CREATE TRIGGER whatsapp_jobs_set_updated_at
BEFORE UPDATE ON public.whatsapp_jobs
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.whatsapp_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.whatsapp_jobs FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.whatsapp_jobs to authenticated;

CREATE POLICY whatsapp_jobs_select_own_school
on public.whatsapp_jobs
FOR SELECT
TO authenticated
USING (
    school_id = (
        SELECT s.id
        FROM public.schools s
        WHERE s.owner_user_id = auth.uid()
    )
);
