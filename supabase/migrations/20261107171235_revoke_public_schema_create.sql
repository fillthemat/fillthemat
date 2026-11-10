-- Safeguard, not a missing grant: fresh Supabase stacks (Postgres 15+) already deny
-- CREATE on public to API roles. Databases upgraded from Postgres 14 or earlier can
-- keep the old PUBLIC CREATE default. pg-delta does not emit schema-level privileges
-- from 00-public.sql, so this migration states the intent. Trigger-only write
-- policies rely on API roles being unable to install objects.
REVOKE CREATE ON SCHEMA public FROM PUBLIC, anon, authenticated;
