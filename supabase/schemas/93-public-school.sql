-- The landing profile is deliberately narrower than schools + school_settings.
-- Notification addresses, owner IDs, WhatsApp IDs and owner instructions remain private.
CREATE FUNCTION public.get_landing_school(p_slug text, p_preview boolean DEFAULT false)
RETURNS TABLE (
    id uuid, slug text, timezone text, approved_at timestamptz, published_at timestamptz,
    name text, phone text, website text, address text, country text, city text,
    parking_notes text, access_notes text, trial_guidance text, pricing text,
    welcome_message text, logo_url text, primary_color text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT s.id, s.slug, s.timezone, s.approved_at, s.published_at,
           p.name, p.phone, p.website, p.address, p.country, p.city,
           p.parking_notes, p.access_notes, p.trial_guidance, p.pricing,
           p.welcome_message, p.logo_url, p.primary_color
    FROM public.schools s
    JOIN public.school_settings p ON p.school_id = s.id
    WHERE s.slug = p_slug
      AND (
          (s.approved_at IS NOT NULL AND s.published_at IS NOT NULL)
          OR (p_preview AND s.owner_user_id = (SELECT auth.uid()))
      );
$$;

-- RLS cannot inspect private schools rows as anon. This predicate exposes only
-- whether a school is public or belongs to the current verified user.
CREATE FUNCTION public.can_read_school_catalog(p_school_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.schools s
        WHERE s.id = p_school_id
          AND ((s.approved_at IS NOT NULL AND s.published_at IS NOT NULL)
               OR s.owner_user_id = (SELECT auth.uid()))
    );
$$;

REVOKE ALL ON FUNCTION public.get_landing_school(text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.can_read_school_catalog(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_landing_school(text, boolean) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.can_read_school_catalog(uuid) TO anon, authenticated;

GRANT SELECT ON public.trial_offerings, public.trial_windows, public.trial_occurrences, public.faqs TO anon;

-- Existing owner policies continue to allow inactive rows in previews/settings.
CREATE POLICY trial_offerings_public_read ON public.trial_offerings
FOR SELECT TO anon, authenticated
USING (active AND (SELECT public.can_read_school_catalog(school_id)));

CREATE POLICY trial_windows_public_read ON public.trial_windows
FOR SELECT TO anon, authenticated
USING (
    active AND (SELECT public.can_read_school_catalog(school_id))
    AND EXISTS (SELECT 1 FROM public.trial_offerings o WHERE o.id = trial_offering_id AND o.active)
);

CREATE POLICY trial_occurrences_public_read ON public.trial_occurrences
FOR SELECT TO anon, authenticated
USING (
    (SELECT public.can_read_school_catalog(school_id))
    AND EXISTS (SELECT 1 FROM public.trial_windows w WHERE w.id = trial_window_id AND w.active)
);

CREATE POLICY faqs_public_read ON public.faqs
FOR SELECT TO anon, authenticated
USING ((SELECT public.can_read_school_catalog(school_id)));
