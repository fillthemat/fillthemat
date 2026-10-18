-- Preserve 0000's invoker function and trigger, including its original body.
CREATE FUNCTION app.prevent_published_school_identity_change()
RETURNS trigger AS $$
BEGIN
  IF OLD.published_at IS NOT NULL THEN
    IF NEW.slug IS DISTINCT FROM OLD.slug OR NEW.timezone IS DISTINCT FROM OLD.timezone THEN
      RAISE EXCEPTION 'slug and timezone are immutable after publish';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER schools_identity_immutable
  BEFORE UPDATE ON app.schools
  FOR EACH ROW
  EXECUTE FUNCTION app.prevent_published_school_identity_change();

-- app is private, not exposed by api.schemas. Existing history has no RLS or
-- policies; do not replace its server-only access model during this conversion.
REVOKE ALL ON SCHEMA app FROM PUBLIC;
REVOKE ALL ON SCHEMA app FROM anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA app FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE ALL ON TABLES FROM anon, authenticated;
