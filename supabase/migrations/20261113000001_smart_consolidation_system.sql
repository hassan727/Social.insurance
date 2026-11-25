-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: Smart Consolidation System
-- Purpose: Auto-merge data from all sheets into employees_master
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- FUNCTION 1: Calculate Data Completeness Score
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION calculate_employee_completeness(employee_id_param UUID)
RETURNS FLOAT AS $$
DECLARE
    emp RECORD;
    total_fields INT := 0;
    filled_fields INT := 0;
    completeness FLOAT;
BEGIN
    -- Get employee record
    SELECT * INTO emp FROM employees_master WHERE id = employee_id_param;
    
    IF NOT FOUND THEN
        RETURN 0;
    END IF;
    
    -- Core identity fields (weight: 2)
    total_fields := total_fields + 3;
    IF emp.employee_code IS NOT NULL AND emp.employee_code != '' THEN filled_fields := filled_fields + 1; END IF;
    IF emp.national_id IS NOT NULL AND emp.national_id != '' THEN filled_fields := filled_fields + 1; END IF;
    IF emp.employee_name IS NOT NULL AND emp.employee_name != '' THEN filled_fields := filled_fields + 1; END IF;
    
    -- Employment fields (weight: 1)
    total_fields := total_fields + 5;
    IF emp.current_status IS NOT NULL AND emp.current_status != '' THEN filled_fields := filled_fields + 1; END IF;
    IF emp.current_job_title IS NOT NULL AND emp.current_job_title != '' THEN filled_fields := filled_fields + 1; END IF;
    IF emp.current_region IS NOT NULL AND emp.current_region != '' THEN filled_fields := filled_fields + 1; END IF;
    IF emp.current_department IS NOT NULL AND emp.current_department != '' THEN filled_fields := filled_fields + 1; END IF;
    IF emp.hire_date IS NOT NULL THEN filled_fields := filled_fields + 1; END IF;
    
    -- Insurance fields (weight: 1)
    total_fields := total_fields + 4;
    IF emp.insurance_number IS NOT NULL AND emp.insurance_number != '' THEN filled_fields := filled_fields + 1; END IF;
    IF emp.insurance_status IS NOT NULL AND emp.insurance_status != '' THEN filled_fields := filled_fields + 1; END IF;
    IF emp.insurance_salary IS NOT NULL THEN filled_fields := filled_fields + 1; END IF;
    IF emp.insurance_start_date IS NOT NULL THEN filled_fields := filled_fields + 1; END IF;
    
    -- Contact fields (weight: 0.5)
    total_fields := total_fields + 2;
    IF emp.phone_number IS NOT NULL AND emp.phone_number != '' THEN filled_fields := filled_fields + 1; END IF;
    IF emp.address IS NOT NULL AND emp.address != '' THEN filled_fields := filled_fields + 1; END IF;
    
    -- Calculate percentage
    IF total_fields > 0 THEN
        completeness := (filled_fields::FLOAT / total_fields::FLOAT) * 100;
    ELSE
        completeness := 0;
    END IF;
    
    RETURN ROUND(completeness::NUMERIC, 2);
END;
$$ LANGUAGE plpgsql;

-- ───────────────────────────────────────────────────────────────────────────
-- FUNCTION 2: Smart Merge from sheet_data to employees_master
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION smart_merge_employee_data(employee_id_param UUID)
RETURNS VOID AS $$
DECLARE
    sheet_row RECORD;
    merged_data JSONB := '{}'::JSONB;
    update_fields JSONB := '{}'::JSONB;
BEGIN
    -- USER-APPROVED POLICY (2026-11-25): an import file that lacks a value
    -- must never erase an existing one. Start from the employee's CURRENT
    -- consolidated data; sheet rows overlay it. Previously this started from
    -- '{}' and rebuilt consolidated_data from sheet rows only, so any value
    -- not present in the latest file was silently erased.
    SELECT COALESCE(consolidated_data, '{}'::jsonb) INTO merged_data
    FROM employees_master WHERE id = employee_id_param;
    merged_data := COALESCE(merged_data, '{}'::jsonb);

    -- Get all sheet data for this employee (latest only)
    FOR sheet_row IN 
        SELECT 
            sd.row_data,
            ds.sheet_name,
            ds.is_master_source
        FROM sheet_data sd
        JOIN dynamic_sheets ds ON ds.id = sd.sheet_id
        WHERE sd.employee_id = employee_id_param
          AND sd.is_latest = true
        ORDER BY ds.is_master_source DESC, sd.created_at DESC
    LOOP
        -- Merge row_data into consolidated_data. Blank cells (jsonb null or
        -- empty/whitespace string) are DROPPED before overlay: blank means
        -- "no data in this file", never "erase". Meaningful zero/false
        -- values are preserved. Clearing a value is a deliberate user
        -- action, not an empty cell.
        merged_data := merged_data || COALESCE((
            SELECT jsonb_object_agg(e.key, e.value)
            FROM jsonb_each(sheet_row.row_data) AS e
            WHERE e.value <> 'null'::jsonb
              AND (jsonb_typeof(e.value) <> 'string' OR btrim(e.value #>> '{}') <> '')
        ), '{}'::jsonb);
        
        -- Extract core fields based on sheet type
        -- Employee Code
        IF sheet_row.row_data ? 'employee_code' AND sheet_row.row_data->>'employee_code' IS NOT NULL AND sheet_row.row_data->>'employee_code' != '' THEN
            update_fields := jsonb_set(update_fields, '{employee_code}', sheet_row.row_data->'employee_code');
        END IF;
        IF sheet_row.row_data ? 'الكود' AND sheet_row.row_data->>'الكود' IS NOT NULL AND sheet_row.row_data->>'الكود' != '' THEN
            update_fields := jsonb_set(update_fields, '{employee_code}', to_jsonb(sheet_row.row_data->>'الكود'));
        END IF;
        
        -- National ID
        IF sheet_row.row_data ? 'national_id' AND sheet_row.row_data->>'national_id' IS NOT NULL AND sheet_row.row_data->>'national_id' != '' THEN
            update_fields := jsonb_set(update_fields, '{national_id}', sheet_row.row_data->'national_id');
        END IF;
        IF sheet_row.row_data ? 'الرقم القومى' AND sheet_row.row_data->>'الرقم القومى' IS NOT NULL AND sheet_row.row_data->>'الرقم القومى' != '' THEN
            update_fields := jsonb_set(update_fields, '{national_id}', to_jsonb(sheet_row.row_data->>'الرقم القومى'));
        END IF;
        
        -- Job Title
        IF sheet_row.row_data ? 'job_title' AND sheet_row.row_data->>'job_title' IS NOT NULL AND sheet_row.row_data->>'job_title' != '' THEN
            update_fields := jsonb_set(update_fields, '{current_job_title}', sheet_row.row_data->'job_title');
        END IF;
        IF sheet_row.row_data ? 'الوظيفه' AND sheet_row.row_data->>'الوظيفه' IS NOT NULL AND sheet_row.row_data->>'الوظيفه' != '' THEN
            update_fields := jsonb_set(update_fields, '{current_job_title}', to_jsonb(sheet_row.row_data->>'الوظيفه'));
        END IF;
        
        -- Region
        IF sheet_row.row_data ? 'region' AND sheet_row.row_data->>'region' IS NOT NULL AND sheet_row.row_data->>'region' != '' THEN
            update_fields := jsonb_set(update_fields, '{current_region}', sheet_row.row_data->'region');
        END IF;
        IF sheet_row.row_data ? 'المنطقه' AND sheet_row.row_data->>'المنطقه' IS NOT NULL AND sheet_row.row_data->>'المنطقه' != '' THEN
            update_fields := jsonb_set(update_fields, '{current_region}', to_jsonb(sheet_row.row_data->>'المنطقه'));
        END IF;
        
        -- Department
        IF sheet_row.row_data ? 'department' AND sheet_row.row_data->>'department' IS NOT NULL AND sheet_row.row_data->>'department' != '' THEN
            update_fields := jsonb_set(update_fields, '{current_department}', sheet_row.row_data->'department');
        END IF;
        IF sheet_row.row_data ? 'الاداره' AND sheet_row.row_data->>'الاداره' IS NOT NULL AND sheet_row.row_data->>'الاداره' != '' THEN
            update_fields := jsonb_set(update_fields, '{current_department}', to_jsonb(sheet_row.row_data->>'الاداره'));
        END IF;
        
        -- Status
        IF sheet_row.row_data ? 'status' AND sheet_row.row_data->>'status' IS NOT NULL AND sheet_row.row_data->>'status' != '' THEN
            update_fields := jsonb_set(update_fields, '{current_status}', sheet_row.row_data->'status');
        END IF;
        IF sheet_row.row_data ? 'الحاله' AND sheet_row.row_data->>'الحاله' IS NOT NULL AND sheet_row.row_data->>'الحاله' != '' THEN
            update_fields := jsonb_set(update_fields, '{current_status}', to_jsonb(sheet_row.row_data->>'الحاله'));
        END IF;
        
        -- Insurance Number
        IF sheet_row.row_data ? 'insurance_number' AND sheet_row.row_data->>'insurance_number' IS NOT NULL AND sheet_row.row_data->>'insurance_number' != '' THEN
            update_fields := jsonb_set(update_fields, '{insurance_number}', sheet_row.row_data->'insurance_number');
        END IF;
        IF sheet_row.row_data ? 'الرقم التامينى' AND sheet_row.row_data->>'الرقم التامينى' IS NOT NULL AND sheet_row.row_data->>'الرقم التامينى' != '' THEN
            update_fields := jsonb_set(update_fields, '{insurance_number}', to_jsonb(sheet_row.row_data->>'الرقم التامينى'));
        END IF;
        IF sheet_row.row_data ? 'الرقم التاميني' AND sheet_row.row_data->>'الرقم التاميني' IS NOT NULL AND sheet_row.row_data->>'الرقم التاميني' != '' THEN
            update_fields := jsonb_set(update_fields, '{insurance_number}', to_jsonb(sheet_row.row_data->>'الرقم التاميني'));
        END IF;
        
        -- Insurance Status
        IF sheet_row.row_data ? 'insurance_status' AND sheet_row.row_data->>'insurance_status' IS NOT NULL AND sheet_row.row_data->>'insurance_status' != '' THEN
            update_fields := jsonb_set(update_fields, '{insurance_status}', sheet_row.row_data->'insurance_status');
        END IF;
        IF sheet_row.row_data ? 'الحاله التامينيه' AND sheet_row.row_data->>'الحاله التامينيه' IS NOT NULL AND sheet_row.row_data->>'الحاله التامينيه' != '' THEN
            update_fields := jsonb_set(update_fields, '{insurance_status}', to_jsonb(sheet_row.row_data->>'الحاله التامينيه'));
        END IF;
        
        -- Insurance Salary
        IF sheet_row.row_data ? 'insurance_salary' AND sheet_row.row_data->>'insurance_salary' IS NOT NULL THEN
            update_fields := jsonb_set(update_fields, '{insurance_salary}', sheet_row.row_data->'insurance_salary');
        END IF;
        IF sheet_row.row_data ? 'الاجر التامينى' AND sheet_row.row_data->>'الاجر التامينى' IS NOT NULL THEN
            BEGIN
                update_fields := jsonb_set(update_fields, '{insurance_salary}', to_jsonb((sheet_row.row_data->>'الاجر التامينى')::NUMERIC));
            EXCEPTION WHEN OTHERS THEN
                -- Ignore conversion errors
            END;
        END IF;
        
        -- Insurance Job Title
        IF sheet_row.row_data ? 'insurance_job_title' AND sheet_row.row_data->>'insurance_job_title' IS NOT NULL AND sheet_row.row_data->>'insurance_job_title' != '' THEN
            update_fields := jsonb_set(update_fields, '{insurance_job_title}', sheet_row.row_data->'insurance_job_title');
        END IF;
        IF sheet_row.row_data ? 'الوظيفه في التامينات' AND sheet_row.row_data->>'الوظيفه في التامينات' IS NOT NULL AND sheet_row.row_data->>'الوظيفه في التامينات' != '' THEN
            update_fields := jsonb_set(update_fields, '{insurance_job_title}', to_jsonb(sheet_row.row_data->>'الوظيفه في التامينات'));
        END IF;
        
        -- Phone
        IF sheet_row.row_data ? 'phone_number' AND sheet_row.row_data->>'phone_number' IS NOT NULL AND sheet_row.row_data->>'phone_number' != '' THEN
            update_fields := jsonb_set(update_fields, '{phone_number}', sheet_row.row_data->'phone_number');
        END IF;
        IF sheet_row.row_data ? 'رقم الهاتف' AND sheet_row.row_data->>'رقم الهاتف' IS NOT NULL AND sheet_row.row_data->>'رقم الهاتف' != '' THEN
            update_fields := jsonb_set(update_fields, '{phone_number}', to_jsonb(sheet_row.row_data->>'رقم الهاتف'));
        END IF;
        
        -- Address
        IF sheet_row.row_data ? 'address' AND sheet_row.row_data->>'address' IS NOT NULL AND sheet_row.row_data->>'address' != '' THEN
            update_fields := jsonb_set(update_fields, '{address}', sheet_row.row_data->'address');
        END IF;
        IF sheet_row.row_data ? 'العنوان' AND sheet_row.row_data->>'العنوان' IS NOT NULL AND sheet_row.row_data->>'العنوان' != '' THEN
            update_fields := jsonb_set(update_fields, '{address}', to_jsonb(sheet_row.row_data->>'العنوان'));
        END IF;
        
        -- Hire Date
        IF sheet_row.row_data ? 'hire_date' AND sheet_row.row_data->>'hire_date' IS NOT NULL AND sheet_row.row_data->>'hire_date' != '' THEN
            update_fields := jsonb_set(update_fields, '{hire_date}', sheet_row.row_data->'hire_date');
        END IF;
        IF sheet_row.row_data ? 'تاريخ استلام العمل' AND sheet_row.row_data->>'تاريخ استلام العمل' IS NOT NULL AND sheet_row.row_data->>'تاريخ استلام العمل' != '' THEN
            update_fields := jsonb_set(update_fields, '{hire_date}', to_jsonb(sheet_row.row_data->>'تاريخ استلام العمل'));
        END IF;
        
        -- Insurance Start Date
        IF sheet_row.row_data ? 'subscription_start_date' AND sheet_row.row_data->>'subscription_start_date' IS NOT NULL AND sheet_row.row_data->>'subscription_start_date' != '' THEN
            update_fields := jsonb_set(update_fields, '{insurance_start_date}', sheet_row.row_data->'subscription_start_date');
        END IF;
        IF sheet_row.row_data ? 'تاريخ بدايه الاشتراك' AND sheet_row.row_data->>'تاريخ بدايه الاشتراك' IS NOT NULL AND sheet_row.row_data->>'تاريخ بدايه الاشتراك' != '' THEN
            update_fields := jsonb_set(update_fields, '{insurance_start_date}', to_jsonb(sheet_row.row_data->>'تاريخ بدايه الاشتراك'));
        END IF;
        
        -- Resignation Date (from RES sheet)
        IF sheet_row.sheet_name = 'RES' THEN
            IF sheet_row.row_data ? 'resignation_date' AND sheet_row.row_data->>'resignation_date' IS NOT NULL AND sheet_row.row_data->>'resignation_date' != '' THEN
                update_fields := jsonb_set(update_fields, '{resignation_date}', sheet_row.row_data->'resignation_date');
            END IF;
            IF sheet_row.row_data ? 'تاريخ الاستقاله' AND sheet_row.row_data->>'تاريخ الاستقاله' IS NOT NULL AND sheet_row.row_data->>'تاريخ الاستقاله' != '' THEN
                update_fields := jsonb_set(update_fields, '{resignation_date}', to_jsonb(sheet_row.row_data->>'تاريخ الاستقاله'));
            END IF;
            IF sheet_row.row_data ? 'last_working_day' AND sheet_row.row_data->>'last_working_day' IS NOT NULL AND sheet_row.row_data->>'last_working_day' != '' THEN
                update_fields := jsonb_set(update_fields, '{last_working_day}', sheet_row.row_data->'last_working_day');
            END IF;
            IF sheet_row.row_data ? 'اخر يوم عمل' AND sheet_row.row_data->>'اخر يوم عمل' IS NOT NULL AND sheet_row.row_data->>'اخر يوم عمل' != '' THEN
                update_fields := jsonb_set(update_fields, '{last_working_day}', to_jsonb(sheet_row.row_data->>'اخر يوم عمل'));
            END IF;
        END IF;
        
    END LOOP;
    
    -- Update employees_master with merged data
    UPDATE employees_master
    SET
        employee_code = COALESCE((update_fields->>'employee_code')::TEXT, employee_code),
        national_id = COALESCE((update_fields->>'national_id')::TEXT, national_id),
        current_job_title = COALESCE((update_fields->>'current_job_title')::TEXT, current_job_title),
        current_region = COALESCE((update_fields->>'current_region')::TEXT, current_region),
        current_department = COALESCE((update_fields->>'current_department')::TEXT, current_department),
        current_status = COALESCE((update_fields->>'current_status')::TEXT, current_status),
        insurance_number = COALESCE((update_fields->>'insurance_number')::TEXT, insurance_number),
        insurance_status = COALESCE((update_fields->>'insurance_status')::TEXT, insurance_status),
        insurance_salary = COALESCE((update_fields->>'insurance_salary')::NUMERIC, insurance_salary),
        insurance_job_title = COALESCE((update_fields->>'insurance_job_title')::TEXT, insurance_job_title),
        insurance_start_date = COALESCE((update_fields->>'insurance_start_date')::TEXT, insurance_start_date),
        phone_number = COALESCE((update_fields->>'phone_number')::TEXT, phone_number),
        address = COALESCE((update_fields->>'address')::TEXT, address),
        hire_date = COALESCE((update_fields->>'hire_date')::TEXT, hire_date),
        resignation_date = COALESCE((update_fields->>'resignation_date')::TEXT, resignation_date),
        last_working_day = COALESCE((update_fields->>'last_working_day')::TEXT, last_working_day),
        consolidated_data = merged_data,
        data_completeness_score = calculate_employee_completeness(employee_id_param),
        last_updated_at = NOW()
    WHERE id = employee_id_param;
    
END;
$$ LANGUAGE plpgsql;

-- ───────────────────────────────────────────────────────────────────────────
-- TRIGGER: Auto-consolidate after sheet_data insert/update
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION trigger_consolidate_employee_data()
RETURNS TRIGGER AS $$
BEGIN
    -- Call smart merge for this employee
    PERFORM smart_merge_employee_data(NEW.employee_id);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS after_sheet_data_change ON sheet_data;

CREATE TRIGGER after_sheet_data_change
    AFTER INSERT OR UPDATE ON sheet_data
    FOR EACH ROW
    EXECUTE FUNCTION trigger_consolidate_employee_data();

-- ───────────────────────────────────────────────────────────────────────────
-- RUN CONSOLIDATION ON ALL EXISTING EMPLOYEES
-- ───────────────────────────────────────────────────────────────────────────

DO $$ 
DECLARE
    emp_record RECORD;
    total_count INT := 0;
    processed_count INT := 0;
BEGIN
    -- Get total count
    SELECT COUNT(*) INTO total_count FROM employees_master;
    
    RAISE NOTICE 'بدء عملية دمج البيانات لـ % موظف...', total_count;
    
    -- Process each employee
    FOR emp_record IN SELECT id FROM employees_master ORDER BY created_at
    LOOP
        BEGIN
            PERFORM smart_merge_employee_data(emp_record.id);
            processed_count := processed_count + 1;
            
            -- Log progress every 100 employees
            IF processed_count % 100 = 0 THEN
                RAISE NOTICE 'تم معالجة % من % موظف...', processed_count, total_count;
            END IF;
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'فشل دمج البيانات للموظف %: %', emp_record.id, SQLERRM;
        END;
    END LOOP;
    
    RAISE NOTICE 'اكتمل! تم معالجة % موظف بنجاح.', processed_count;
END $$;

-- ───────────────────────────────────────────────────────────────────────────
-- SUCCESS MESSAGE
-- ───────────────────────────────────────────────────────────────────────────

DO $$ 
BEGIN 
    RAISE NOTICE '✅ نظام الدمج الذكي جاهز!';
    RAISE NOTICE '   - يتم حساب نسبة الاكتمال تلقائياً';
    RAISE NOTICE '   - يتم دمج البيانات من جميع الشيتات تلقائياً';
    RAISE NOTICE '   - يعمل Trigger على كل استيراد جديد';
END $$;
