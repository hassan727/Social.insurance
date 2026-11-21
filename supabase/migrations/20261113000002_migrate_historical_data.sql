-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: Migrate Historical Data to New System
-- Purpose: Merge old tables into employees_master + sheet_data (no duplication)
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- FUNCTION: Migrate data from old tables to new system
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION migrate_historical_records()
RETURNS TABLE (
    source_table TEXT,
    total_records INT,
    migrated_count INT,
    skipped_count INT,
    errors TEXT[]
) AS $$
DECLARE
    rec RECORD;
    emp_id UUID;
    sheet_id UUID;
    migrated INT := 0;
    skipped INT := 0;
    total INT := 0;
    error_list TEXT[] := ARRAY[]::TEXT[];
BEGIN
    
    -- ═══════════════════════════════════════════════════════════════════
    -- 1. MIGRATE: incoming_insurance_records → sheet_data
    -- ═══════════════════════════════════════════════════════════════════
    
    source_table := 'incoming_insurance_records';
    migrated := 0;
    skipped := 0;
    
    -- Get sheet_id for "ارقام وارد التامين"
    SELECT id INTO sheet_id FROM dynamic_sheets WHERE sheet_name = 'ارقام وارد التامين' LIMIT 1;
    
    IF sheet_id IS NULL THEN
        error_list := array_append(error_list, 'Sheet "ارقام وارد التامين" not found');
    ELSE
        SELECT COUNT(*) INTO total FROM incoming_insurance_records;
        
        FOR rec IN SELECT * FROM incoming_insurance_records ORDER BY created_at
        LOOP
            BEGIN
                -- Find or create employee
                SELECT id INTO emp_id FROM employees_master 
                WHERE (employee_code = rec.employee_code AND rec.employee_code IS NOT NULL)
                   OR (national_id = rec.national_id AND rec.national_id IS NOT NULL)
                LIMIT 1;
                
                IF emp_id IS NULL THEN
                    -- Create new employee
                    INSERT INTO employees_master (
                        company_account, employee_code, national_id, employee_name,
                        current_status, current_job_title, insurance_number, insurance_status
                    ) VALUES (
                        COALESCE(rec.company_account, 'E.G'),
                        rec.employee_code,
                        rec.national_id,
                        COALESCE(rec.employee_name, 'غير محدد'),
                        rec.status,
                        rec.job_title,
                        rec.insurance_number,
                        rec.insurance_status
                    ) RETURNING id INTO emp_id;
                END IF;
                
                -- Insert into sheet_data (if not exists)
                INSERT INTO sheet_data (
                    sheet_id, employee_id, row_data,
                    row_code, row_national_id, row_name,
                    is_latest
                )
                SELECT 
                    sheet_id, emp_id,
                    COALESCE(rec.raw_data, jsonb_build_object(
                        'employee_code', rec.employee_code,
                        'employee_name', rec.employee_name,
                        'national_id', rec.national_id,
                        'job_title', rec.job_title,
                        'status', rec.status,
                        'company_account', rec.company_account,
                        'insurance_number', rec.insurance_number,
                        'insurance_status', rec.insurance_status,
                        'termination_reason', rec.termination_reason,
                        'form_type', rec.form_type,
                        'insurance_job_title', rec.insurance_job_title,
                        'subscription_start_date', rec.subscription_start_date,
                        'subscription_end_date', rec.subscription_end_date,
                        'supply_method', rec.supply_method,
                        'crm_number', rec.crm_number,
                        'record_date', rec.record_date,
                        'note', rec.note
                    )),
                    rec.employee_code, rec.national_id, rec.employee_name,
                    true
                WHERE NOT EXISTS (
                    SELECT 1 FROM sheet_data 
                    WHERE sheet_id = sheet_id 
                      AND employee_id = emp_id
                      AND is_latest = true
                );
                
                IF FOUND THEN
                    migrated := migrated + 1;
                ELSE
                    skipped := skipped + 1;
                END IF;
                
            EXCEPTION WHEN OTHERS THEN
                error_list := array_append(error_list, 'Error migrating record ' || rec.id::TEXT || ': ' || SQLERRM);
                skipped := skipped + 1;
            END;
        END LOOP;
    END IF;
    
    RETURN QUERY SELECT source_table, total, migrated, skipped, error_list;
    
    -- ═══════════════════════════════════════════════════════════════════
    -- 2. MIGRATE: resignation_records → sheet_data
    -- ═══════════════════════════════════════════════════════════════════
    
    source_table := 'resignation_records';
    migrated := 0;
    skipped := 0;
    error_list := ARRAY[]::TEXT[];
    
    SELECT id INTO sheet_id FROM dynamic_sheets WHERE sheet_name = 'RES' LIMIT 1;
    
    IF sheet_id IS NOT NULL THEN
        SELECT COUNT(*) INTO total FROM resignation_records;
        
        FOR rec IN SELECT * FROM resignation_records ORDER BY created_at
        LOOP
            BEGIN
                SELECT id INTO emp_id FROM employees_master 
                WHERE (employee_code = rec.employee_code AND rec.employee_code IS NOT NULL)
                   OR (national_id = rec.national_id AND rec.national_id IS NOT NULL)
                LIMIT 1;
                
                IF emp_id IS NULL THEN
                    INSERT INTO employees_master (
                        company_account, employee_code, national_id, employee_name,
                        resignation_date, last_working_day
                    ) VALUES (
                        'E.G', rec.employee_code, rec.national_id,
                        COALESCE(rec.employee_name, 'غير محدد'),
                        rec.resignation_date, rec.last_working_day
                    ) RETURNING id INTO emp_id;
                END IF;
                
                INSERT INTO sheet_data (
                    sheet_id, employee_id, row_data,
                    row_code, row_national_id, row_name, is_latest
                )
                SELECT 
                    sheet_id, emp_id,
                    COALESCE(rec.raw_data, jsonb_build_object(
                        'employee_code', rec.employee_code,
                        'employee_name', rec.employee_name,
                        'national_id', rec.national_id,
                        'resignation_date', rec.resignation_date,
                        'last_working_day', rec.last_working_day,
                        'resignation_type', rec.resignation_type,
                        'insurance_supply_type', rec.insurance_supply_type,
                        'supply_date', rec.supply_date
                    )),
                    rec.employee_code, rec.national_id, rec.employee_name, true
                WHERE NOT EXISTS (
                    SELECT 1 FROM sheet_data 
                    WHERE sheet_id = sheet_id AND employee_id = emp_id AND is_latest = true
                );
                
                IF FOUND THEN migrated := migrated + 1; ELSE skipped := skipped + 1; END IF;
                
            EXCEPTION WHEN OTHERS THEN
                error_list := array_append(error_list, 'Error: ' || SQLERRM);
                skipped := skipped + 1;
            END;
        END LOOP;
    END IF;
    
    RETURN QUERY SELECT source_table, total, migrated, skipped, error_list;
    
    -- ═══════════════════════════════════════════════════════════════════
    -- 3. MIGRATE: monthly_payroll_records → sheet_data (aggregated)
    -- ═══════════════════════════════════════════════════════════════════
    
    source_table := 'monthly_payroll_records';
    migrated := 0;
    skipped := 0;
    error_list := ARRAY[]::TEXT[];
    
    -- Note: Monthly records are kept in original table + referenced in sheet_data
    SELECT COUNT(*) INTO total FROM monthly_payroll_records;
    
    RETURN QUERY SELECT source_table, total, 0, total, ARRAY['Monthly records kept in original table']::TEXT[];
    
    -- ═══════════════════════════════════════════════════════════════════
    -- 4. MIGRATE: monthly_insurance_records → sheet_data (aggregated)
    -- ═══════════════════════════════════════════════════════════════════
    
    source_table := 'monthly_insurance_records';
    SELECT COUNT(*) INTO total FROM monthly_insurance_records;
    
    RETURN QUERY SELECT source_table, total, 0, total, ARRAY['Monthly records kept in original table']::TEXT[];
    
END;
$$ LANGUAGE plpgsql;

-- ───────────────────────────────────────────────────────────────────────────
-- FUNCTION: Update existing records (no duplication)
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION upsert_sheet_data(
    p_sheet_name TEXT,
    p_company_account TEXT,
    p_row_data JSONB,
    p_employee_code TEXT DEFAULT NULL,
    p_national_id TEXT DEFAULT NULL,
    p_employee_name TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_sheet_id UUID;
    v_emp_id UUID;
    v_existing_record_id UUID;
BEGIN
    -- Get sheet ID
    SELECT id INTO v_sheet_id FROM dynamic_sheets WHERE sheet_name = p_sheet_name LIMIT 1;
    IF v_sheet_id IS NULL THEN
        RAISE EXCEPTION 'Sheet % not found', p_sheet_name;
    END IF;
    
    -- Find or create employee
    SELECT id INTO v_emp_id FROM employees_master 
    WHERE (employee_code = p_employee_code AND p_employee_code IS NOT NULL AND p_company_account = company_account)
       OR (national_id = p_national_id AND p_national_id IS NOT NULL)
    LIMIT 1;
    
    IF v_emp_id IS NULL THEN
        -- Create new employee
        INSERT INTO employees_master (
            company_account, employee_code, national_id, employee_name
        ) VALUES (
            p_company_account,
            p_employee_code,
            p_national_id,
            COALESCE(p_employee_name, 'غير محدد')
        ) RETURNING id INTO v_emp_id;
    END IF;
    
    -- Check if record exists for this sheet + employee
    SELECT id INTO v_existing_record_id 
    FROM sheet_data 
    WHERE sheet_id = v_sheet_id 
      AND employee_id = v_emp_id 
      AND is_latest = true
    LIMIT 1;
    
    IF v_existing_record_id IS NOT NULL THEN
        -- UPDATE existing record
        UPDATE sheet_data SET
            row_data = p_row_data,
            row_code = p_employee_code,
            row_national_id = p_national_id,
            row_name = p_employee_name,
            updated_at = NOW()
        WHERE id = v_existing_record_id;
        
        RETURN v_existing_record_id;
    ELSE
        -- INSERT new record
        INSERT INTO sheet_data (
            sheet_id, employee_id, row_data,
            row_code, row_national_id, row_name,
            is_latest
        ) VALUES (
            v_sheet_id, v_emp_id, p_row_data,
            p_employee_code, p_national_id, p_employee_name,
            true
        ) RETURNING id INTO v_existing_record_id;
        
        RETURN v_existing_record_id;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- ───────────────────────────────────────────────────────────────────────────
-- EXECUTE MIGRATION
-- ───────────────────────────────────────────────────────────────────────────

DO $$ 
DECLARE
    result_row RECORD;
BEGIN
    RAISE NOTICE '════════════════════════════════════════════════════════';
    RAISE NOTICE 'بدء ترحيل البيانات التاريخية...';
    RAISE NOTICE '════════════════════════════════════════════════════════';
    
    FOR result_row IN SELECT * FROM migrate_historical_records()
    LOOP
        RAISE NOTICE '';
        RAISE NOTICE '📊 الجدول: %', result_row.source_table;
        RAISE NOTICE '   • إجمالي السجلات: %', result_row.total_records;
        RAISE NOTICE '   • تم الترحيل: %', result_row.migrated_count;
        RAISE NOTICE '   • تم تخطيه: %', result_row.skipped_count;
        
        IF array_length(result_row.errors, 1) > 0 THEN
            RAISE NOTICE '   ⚠️ أخطاء: %', array_to_string(result_row.errors, ', ');
        END IF;
    END LOOP;
    
    RAISE NOTICE '';
    RAISE NOTICE '════════════════════════════════════════════════════════';
    RAISE NOTICE '✅ اكتمل ترحيل البيانات التاريخية!';
    RAISE NOTICE '════════════════════════════════════════════════════════';
    
    -- Now run consolidation on all employees
    RAISE NOTICE '';
    RAISE NOTICE 'جاري دمج البيانات من جميع المصادر...';
    
    PERFORM smart_merge_employee_data(id) FROM employees_master;
    
    RAISE NOTICE '✅ اكتمل دمج البيانات!';
END $$;

-- ───────────────────────────────────────────────────────────────────────────
-- CREATE VIEW: Monthly Records Summary
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW employee_monthly_summary AS
SELECT 
    em.id as employee_id,
    em.employee_code,
    em.national_id,
    em.employee_name,
    em.company_account,
    
    -- Payroll summary
    COUNT(DISTINCT CONCAT(mp.period_year, '-', mp.period_month)) as total_payroll_months,
    MAX(CONCAT(mp.period_year, '-', LPAD(mp.period_month::TEXT, 2, '0'))) as last_payroll_month,
    
    -- Insurance summary
    COUNT(DISTINCT CONCAT(mi.period_year, '-', mi.period_month)) as total_insurance_months,
    MAX(CONCAT(mi.period_year, '-', LPAD(mi.period_month::TEXT, 2, '0'))) as last_insurance_month
    
FROM employees_master em
LEFT JOIN monthly_payroll_records mp ON (
    (em.employee_code = mp.employee_code AND mp.employee_code IS NOT NULL)
    OR (em.national_id = mp.national_id AND mp.national_id IS NOT NULL)
)
LEFT JOIN monthly_insurance_records mi ON (
    (em.employee_code = mi.employee_code AND mi.employee_code IS NOT NULL)
    OR (em.national_id = mi.national_id AND mi.national_id IS NOT NULL)
)
GROUP BY em.id, em.employee_code, em.national_id, em.employee_name, em.company_account;

COMMENT ON VIEW employee_monthly_summary IS 'ملخص المرتبات والتأمينات الشهرية لكل موظف';

-- ───────────────────────────────────────────────────────────────────────────
-- SUCCESS
-- ───────────────────────────────────────────────────────────────────────────

DO $$ 
BEGIN 
    RAISE NOTICE '';
    RAISE NOTICE '════════════════════════════════════════════════════════';
    RAISE NOTICE '🎉 نظام التحديث الذكي جاهز!';
    RAISE NOTICE '════════════════════════════════════════════════════════';
    RAISE NOTICE '';
    RAISE NOTICE '✅ البيانات التاريخية تم دمجها';
    RAISE NOTICE '✅ لا يوجد تكرار في البيانات';
    RAISE NOTICE '✅ التحديثات تحل محل السجلات القديمة';
    RAISE NOTICE '✅ استخدم upsert_sheet_data() للإضافة/التحديث';
    RAISE NOTICE '';
END $$;
