SET local check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.create_onboarding_school (
  p_owner_user_id      uuid,
  p_owner_email        text,
  p_name               text,
  p_slug               text,
  p_timezone           text,
  p_city               text,
  p_notification_email text,
  p_self_approve       boolean DEFAULT false
)
  RETURNS text
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
DECLARE
    v_school_id uuid;
    v_constraint text;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = p_timezone) THEN
        RAISE EXCEPTION 'invalid_timezone' USING ERRCODE = '22023';
    END IF;

    -- No auth-to-public user trigger exists. The FK verifies the auth identity;
    -- the user row lock serializes concurrent onboarding for this owner.
    INSERT INTO public.users (id, email) VALUES (p_owner_user_id, p_owner_email)
    ON CONFLICT (id) DO NOTHING;
    PERFORM 1 FROM public.users WHERE id = p_owner_user_id FOR NO KEY UPDATE;
    IF EXISTS (SELECT 1 FROM public.school_settings WHERE owner_user_id = p_owner_user_id) THEN
        RETURN 'already_exists';
    END IF;

    INSERT INTO public.schools (slug, timezone, approved_at)
    VALUES (p_slug, p_timezone, CASE WHEN p_self_approve THEN now() ELSE NULL END)
    RETURNING id INTO v_school_id;
    INSERT INTO public.school_profiles (school_id, name, city)
    VALUES (v_school_id, p_name, nullif(p_city, ''));
    INSERT INTO public.school_settings (school_id, owner_user_id, notification_email)
    VALUES (v_school_id, p_owner_user_id, p_notification_email);
    RETURN 'created';
EXCEPTION WHEN unique_violation THEN
    -- The exception block rolls back every insert, including the new user row.
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    IF v_constraint = 'schools_slug_unique' THEN RETURN 'slug_taken'; END IF;
    RAISE;
END;
$function$;
