-- app is private, not exposed by api.schemas. Existing history has no RLS or
-- policies; do not replace its server-only access model during this conversion.
-- Run schema-wide revokes after every table exists.
REVOKE ALL ON SCHEMA app FROM PUBLIC;
REVOKE ALL ON SCHEMA app FROM anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA app FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE ALL ON TABLES FROM anon, authenticated;
