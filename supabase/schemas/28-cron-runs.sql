CREATE TABLE public.cron_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    reminder_count integer DEFAULT 0 NOT NULL,
    sent_count integer DEFAULT 0 NOT NULL,
    failed_count integer DEFAULT 0 NOT NULL,
    result public.cron_result,
    error_summary text,
    ended_conversation_count integer DEFAULT 0 NOT NULL
);

ALTER TABLE public.cron_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cron_runs FROM PUBLIC, anon, authenticated, service_role;
