-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: 20261125000001_account_period_isolation.sql
-- Purpose: Close the cross-company period hole proven on 2026-11-25:
--   monthly payroll/insurance tables and import_logs carried NO account
--   identity, so an overwrite re-import for one company deleted every
--   company's rows for that period, and lookup lit months from files that
--   never contained the employee's account.
--
-- Rules enforced here:
--   * Backfill ONLY evidence-supported account mappings (exact national_id
--     join to employees_master). Anything ambiguous stays NULL = quarantined
--     for review. No inference from file name, channel name, or defaults.
--   * No silent Egypt Gas fallback anywhere.
--
-- STATUS: TEST VERSION — apply to the test database only. Production
-- application requires the user's separate approval after review.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Account identity on monthly fact tables and import logs ----------------
ALTER TABLE public.monthly_payroll_records
    ADD COLUMN IF NOT EXISTS account_id INTEGER REFERENCES public.company_accounts(id);

ALTER TABLE public.monthly_insurance_records
    ADD COLUMN IF NOT EXISTS account_id INTEGER REFERENCES public.company_accounts(id);

ALTER TABLE public.import_logs
    ADD COLUMN IF NOT EXISTS account_id INTEGER REFERENCES public.company_accounts(id);

-- 2. Evidence-supported backfill: stamp a row's account ONLY where two
-- independent sources AGREE — the master record (employees_master.account_id)
-- and the warad file's own per-row company text (incoming_insurance_records.
-- company_account, resolved through company_accounts aliases). Case 1 proved
-- master alone can be wrong (master E.G vs actual Modern), and case 2 proved
-- the payroll channel name is not the employer — so neither master alone,
-- nor warad alone, nor file names are sufficient. Any conflict, ambiguity
-- (multiple warad accounts) or missing source leaves account_id NULL:
-- quarantined for review, never guessed.
WITH warad AS (
    SELECT w.national_id,
           COUNT(DISTINCT ca.id) AS distinct_accounts,
           MIN(ca.id) AS account_id
    FROM public.incoming_insurance_records w
    JOIN public.company_accounts ca
      ON ca.account_code = UPPER(TRIM(w.company_account))
      OR TRIM(w.company_account) = ANY(ca.aliases)
      OR LOWER(TRIM(w.company_account)) = ANY(ca.aliases)
    WHERE w.national_id IS NOT NULL
      AND w.company_account IS NOT NULL
      AND TRIM(w.company_account) <> ''
    GROUP BY w.national_id
)
UPDATE public.monthly_payroll_records
SET account_id = em.account_id
FROM public.employees_master em
JOIN warad ON warad.national_id = em.national_id
WHERE monthly_payroll_records.account_id IS NULL
  AND monthly_payroll_records.national_id IS NOT NULL
  AND monthly_payroll_records.national_id = em.national_id
  AND em.account_id IS NOT NULL
  AND warad.distinct_accounts = 1
  AND warad.account_id = em.account_id;

WITH warad AS (
    SELECT w.national_id,
           COUNT(DISTINCT ca.id) AS distinct_accounts,
           MIN(ca.id) AS account_id
    FROM public.incoming_insurance_records w
    JOIN public.company_accounts ca
      ON ca.account_code = UPPER(TRIM(w.company_account))
      OR TRIM(w.company_account) = ANY(ca.aliases)
      OR LOWER(TRIM(w.company_account)) = ANY(ca.aliases)
    WHERE w.national_id IS NOT NULL
      AND w.company_account IS NOT NULL
      AND TRIM(w.company_account) <> ''
    GROUP BY w.national_id
)
UPDATE public.monthly_insurance_records
SET account_id = em.account_id
FROM public.employees_master em
JOIN warad ON warad.national_id = em.national_id
WHERE monthly_insurance_records.account_id IS NULL
  AND monthly_insurance_records.national_id IS NOT NULL
  AND monthly_insurance_records.national_id = em.national_id
  AND em.account_id IS NOT NULL
  AND warad.distinct_accounts = 1
  AND warad.account_id = em.account_id;

-- 3. import_logs backfill: only when the batch's rows resolve to exactly ONE
-- distinct account. Mixed or unresolved batches stay NULL = quarantined.
UPDATE public.import_logs
SET account_id = t.account_id
FROM (
    SELECT import_id, MIN(account_id) AS account_id
    FROM public.monthly_payroll_records
    WHERE account_id IS NOT NULL
    GROUP BY import_id
    HAVING COUNT(DISTINCT account_id) = 1
) t
WHERE import_logs.id = t.import_id
  AND import_logs.source_type = 'monthly_payroll'
  AND import_logs.account_id IS NULL;

UPDATE public.import_logs
SET account_id = t.account_id
FROM (
    SELECT import_id, MIN(account_id) AS account_id
    FROM public.monthly_insurance_records
    WHERE account_id IS NOT NULL
    GROUP BY import_id
    HAVING COUNT(DISTINCT account_id) = 1
) t
WHERE import_logs.id = t.import_id
  AND import_logs.source_type = 'monthly_insurance'
  AND import_logs.account_id IS NULL;

-- 4. Indexes for account-scoped queries --------------------------------------
CREATE INDEX IF NOT EXISTS idx_payroll_account_period
    ON public.monthly_payroll_records(account_id, period_year, period_month);
CREATE INDEX IF NOT EXISTS idx_ins_account_period
    ON public.monthly_insurance_records(account_id, period_year, period_month);
CREATE INDEX IF NOT EXISTS idx_import_logs_account
    ON public.import_logs(account_id);

-- 5. Quarantine review surface -----------------------------------------------
CREATE OR REPLACE VIEW public.v_unassigned_monthly_records AS
SELECT 'monthly_payroll'::text AS source_table, id, period_year, period_month,
       national_id, employee_name, employee_code, import_id, created_at
FROM public.monthly_payroll_records
WHERE account_id IS NULL
UNION ALL
SELECT 'monthly_insurance'::text, id, period_year, period_month,
       national_id, employee_name, employee_code, import_id, created_at
FROM public.monthly_insurance_records
WHERE account_id IS NULL;

-- 5b. Alias coverage for text observed in production data -------------------
-- Append-only and ORDER-PRESERVING: the smart-import route derives the
-- canonical stored company text from the FIRST dotted alias, so the existing
-- alias order must not be disturbed. Idempotent (skips aliases already there).
UPDATE public.company_accounts
SET aliases = aliases || (SELECT ARRAY(SELECT a FROM unnest(ARRAY['EGYPT GAS','egypt gas','Egypt Gas']) AS t(a) WHERE NOT (a = ANY(company_accounts.aliases))))
WHERE account_code = 'EG';
UPDATE public.company_accounts
SET aliases = aliases || (SELECT ARRAY(SELECT a FROM unnest(ARRAY['modern gas','Modern Gas','MODERN GAS']) AS t(a) WHERE NOT (a = ANY(company_accounts.aliases))))
WHERE account_code = 'MG';

-- 6. Remove the silent Egypt Gas fallback from the account UID trigger -------
-- Unmatched company text now leaves account_id NULL (quarantine) instead of
-- inventing an Egypt Gas attribution. company_account text is never
-- overwritten by the trigger.
CREATE OR REPLACE FUNCTION resolve_employee_account_uid()
RETURNS TRIGGER AS $$
DECLARE
    v_account_id INTEGER;
    v_account_code TEXT;
    v_clean_code TEXT;
    v_clean_nat_id TEXT;
BEGIN
    -- Match account_id from company_accounts by code or aliases.
    -- NO DEFAULT: an unmatched value must surface for review, not be
    -- silently attributed to any company.
    IF NEW.company_account IS NOT NULL AND TRIM(NEW.company_account) <> '' THEN
        SELECT id, account_code INTO v_account_id, v_account_code
        FROM public.company_accounts
        WHERE account_code = UPPER(TRIM(NEW.company_account))
           OR TRIM(NEW.company_account) = ANY(aliases)
           OR LOWER(TRIM(NEW.company_account)) = ANY(aliases)
        LIMIT 1;
    END IF;

    -- Never erase a grounded existing attribution on unresolved/blank text:
    -- keep the row's current account_id (and its real code for the UID
    -- prefix). Only rows with no prior attribution quarantine as NULL.
    IF v_account_id IS NULL AND NEW.account_id IS NOT NULL THEN
        SELECT id, account_code INTO v_account_id, v_account_code
        FROM public.company_accounts
        WHERE id = NEW.account_id;
    END IF;

    NEW.account_id := v_account_id; -- NULL only when nothing grounded exists

    v_clean_code := NULLIF(REGEXP_REPLACE(COALESCE(NEW.employee_code, ''), '[^0-9a-zA-Z]', '', 'g'), '');
    v_clean_nat_id := NULLIF(REGEXP_REPLACE(COALESCE(NEW.national_id, ''), '[^0-9]', '', 'g'), '');

    -- UID prefix marks unresolved accounts as UNASSIGNED instead of guessing
    v_account_code := COALESCE(v_account_code, 'UNASSIGNED');

    IF v_clean_code IS NOT NULL THEN
        NEW.account_employee_uid := v_account_code || '-' || v_clean_code;
    ELSIF v_clean_nat_id IS NOT NULL THEN
        NEW.account_employee_uid := v_account_code || '-NID' || v_clean_nat_id;
    ELSE
        NEW.account_employee_uid := v_account_code || '-ID' || SUBSTRING(COALESCE(NEW.id::text, gen_random_uuid()::text), 1, 8);
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 7. Re-scope the global national_id uniqueness to per-account --------------
-- Blocked by an audit: aborts if duplicate national_ids already exist, so the
-- swap can never hide an existing conflict. The only master upsert keys on
-- (employee_code, company_account), so no runtime conflict target breaks.
DO $$
DECLARE
    conflict_count INT;
BEGIN
    -- Mirror the NEW index exactly: only duplicates the per-account index
    -- would reject are conflicts. A national_id present in TWO DIFFERENT
    -- accounts is the ambiguity we WANT to make visible, not a blocker.
    SELECT COUNT(*) INTO conflict_count
    FROM (
        SELECT account_id, national_id
        FROM public.employees_master
        WHERE national_id IS NOT NULL AND account_id IS NOT NULL
        GROUP BY account_id, national_id
        HAVING COUNT(*) > 1
    ) d;

    IF conflict_count > 0 THEN
        RAISE EXCEPTION 'employees_master has % duplicate national_id groups within one account; resolve before re-scoping uniqueness', conflict_count;
    END IF;

    DROP INDEX IF EXISTS public.idx_employees_master_unique_national_global;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_master_unique_national_per_account
        ON public.employees_master(account_id, national_id)
        WHERE national_id IS NOT NULL;
END $$;
