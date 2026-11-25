-- =============================================================================
-- 20261125000007_lockdown_direct_db_access.sql
--
-- Close the direct database access path. Before this migration the public
-- anon key (shipped to every browser) could read AND write every application
-- table through PostgREST with no session at all. After it, the database
-- itself refuses: anon and authenticated hold NO table, sequence, or
-- function privileges. The only data path left is the Next.js server, behind
-- the middleware session gate, using the server-only service credential.
--
-- Scope honesty:
--   * This changes PRIVILEGES ONLY, plus one enforcement mechanism for
--     future objects (a lockdown function + event trigger at the bottom).
--     No data, no table shapes, no row-level triggers.
--   * Views are covered (ALL TABLES includes views; this schema has three,
--     no materialized views, and no SECURITY DEFINER functions — verified).
--   * The session gate itself lives in middleware.ts + the service client;
--     this file is the database half. Neither half alone closes the hole:
--     revokes without the service client would break the app; the service
--     client without the revokes would leave the direct path open.
--   * Trigger functions execute with the triggering user's rights; the only
--     triggering user left is service_role, which keeps EXECUTE.
--   * REVERSAL: re-granting the old posture is a SECURITY downgrade. If ever
--     required, re-run the historical GRANT lines deliberately and say so;
--     there is no casual "down" for this file.
--   * Future objects: the REVOKE/GRANT statements cover everything that
--     exists NOW. FUTURE objects are enforced two ways (see bottom):
--     default privileges (bound to the migration-runner role) and an EVENT
--     TRIGGER that re-applies the locked posture to every new table,
--     sequence, view, and function in schema public no matter which role
--     creates it. The trigger is the load-bearing half: Postgres merges the
--     built-in PUBLIC EXECUTE into any non-empty default-privilege grant
--     (verified empirically), so default privileges alone CANNOT keep a
--     future function both closed to PUBLIC and open to service_role.
--     Creating the event trigger needs superuser; the migration runner
--     (postgres via supabase db push / dashboard SQL) has it.
-- =============================================================================

-- Tables: no direct reads or writes for the public roles
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
-- Sequences: no direct id generation
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
-- Functions: no direct RPC at all (the mutating transfer functions were
-- already service_role-only under 20261125000006; this closes the rest,
-- including the PUBLIC default every Postgres function starts with)
REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;

-- The trusted server identity keeps full access
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- Close the FUTURE, not just the present. Layer one: default privileges,
-- which bind to the role executing this statement — the same migration-runner
-- role that applies every future migration (supabase db push / dashboard SQL
-- as postgres). Tables and sequences get revoke + service grant (no built-in
-- PUBLIC default exists for them, so both fit). Functions get REVOKE ONLY:
-- granting EXECUTE to service_role here would resurrect the built-in PUBLIC
-- EXECUTE (Postgres merges it into any non-empty default-privilege entry),
-- so the function grant to service_role comes from the event trigger below.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO service_role;

-- Layer two: an event trigger that enforces the locked posture on every new
-- object in schema public, whichever role creates it (default privileges only
-- bind to one role). Runs at ddl_command_end inside the creating transaction,
-- so the locked state is what ever commits. If the trigger is ever dropped,
-- new objects fail CLOSED (no service_role access -> visible errors), never
-- silently open. A later migration that deliberately grants a role can still
-- do so — its GRANT runs after this trigger for its own objects.
CREATE OR REPLACE FUNCTION public.lockdown_enforce_new_object_privileges()
RETURNS event_trigger LANGUAGE plpgsql AS $lockdown$
DECLARE obj record;
BEGIN
  FOR obj IN SELECT * FROM pg_event_trigger_ddl_commands() WHERE schema_name = 'public' LOOP
    IF obj.object_type = 'table' THEN
      EXECUTE format('REVOKE ALL ON TABLE %s FROM PUBLIC, anon, authenticated', obj.object_identity);
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %s TO service_role', obj.object_identity);
    ELSIF obj.object_type = 'view' THEN
      EXECUTE format('REVOKE ALL ON TABLE %s FROM PUBLIC, anon, authenticated', obj.object_identity);
      EXECUTE format('GRANT SELECT ON TABLE %s TO service_role', obj.object_identity);
    ELSIF obj.object_type = 'sequence' THEN
      EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon, authenticated', obj.object_identity);
      EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO service_role', obj.object_identity);
    ELSIF obj.object_type IN ('function', 'procedure') THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', obj.object_identity);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', obj.object_identity);
    END IF;
  END LOOP;
END
$lockdown$;
REVOKE ALL ON FUNCTION public.lockdown_enforce_new_object_privileges() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lockdown_enforce_new_object_privileges() TO service_role;

CREATE EVENT TRIGGER lockdown_new_objects
ON ddl_command_end
WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO', 'CREATE SEQUENCE', 'CREATE VIEW', 'CREATE FUNCTION', 'CREATE PROCEDURE')
EXECUTE FUNCTION public.lockdown_enforce_new_object_privileges();
