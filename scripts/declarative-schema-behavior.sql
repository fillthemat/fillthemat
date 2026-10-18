-- Disposable fixtures; all data/grants are rolled back, never copied from real users.
BEGIN;
INSERT INTO auth.users(id) VALUES
  ('00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000002');
INSERT INTO app.users(id, email) SELECT id, 'source@example.test' FROM auth.users;
INSERT INTO public.users(id, email) VALUES
  ('00000000-0000-0000-0000-000000000001', 'copy@example.test');
INSERT INTO app.schools(id, owner_user_id, slug, name, timezone, notification_email)
  VALUES ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001',
    'source', 'Source', 'UTC', 'source@example.test');
INSERT INTO public.schools(id, owner_user_id, slug, name, timezone, notification_email, published_at)
  VALUES ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001',
    'copy', 'Copy', 'UTC', 'copy@example.test', now());
DO $$ BEGIN
  BEGIN
    UPDATE public.schools SET slug = 'changed';
    RAISE EXCEPTION 'Identity trigger did not reject change';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'slug and timezone are immutable after publish' THEN RAISE; END IF;
  END;
  BEGIN
    INSERT INTO public.schools(owner_user_id, slug, name, timezone, notification_email)
      VALUES ('00000000-0000-0000-0000-000000000002', 'wrong', 'Wrong', 'UTC', 'wrong@example.test');
    RAISE EXCEPTION 'Public FK accepted an app-only user';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
END $$;

-- Even if DML grants are accidentally restored later, RLS without policies denies rows.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.users TO anon, authenticated;
DO $$ DECLARE r text; affected integer; BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    EXECUTE format('SET LOCAL ROLE %I', r);
    IF EXISTS (SELECT FROM public.users) THEN RAISE EXCEPTION 'RLS leaked rows to %', r; END IF;
    UPDATE public.users SET email = 'leak@example.test';
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 0 THEN RAISE EXCEPTION 'RLS allowed update'; END IF;
    DELETE FROM public.users;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 0 THEN RAISE EXCEPTION 'RLS allowed delete'; END IF;
    BEGIN
      INSERT INTO public.users(id, email) VALUES
        ('00000000-0000-0000-0000-000000000002', 'leak@example.test');
      RAISE EXCEPTION 'RLS allowed insert';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    RESET ROLE;
  END LOOP;
END $$;

DELETE FROM public.users;
DO $$ BEGIN
  IF EXISTS (SELECT FROM public.schools) OR (SELECT count(*) FROM app.schools) <> 1 THEN
    RAISE EXCEPTION 'Public cascade changed source data or failed';
  END IF;
END $$;
ROLLBACK;
