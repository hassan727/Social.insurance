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
--   * This changes PRIVILEGES ONLY. No data, no table shapes, no triggers.
--   * The session gate itself lives in middleware.ts + the service client;
--     this file is the database half. Neither half alone closes the hole:
--     revokes without the service client would break the app; the service
--     client without the revokes would leave the direct path open.
--   * Trigger functions execute with the triggering user's rights; the only
--     triggering user left is service_role, which keeps EXECUTE.
--   * REVERSAL: re-granting the old posture is a SECURITY downgrade. If ever
--     required, re-run the historical GRANT lines deliberately and say so;
--     there is no casual "down" for this file.
--   * Future migrations that create tables/functions must repeat this
--     pattern (Postgres default privileges still hand EXECUTE to PUBLIC and
--     the platform's default table grants to anon/authenticated on new
--     objects). The revocation below covers everything that exists NOW.
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
