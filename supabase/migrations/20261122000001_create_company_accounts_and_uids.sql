-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: 20261122000001_create_company_accounts_and_uids.sql
-- Purpose: Establish Sovereign Account Entity, Unique Account IDs,
--          and Bulletproof Dynamic Employee Account UIDs.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Create Sovereign Company Accounts Table
CREATE TABLE IF NOT EXISTS public.company_accounts (
    id SERIAL PRIMARY KEY,
    account_code TEXT NOT NULL UNIQUE,       -- 'EG', 'MG', etc.
    account_name TEXT NOT NULL,              -- 'شركة غاز مصر (Egypt Gas)', 'شركة مودرن جاس (Modern Gas)'
    aliases TEXT[] DEFAULT '{}'::text[],     -- ['E.G', 'eg', 'غاز مصر'], ['M.G', 'm.g', 'mg', 'مودرن']
    description TEXT,
    is_active BOOLEAN DEFAULT true NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Enable RLS
ALTER TABLE public.company_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all operations on company_accounts"
    ON public.company_accounts FOR ALL USING (true) WITH CHECK (true);

-- Seed Standard Accounts with default IDs
INSERT INTO public.company_accounts (id, account_code, account_name, aliases, description)
VALUES 
    (1, 'EG', 'شركة غاز مصر (Egypt Gas)', ARRAY['E.G', 'e.g', 'eg', 'EG', 'غاز مصر', 'مصر للغاز'], 'الحساب الرئيسي لشركة غاز مصر'),
    (2, 'MG', 'شركة مودرن جاس (Modern Gas)', ARRAY['M.G', 'm.g', 'mg', 'MG', 'مودرن', 'مودرن جاس'], 'حساب شركة مودرن جاس / مشاريع التشغيل')
ON CONFLICT (account_code) DO UPDATE SET
    account_name = EXCLUDED.account_name,
    aliases = EXCLUDED.aliases,
    updated_at = NOW();

-- 2. Add New Structural Columns to employees_master
ALTER TABLE public.employees_master 
    ADD COLUMN IF NOT EXISTS account_id INTEGER REFERENCES public.company_accounts(id),
    ADD COLUMN IF NOT EXISTS account_employee_uid TEXT;

-- 3. Function to dynamically resolve account and generate bulletproof UID
CREATE OR REPLACE FUNCTION resolve_employee_account_uid()
RETURNS TRIGGER AS $$
DECLARE
    v_account_id INTEGER;
    v_account_code TEXT;
    v_clean_code TEXT;
    v_clean_nat_id TEXT;
BEGIN
    -- Normalize incoming account text
    IF NEW.company_account IS NULL OR TRIM(NEW.company_account) = '' THEN
        NEW.company_account := 'E.G';
    END IF;

    -- Match account_id from company_accounts by code or aliases
    SELECT id, account_code INTO v_account_id, v_account_code
    FROM public.company_accounts
    WHERE account_code = UPPER(TRIM(NEW.company_account))
       OR TRIM(NEW.company_account) = ANY(aliases)
       OR LOWER(TRIM(NEW.company_account)) = ANY(aliases)
    LIMIT 1;

    -- Default fallback if unmatched is Egypt Gas (Account 1: EG)
    IF v_account_id IS NULL THEN
        SELECT id, account_code INTO v_account_id, v_account_code
        FROM public.company_accounts
        WHERE account_code = 'EG'
        LIMIT 1;
    END IF;

    NEW.account_id := v_account_id;

    -- Clean Code and National ID
    v_clean_code := NULLIF(REGEXP_REPLACE(COALESCE(NEW.employee_code, ''), '[^0-9a-zA-Z]', '', 'g'), '');
    v_clean_nat_id := NULLIF(REGEXP_REPLACE(COALESCE(NEW.national_id, ''), '[^0-9]', '', 'g'), '');

    -- Construct Deterministic Sovereign UID:
    -- Prefer: ACCOUNT_CODE-EMPLOYEE_CODE (e.g. EG-51729)
    -- Fallback: ACCOUNT_CODE-NID (e.g. EG-30311051400534)
    -- Last Resort: ACCOUNT_CODE-UUID_PREFIX
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

-- 4. Attach Trigger to employees_master (Runs BEFORE INSERT or UPDATE)
DROP TRIGGER IF EXISTS trigger_resolve_employee_account_uid ON public.employees_master;
CREATE TRIGGER trigger_resolve_employee_account_uid
    BEFORE INSERT OR UPDATE OF company_account, employee_code, national_id
    ON public.employees_master
    FOR EACH ROW
    EXECUTE FUNCTION resolve_employee_account_uid();

-- 5. Backfill Existing Records in employees_master
UPDATE public.employees_master
SET company_account = company_account
WHERE account_employee_uid IS NULL OR account_id IS NULL;

-- 6. Create Unique Index for Bulletproof Idempotent Upserts
CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_master_account_emp_uid
    ON public.employees_master(account_employee_uid);

CREATE INDEX IF NOT EXISTS idx_employees_master_account_id
    ON public.employees_master(account_id);
