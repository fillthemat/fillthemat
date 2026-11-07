CREATE FUNCTION public.prevent_published_school_identity_change()
RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
    IF OLD.published_at IS NOT NULL AND (
        NEW.slug IS DISTINCT FROM OLD.slug OR NEW.timezone IS DISTINCT FROM OLD.timezone
        OR NEW.published_at IS DISTINCT FROM OLD.published_at
    ) THEN
        RAISE EXCEPTION 'slug, timezone and publication timestamp are immutable after publish';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = NEW.timezone) THEN
        RAISE EXCEPTION 'invalid_timezone' USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
END;
$$;

CREATE FUNCTION public.delete_school_after_account()
RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
    DELETE FROM public.schools WHERE id = OLD.school_id;
    RETURN NULL;
END;
$$;

CREATE FUNCTION public.update_school_profile(p_school_id uuid, p_slug text, p_timezone text, p_profile jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
    PERFORM 1 FROM public.school_settings
    WHERE school_id = p_school_id AND owner_user_id = (SELECT auth.uid()) FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'school_not_found' USING ERRCODE = '42501'; END IF;
    UPDATE public.schools SET slug = p_slug, timezone = p_timezone WHERE id = p_school_id;
    UPDATE public.school_settings SET notification_email = p_profile->>'notification_email'
    WHERE school_id = p_school_id;
    INSERT INTO public.school_profiles (
        school_id, name, phone, website, address, city, country,
        parking_notes, access_notes, trial_guidance
    ) VALUES (
        p_school_id, p_profile->>'name', p_profile->>'phone', p_profile->>'website',
        p_profile->>'address', p_profile->>'city', coalesce(p_profile->>'country', 'US'),
        p_profile->>'parking_notes', p_profile->>'access_notes', p_profile->>'trial_guidance'
    ) ON CONFLICT (school_id) DO UPDATE SET
        name = EXCLUDED.name, phone = EXCLUDED.phone, website = EXCLUDED.website,
        address = EXCLUDED.address, city = EXCLUDED.city, country = EXCLUDED.country,
        parking_notes = EXCLUDED.parking_notes, access_notes = EXCLUDED.access_notes,
        trial_guidance = EXCLUDED.trial_guidance;
END;
$$;

-- Agent settings span public welcome text and private owner instructions.
CREATE FUNCTION public.update_school_agent(p_school_id uuid, p_welcome_message text, p_agent_instructions text)
RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
    UPDATE public.school_settings SET agent_instructions = nullif(p_agent_instructions, '')
    WHERE school_id = p_school_id AND owner_user_id = (SELECT auth.uid());
    IF NOT FOUND THEN RAISE EXCEPTION 'school_not_found' USING ERRCODE = '42501'; END IF;
    UPDATE public.school_profiles SET welcome_message = nullif(p_welcome_message, '') WHERE school_id = p_school_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'school_profile_missing'; END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_published_school_identity_change() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_school_after_account() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_school_profile(uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_school_agent(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_school_profile(uuid, text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_school_agent(uuid, text, text) TO authenticated;

-- Platform provisioning only: the server verifies the session and supplies the
-- owner and development-only approval flag. Browser roles retain no INSERT access
-- to users, school identities or ownership settings.
CREATE FUNCTION public.create_onboarding_school(
    p_owner_user_id uuid, p_owner_email text, p_name text, p_slug text,
    p_timezone text, p_city text, p_notification_email text,
    p_self_approve boolean DEFAULT false
)
RETURNS text
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
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
$$;

REVOKE ALL ON FUNCTION public.create_onboarding_school(uuid, text, text, text, text, text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_onboarding_school(uuid, text, text, text, text, text, text, boolean) TO service_role;
