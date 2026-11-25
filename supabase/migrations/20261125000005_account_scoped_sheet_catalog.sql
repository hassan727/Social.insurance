-- Forward migration: account-scoped sheet catalog (bounded repair; user
-- confirmed 2026-11-25 12:32 EET that each company has ONE workbook with
-- stable worksheet names, re-uploaded after edits: "لا لا نفس الورقه هي هي
-- لنفس الشركه ... هراعها تاني زي ما هي بنفس المسمي ، وكذلك الامر لمودرن").
--
-- dynamic_sheets was GLOBAL (unique sheet_name across all accounts): one
-- account's upload overwrote the shared column mapping every account's
-- matching relied on, and the merge precedence flag was cross-account
-- mutable. Source identity is now (account_id, sheet name) using the
-- existing company_accounts.id. No filename dependence.
--
-- Fail-closed legacy handling: a legacy global sheet is grounded to an
-- account ONLY when every sheet_data row under it belongs to employees of
-- exactly ONE account. Sheets with rows in multiple accounts (or no rows)
-- stay account_id NULL = shared/legacy and are listed for REVIEW; nothing
-- is split or assigned by guessing.

ALTER TABLE public.dynamic_sheets
  ADD COLUMN IF NOT EXISTS account_id INTEGER REFERENCES public.company_accounts(id);

-- Grounded backfill: single-account usage only.
UPDATE public.dynamic_sheets ds
SET account_id = sub.acc
FROM (
    SELECT sd.sheet_id, COUNT(DISTINCT em.account_id) AS naccs,
           (ARRAY_AGG(DISTINCT em.account_id))[1] AS acc
    FROM sheet_data sd
    JOIN employees_master em ON em.id = sd.employee_id
    WHERE em.account_id IS NOT NULL
    GROUP BY sd.sheet_id
) sub
WHERE ds.id = sub.sheet_id AND sub.naccs = 1 AND ds.account_id IS NULL;

-- Review list: shared/legacy sheets that could NOT be grounded (multi-account
-- or no data). Surfaced as notices, never auto-assigned.
DO $$
DECLARE r RECORD;
BEGIN
    FOR r IN
        SELECT ds.sheet_name, COUNT(DISTINCT em.account_id) AS naccs
        FROM dynamic_sheets ds
        LEFT JOIN sheet_data sd ON sd.sheet_id = ds.id
        LEFT JOIN employees_master em ON em.id = sd.employee_id
        WHERE ds.account_id IS NULL
        GROUP BY ds.sheet_name
    LOOP
        RAISE NOTICE 'dynamic_sheets "%" left SHARED (account_id NULL, distinct accounts: %) — needs review', r.sheet_name, r.naccs;
    END LOOP;
END;
$$;

-- Replace the global sheet_name uniqueness with per-account uniqueness.
-- (COALESCE(account_id, 0) keeps shared/legacy rows unique among themselves.)
ALTER TABLE public.dynamic_sheets DROP CONSTRAINT IF EXISTS dynamic_sheets_sheet_name_key;
DROP INDEX IF EXISTS public.idx_dynamic_sheets_account_name;
-- Scoped to real accounts only: shared/legacy (NULL) rows are review items
-- and must not be able to break the upgrade by colliding with each other.
CREATE UNIQUE INDEX idx_dynamic_sheets_account_name
    ON public.dynamic_sheets (account_id, lower(btrim(sheet_name)))
    WHERE account_id IS NOT NULL;
