-- Only executed by the disposable parity checker, not an application migration.
DO $$
DECLARE
  t record;
  r text;
  privilege text;
BEGIN
  IF (SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'unrelated') <> 19 THEN
    RAISE EXCEPTION 'Expected 19 public copies';
  END IF;
  FOR t IN SELECT c.oid, c.relname, c.relrowsecurity, c.relforcerowsecurity
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> 'unrelated'
  LOOP
    IF NOT t.relrowsecurity OR t.relforcerowsecurity THEN
      RAISE EXCEPTION 'Unexpected RLS flags on %', t.relname;
    END IF;
    IF EXISTS (SELECT FROM pg_policy WHERE polrelid = t.oid) THEN
      RAISE EXCEPTION 'Unexpected policy on %', t.relname;
    END IF;
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'public_probe'] LOOP
      FOREACH privilege IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] LOOP
        IF has_table_privilege(r, t.oid, privilege) THEN
          RAISE EXCEPTION '% has % on %', r, privilege, t.relname;
        END IF;
      END LOOP;
      FOREACH privilege IN ARRAY ARRAY['SELECT','INSERT','UPDATE','REFERENCES'] LOOP
        IF has_any_column_privilege(r, t.oid, privilege) THEN
          RAISE EXCEPTION '% has column % on %', r, privilege, t.relname;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'public_probe'] LOOP
    IF has_function_privilege(r, 'public.prevent_published_school_identity_change()', 'EXECUTE') THEN
      RAISE EXCEPTION '% can execute public identity function', r;
    END IF;
  END LOOP;
  -- Object-scoped revokes must not change unrelated public objects or its schema ACL.
  IF NOT has_table_privilege('anon', 'public.unrelated', 'SELECT')
     OR NOT has_schema_privilege('public_probe', 'public', 'USAGE') THEN
    RAISE EXCEPTION 'Unrelated public access was changed';
  END IF;
END $$;
