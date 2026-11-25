-- =============================================================================
-- REVERSAL of 20261125000006_transfer_effective_dating.sql
-- NOT a migration — never place inside supabase/migrations/. Run manually.
--
-- Order required by the deploy contract: application CODE is rolled back
-- FIRST (so nothing calls these functions/columns), THEN this script.
--
-- Data honesty:
--   * BEFORE any transfer/correction events exist (employee_history rows with
--     effective_date / confirmed_by / the two new change_types), this reversal
--     is fully data-intact.
--   * AFTER such events exist, dropping the columns would LOSE the effective
--     dates and provenance. Step 1 therefore archives every affected row into
--     public.employee_history_provenance_archive FIRST. VERIFY AND EXPORT that
--     table before treating the reversal as complete — the archive is the only
--     surviving copy of the dates/provenance afterward.
--   * employees_master snapshots are NOT touched: the current-company snapshot
--     stays exactly as it was; only the event metadata is archived.
-- =============================================================================

BEGIN;

-- ── Step 1: preserve date + provenance (idempotent; skips cleanly when there
-- is nothing to preserve). Full rows, not just the two columns, so the event
-- context (from/to, reason, import link) survives with them.
CREATE TABLE IF NOT EXISTS public.employee_history_provenance_archive (
    archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    id UUID,
    employee_id UUID,
    change_type TEXT,
    from_company_account TEXT,
    to_company_account TEXT,
    change_reason TEXT,
    notes TEXT,
    confirmed_by TEXT,
    effective_date DATE,
    import_id UUID,
    created_at TIMESTAMPTZ
);
-- Guarded so a second run (columns already dropped) is a clean no-op.
DO $guard$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'employee_history' AND column_name = 'effective_date'
    ) THEN
        EXECUTE $ins$
            INSERT INTO public.employee_history_provenance_archive
                (id, employee_id, change_type, from_company_account, to_company_account,
                 change_reason, notes, confirmed_by, effective_date, import_id, created_at)
            SELECT h.id, h.employee_id, h.change_type, h.from_company_account, h.to_company_account,
                   h.change_reason, h.notes, h.confirmed_by, h.effective_date, h.import_id, h.created_at
            FROM public.employee_history h
            WHERE (h.effective_date IS NOT NULL
                   OR h.confirmed_by IS NOT NULL
                   OR h.change_type IN ('account_transfer', 'stamp_correction'))
              AND NOT EXISTS (
                    SELECT 1 FROM public.employee_history_provenance_archive a WHERE a.id = h.id
              )
        $ins$;
    END IF;
END
$guard$;

-- ── Step 2: drop the five functions (their GRANT/REVOKE entries die with
-- them — function ACLs do not outlive the function, so no separate privilege
-- cleanup is needed; the anon/authenticated surface returns to its pre-06
-- state because 06 introduced every one of these functions).
DROP FUNCTION IF EXISTS public.confirm_account_transfer(UUID, TEXT, DATE, TEXT, TEXT, TEXT, TEXT, TEXT, UUID);
DROP FUNCTION IF EXISTS public.apply_due_company_transfers(UUID);
DROP FUNCTION IF EXISTS public.resolve_current_company(UUID, DATE);
DROP FUNCTION IF EXISTS public.compute_account_employee_uid(TEXT, TEXT, TEXT, UUID);
DROP FUNCTION IF EXISTS public.canonical_company_text(TEXT);

-- ── Step 3: drop the index and the two columns (the index would drop with
-- the column anyway; named explicitly so the intent is visible).
DROP INDEX IF EXISTS public.idx_employee_history_effective;
ALTER TABLE public.employee_history
    DROP COLUMN IF EXISTS effective_date,
    DROP COLUMN IF EXISTS confirmed_by;

COMMIT;

-- ── Step 4 (manual, REQUIRED after events existed): verify and export
--   SELECT count(*) FROM public.employee_history_provenance_archive;
-- Export it (CSV dump) to durable storage. Only after that export may the
-- archive table itself be dropped, if ever.
