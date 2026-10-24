SET local check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.can_read_school_catalog (
  p_school_id uuid
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
    SELECT EXISTS (
        SELECT 1 FROM public.schools s
        WHERE s.id = p_school_id
          AND ((s.approved_at IS NOT NULL AND s.published_at IS NOT NULL)
               OR s.owner_user_id = (SELECT auth.uid()))
    );
$function$;

CREATE OR REPLACE FUNCTION public.get_landing_school (
  p_slug    text,
  p_preview boolean DEFAULT false
)
  RETURNS TABLE (
    id              uuid,
    slug            text,
    timezone        text,
    approved_at     timestamp with time zone,
    published_at    timestamp with time zone,
    name            text,
    phone           text,
    website         text,
    address         text,
    country         text,
    city            text,
    parking_notes   text,
    access_notes    text,
    trial_guidance  text,
    pricing         text,
    welcome_message text,
    logo_url        text,
    primary_color   text
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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
$function$;

CREATE POLICY "faqs_public_read" ON "public"."faqs"
  FOR SELECT
  TO "anon", "authenticated"
  USING (( SELECT public.can_read_school_catalog(faqs.school_id) AS can_read_school_catalog));

CREATE POLICY "trial_occurrences_public_read" ON "public"."trial_occurrences"
  FOR SELECT
  TO "anon", "authenticated"
  USING ((( SELECT public.can_read_school_catalog(trial_occurrences.school_id) AS can_read_school_catalog) AND (EXISTS ( SELECT 1
   FROM public.trial_windows w
  WHERE ((w.id = trial_occurrences.trial_window_id) AND w.active)))));

CREATE POLICY "trial_offerings_public_read" ON "public"."trial_offerings"
  FOR SELECT
  TO "anon", "authenticated"
  USING ((active AND ( SELECT public.can_read_school_catalog(trial_offerings.school_id) AS can_read_school_catalog)));

CREATE POLICY "trial_windows_public_read" ON "public"."trial_windows"
  FOR SELECT
  TO "anon", "authenticated"
  USING ((active AND ( SELECT public.can_read_school_catalog(trial_windows.school_id) AS can_read_school_catalog) AND (EXISTS ( SELECT 1
   FROM public.trial_offerings o
  WHERE ((o.id = trial_windows.trial_offering_id) AND o.active)))));

REVOKE ALL ON FUNCTION "public"."can_read_school_catalog"(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."can_read_school_catalog"(uuid) TO "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."can_read_school_catalog"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."can_read_school_catalog"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."can_read_school_catalog"(uuid) TO "service_role";

REVOKE ALL ON FUNCTION "public"."get_landing_school"(text, boolean) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."get_landing_school"(text, boolean) TO "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."get_landing_school"(text, boolean) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."get_landing_school"(text, boolean) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."get_landing_school"(text, boolean) TO "service_role";

REVOKE ALL ON TABLE "public"."faqs" FROM "anon";

GRANT SELECT ON TABLE "public"."faqs" TO "anon";

REVOKE ALL ON TABLE "public"."trial_occurrences" FROM "anon";

GRANT SELECT ON TABLE "public"."trial_occurrences" TO "anon";

REVOKE ALL ON TABLE "public"."trial_offerings" FROM "anon";

GRANT SELECT ON TABLE "public"."trial_offerings" TO "anon";

REVOKE ALL ON TABLE "public"."trial_windows" FROM "anon";

GRANT SELECT ON TABLE "public"."trial_windows" TO "anon";
