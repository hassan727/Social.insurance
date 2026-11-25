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

-- 2. Evidence-supported backfill (exact national_id → employees_master) -----
-- Rows whose national_id has no master record with a resolved account stay
-- NULL: quarantined, surfaced by v_unassigned_monthly_records below.
UPDATE public.monthly_payroll_records
SET account_id = em.account_id
FROM public.employees_master em
WHERE monthly_payroll_records.account_id IS NULL
  AND monthly_payroll_records.national_id IS NOT NULL
  AND monthly_payroll_records.national_id = em.national_id
  AND em.account_id IS NOT NULL;

UPDATE public.monthly_insurance_records
SET account_id = em.account_id
FROM public.employees_master em
WHERE monthly_insurance_records.account_id IS NULL
  AND monthly_insurance_records.national_id IS NOT NULL
  AND monthly_insurance_records.national_id = em.national_id
  AND em.account_id IS NOT NULL;

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

    NEW.account_id := v_account_id; -- NULL when unresolved: quarantined

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
    SELECT COUNT(*) INTO conflict_count
    FROM (
        SELECT national_id
        FROM public.employees_master
        WHERE national_id IS NOT NULL
        GROUP BY national_id
        HAVING COUNT(*) > 1
    ) d;

    IF conflict_count > 0 THEN
        RAISE EXCEPTION 'employees_master has % duplicate national_id groups; resolve before re-scoping uniqueness', conflict_count;
    END IF;

    DROP INDEX IF EXISTS public.idx_employees_master_unique_national_global;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_master_unique_national_per_account
        ON public.employees_master(account_id, national_id)
        WHERE national_id IS NOT NULL;
END $$;
