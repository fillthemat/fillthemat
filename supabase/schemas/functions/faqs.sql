-- The trigger covers direct inserts as well as the convenience RPC. Locking
-- private settings serializes all inserts for a school before counting.
CREATE FUNCTION public.enforce_faq_limit()
RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
    PERFORM 1 FROM public.school_settings WHERE school_id = NEW.school_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'school_not_found' USING ERRCODE = '42501'; END IF;
    IF (SELECT count(*) FROM public.faqs WHERE school_id = NEW.school_id) >= 20 THEN
        RAISE EXCEPTION 'faq_limit_reached' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE FUNCTION public.create_settings_faq(p_school_id uuid, p_question text, p_answer text)
RETURNS SETOF public.faqs
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
    PERFORM 1 FROM public.school_settings
    WHERE school_id = p_school_id AND owner_user_id = (SELECT auth.uid()) FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'school_not_found' USING ERRCODE = '42501'; END IF;
    RETURN QUERY INSERT INTO public.faqs (school_id, question, answer, sort_order)
    VALUES (p_school_id, p_question, p_answer, (SELECT count(*)::integer FROM public.faqs WHERE school_id = p_school_id))
    RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_faq_limit() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_settings_faq(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_settings_faq(uuid, text, text) TO authenticated;
