-- pg-delta does not emit schema-level privileges from 00-public.sql.
-- Trigger-only write policies rely on API roles being unable to install objects.
REVOKE CREATE ON SCHEMA public FROM PUBLIC, anon, authenticated;
