SET local check_function_bodies = off;

DROP POLICY "email_deliveries_owner_trigger_insert" ON "public"."email_deliveries";

DROP POLICY "funnel_events_owner_trigger_insert" ON "public"."funnel_events";

DROP POLICY "trial_occurrences_owner_trigger_update" ON "public"."trial_occurrences";

CREATE OR REPLACE FUNCTION public.update_school_agent (
  p_school_id          uuid,
  p_welcome_message    text,
  p_agent_instructions text
)
  RETURNS void
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
BEGIN
    UPDATE public.school_settings SET agent_instructions = nullif(p_agent_instructions, '')
    WHERE school_id = p_school_id AND owner_user_id = (SELECT auth.uid());
    IF NOT FOUND THEN RAISE EXCEPTION 'school_not_found' USING ERRCODE = '42501'; END IF;
    UPDATE public.school_profiles SET welcome_message = nullif(p_welcome_message, '') WHERE school_id = p_school_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'school_profile_missing'; END IF;
END;
$function$;

CREATE POLICY "email_deliveries_owner_trigger_insert" ON "public"."email_deliveries"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (((pg_trigger_depth() > 0) AND (pg_my_temp_schema() = (0)::oid) AND (school_id = ( SELECT school_settings.school_id
   FROM public.school_settings
  WHERE (school_settings.owner_user_id = ( SELECT auth.uid() AS uid))))));

CREATE POLICY "funnel_events_owner_trigger_insert" ON "public"."funnel_events"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (((pg_trigger_depth() > 0) AND (pg_my_temp_schema() = (0)::oid) AND (school_id = ( SELECT school_settings.school_id
   FROM public.school_settings
  WHERE (school_settings.owner_user_id = ( SELECT auth.uid() AS uid))))));

CREATE POLICY "trial_occurrences_owner_trigger_update" ON "public"."trial_occurrences"
  FOR UPDATE
  TO "authenticated"
  USING (((pg_trigger_depth() > 0) AND (pg_my_temp_schema() = (0)::oid) AND (school_id = ( SELECT school_settings.school_id
   FROM public.school_settings
  WHERE (school_settings.owner_user_id = ( SELECT auth.uid() AS uid))))))
  WITH CHECK (((pg_trigger_depth() > 0) AND (pg_my_temp_schema() = (0)::oid) AND (school_id = ( SELECT school_settings.school_id
   FROM public.school_settings
  WHERE (school_settings.owner_user_id = ( SELECT auth.uid() AS uid))))));
