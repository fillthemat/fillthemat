CREATE TABLE public.trial_occurrences (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    school_id uuid NOT NULL
        CONSTRAINT trial_occurrences_school_id_fk REFERENCES public.schools(id) ON DELETE CASCADE,
    trial_window_id uuid NOT NULL,
    trial_offering_id uuid NOT NULL,
    start_at timestamp with time zone NOT NULL,
    end_at timestamp with time zone NOT NULL,
    capacity integer NOT NULL
        CONSTRAINT trial_occurrences_capacity CHECK (capacity BETWEEN 1 AND 50),
    booked_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT trial_occurrences_school_id_id UNIQUE (school_id, id),
    CONSTRAINT trial_occurrences_window_start UNIQUE (trial_window_id, start_at),
    CONSTRAINT trial_occurrences_booked_count CHECK (booked_count >= 0 AND booked_count <= capacity),
    CONSTRAINT trial_occurrences_range CHECK (end_at > start_at),
    CONSTRAINT trial_occurrences_window_fk FOREIGN KEY (school_id, trial_window_id) REFERENCES public.trial_windows(school_id, id) ON DELETE RESTRICT,
    CONSTRAINT trial_occurrences_offering_fk FOREIGN KEY (school_id, trial_offering_id) REFERENCES public.trial_offerings(school_id, id) ON DELETE RESTRICT
);

CREATE TRIGGER trial_occurrences_set_updated_at
BEFORE UPDATE ON public.trial_occurrences
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.trial_occurrences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.trial_occurrences FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.trial_occurrences to authenticated;

CREATE POLICY trial_occurrences_select_own_school
on public.trial_occurrences
FOR SELECT
TO authenticated
USING (
    school_id = (
        SELECT s.id
        FROM public.schools s
        WHERE s.owner_user_id = auth.uid()
    )
);
