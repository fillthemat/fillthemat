CREATE TABLE public.trial_windows (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    school_id uuid NOT NULL
        CONSTRAINT trial_windows_school_id_fk REFERENCES public.schools(id) ON DELETE CASCADE,
    trial_offering_id uuid NOT NULL,
    day_of_week integer NOT NULL
        CONSTRAINT trial_windows_day CHECK (day_of_week BETWEEN 0 AND 6),
    start_minute integer NOT NULL
        CONSTRAINT trial_windows_start_minute CHECK (start_minute BETWEEN 0 AND 1439),
    duration_minutes integer NOT NULL
        CONSTRAINT trial_windows_duration CHECK (duration_minutes > 0),
    capacity integer NOT NULL
        CONSTRAINT trial_windows_capacity CHECK (capacity BETWEEN 1 AND 50),
    label text,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT trial_windows_school_id_id UNIQUE (school_id, id),
    CONSTRAINT trial_windows_offering_fk FOREIGN KEY (school_id, trial_offering_id) REFERENCES public.trial_offerings(school_id, id) ON DELETE CASCADE
);

CREATE TRIGGER trial_windows_set_updated_at
BEFORE UPDATE ON public.trial_windows
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.trial_windows ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.trial_windows FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.trial_windows TO anon, authenticated;
GRANT INSERT ON TABLE public.trial_windows TO authenticated;
GRANT UPDATE (active, capacity, updated_at), DELETE ON TABLE public.trial_windows TO authenticated;

CREATE POLICY trial_windows_owner_write ON public.trial_windows
FOR ALL TO authenticated
USING (school_id = (SELECT school_id FROM public.school_settings WHERE owner_user_id = (SELECT auth.uid())))
WITH CHECK (school_id = (SELECT school_id FROM public.school_settings WHERE owner_user_id = (SELECT auth.uid())));

CREATE POLICY trial_windows_select_own_school
on public.trial_windows
FOR SELECT
TO authenticated
USING (
    school_id = (
        SELECT s.school_id
        FROM public.school_settings s
        WHERE s.owner_user_id = auth.uid()
    )
);

CREATE TRIGGER trial_windows_sync_capacity
AFTER UPDATE OF capacity ON public.trial_windows
FOR EACH ROW WHEN (OLD.capacity IS DISTINCT FROM NEW.capacity)
EXECUTE FUNCTION public.sync_window_capacity();

CREATE POLICY trial_windows_public_read ON public.trial_windows
FOR SELECT TO anon, authenticated
USING (
    active AND EXISTS (
        SELECT 1 FROM public.schools s
        WHERE s.id = school_id AND s.approved_at IS NOT NULL AND s.published_at IS NOT NULL
    )
    AND EXISTS (SELECT 1 FROM public.trial_offerings o WHERE o.id = trial_offering_id AND o.active)
);
