-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: Field Conflicts Table + Deduplication Utilities
-- Purpose: Track per-field conflicts between sheets, enable human approval UI
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- 1. FIELD CONFLICTS TABLE
-- ───────────────────────────────────────────────────────────────────────────
-- Stores every field-level conflict detected between sheet data and
-- employees_master. Each row = one field, one conflict, one decision.

CREATE TABLE IF NOT EXISTS public.field_conflicts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Which employee
    employee_id UUID NOT NULL REFERENCES public.employees_master(id) ON DELETE CASCADE,

    -- Which field is conflicting
    field_name TEXT NOT NULL,
    -- e.g. 'insurance_number', 'hire_date', 'phone_number', 'current_job_title'

    -- Current value in employees_master
    current_value TEXT,
    current_source TEXT,   -- sheet name that set the current value, e.g. 'Database'

    -- Proposed new value from latest import
    proposed_value TEXT NOT NULL,
    proposed_source TEXT NOT NULL,  -- sheet name proposing the change, e.g. 'Social.insurance'
    proposed_import_id UUID REFERENCES public.import_logs(id) ON DELETE SET NULL,

    -- Human review decision
    status TEXT NOT NULL DEFAULT 'pending',
    -- 'pending' | 'approved' (use proposed) | 'rejected' (keep current) | 'merged' (manual)

    merged_value TEXT,     -- if status = 'merged', what did the user type manually

    reviewed_by TEXT,
    reviewed_at TIMESTAMPTZ,
    review_notes TEXT,

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique: one open conflict per employee+field at a time
CREATE UNIQUE INDEX IF NOT EXISTS idx_field_conflicts_unique_pending
    ON public.field_conflicts(employee_id, field_name)
    WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_field_conflicts_employee
    ON public.field_conflicts(employee_id, status);

CREATE INDEX IF NOT EXISTS idx_field_conflicts_pending
    ON public.field_conflicts(status, created_at DESC)
    WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_field_conflicts_field
    ON public.field_conflicts(field_name, status);

ALTER TABLE public.field_conflicts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for service role on field_conflicts"
    ON public.field_conflicts FOR ALL USING (true) WITH CHECK (true);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_field_conflicts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_field_conflicts_updated ON public.field_conflicts;
CREATE TRIGGER trigger_field_conflicts_updated
    BEFORE UPDATE ON public.field_conflicts
    FOR EACH ROW
    EXECUTE FUNCTION update_field_conflicts_updated_at();

COMMENT ON TABLE public.field_conflicts IS
    'تعارضات على مستوى الحقل الواحد بين الشيتات — تنتظر موافقة بشرية';

-- ───────────────────────────────────────────────────────────────────────────
-- 2. FUNCTION: Deduplicate sheet_data — keep only the latest row per
--    (employee_id, sheet_id) pair, mark all others is_latest = false
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION deduplicate_sheet_data(target_sheet_name TEXT DEFAULT NULL)
RETURNS TABLE(
    sheet_name TEXT,
    total_rows BIGINT,
    duplicates_marked BIGINT,
    latest_rows BIGINT
) AS $$
DECLARE
    sheet_rec RECORD;
    total BIGINT;
    dups BIGINT;
    latest BIGINT;
BEGIN
    FOR sheet_rec IN
        SELECT ds.id AS sid, ds.sheet_name AS sname
        FROM dynamic_sheets ds
        WHERE (target_sheet_name IS NULL OR ds.sheet_name = target_sheet_name)
          AND ds.is_active = true
    LOOP
        -- Count total rows for this sheet
        SELECT COUNT(*) INTO total
        FROM sheet_data sd
        WHERE sd.sheet_id = sheet_rec.sid;

        -- Mark all as not-latest first
        UPDATE sheet_data
        SET is_latest = false
        WHERE sheet_id = sheet_rec.sid;

        -- Then mark only the newest row per employee as latest
        UPDATE sheet_data sd
        SET is_latest = true
        WHERE sd.id IN (
            SELECT DISTINCT ON (employee_id) id
            FROM sheet_data
            WHERE sheet_id = sheet_rec.sid
              AND employee_id IS NOT NULL
            ORDER BY employee_id, created_at DESC
        );

        -- Count results
        SELECT COUNT(*) INTO latest
        FROM sheet_data WHERE sheet_id = sheet_rec.sid AND is_latest = true;

        dups := total - latest;

        sheet_name := sheet_rec.sname;
        total_rows := total;
        duplicates_marked := dups;
        latest_rows := latest;
        RETURN NEXT;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION deduplicate_sheet_data IS
    'يصلح is_latest: يبقي فقط أحدث صف لكل موظف في كل شيت، ويضع is_latest=false على الباقي';

-- ───────────────────────────────────────────────────────────────────────────
-- 3. FUNCTION: Detect field conflicts for one employee across all sheets
--    Compares latest sheet_data rows against employees_master columns.
--    Inserts into field_conflicts only when both values exist and differ.
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION detect_employee_field_conflicts(
    employee_id_param UUID,
    import_id_param UUID DEFAULT NULL
)
RETURNS INTEGER AS $$
DECLARE
    emp RECORD;
    sheet_rec RECORD;
    conflict_count INTEGER := 0;

    -- Values from sheet
    v_insurance_number TEXT;
    v_insurance_status TEXT;
    v_insurance_job_title TEXT;
    v_insurance_start_date TEXT;
    v_hire_date TEXT;
    v_job_title TEXT;
    v_region TEXT;
    v_department TEXT;
    v_phone TEXT;
    v_address TEXT;
    v_status TEXT;

    sheet_src TEXT;
BEGIN
    -- Load current employees_master row
    SELECT * INTO emp FROM employees_master WHERE id = employee_id_param;
    IF NOT FOUND THEN RETURN 0; END IF;

    -- Iterate over all latest sheet rows for this employee
    FOR sheet_rec IN
        SELECT sd.row_data, ds.sheet_name
        FROM sheet_data sd
        JOIN dynamic_sheets ds ON ds.id = sd.sheet_id
        WHERE sd.employee_id = employee_id_param
          AND sd.is_latest = true
        ORDER BY ds.is_master_source DESC, sd.created_at DESC
    LOOP
        sheet_src := sheet_rec.sheet_name;

        -- Extract values (English keys + Arabic aliases)
        v_insurance_number := COALESCE(
            sheet_rec.row_data->>'insurance_number',
            sheet_rec.row_data->>'الرقم التامينى',
            sheet_rec.row_data->>'الرقم التاميني',
            sheet_rec.row_data->>'الرقم التأميني'
        );
        v_insurance_status := COALESCE(
            sheet_rec.row_data->>'insurance_status',
            sheet_rec.row_data->>'الحاله التامينيه',
            sheet_rec.row_data->>'الحالة التأمينية'
        );
        v_insurance_job_title := COALESCE(
            sheet_rec.row_data->>'insurance_job_title',
            sheet_rec.row_data->>'الوظيفه في التامينات'
        );
        v_insurance_start_date := COALESCE(
            sheet_rec.row_data->>'subscription_start_date',
            sheet_rec.row_data->>'تاريخ بدايه الاشتراك'
        );
        v_hire_date := COALESCE(
            sheet_rec.row_data->>'hire_date',
            sheet_rec.row_data->>'تاريخ استلام العمل',
            sheet_rec.row_data->>'تاريخ التعيين'
        );
        v_job_title := COALESCE(
            sheet_rec.row_data->>'job_title',
            sheet_rec.row_data->>'الوظيفه',
            sheet_rec.row_data->>'الوظيفة'
        );
        v_region := COALESCE(
            sheet_rec.row_data->>'region',
            sheet_rec.row_data->>'المنطقه',
            sheet_rec.row_data->>'المنطقة'
        );
        v_department := COALESCE(
            sheet_rec.row_data->>'department',
            sheet_rec.row_data->>'الاداره',
            sheet_rec.row_data->>'الإدارة'
        );
        v_phone := COALESCE(
            sheet_rec.row_data->>'phone_number',
            sheet_rec.row_data->>'رقم الهاتف',
            sheet_rec.row_data->>'التليفون'
        );
        v_address := COALESCE(
            sheet_rec.row_data->>'address',
            sheet_rec.row_data->>'العنوان'
        );
        v_status := COALESCE(
            sheet_rec.row_data->>'status',
            sheet_rec.row_data->>'الحاله',
            sheet_rec.row_data->>'الحالة'
        );

        -- Helper: insert conflict if both values exist and differ
        -- Insurance Number
        IF v_insurance_number IS NOT NULL AND v_insurance_number != ''
           AND emp.insurance_number IS NOT NULL AND emp.insurance_number != ''
           AND TRIM(v_insurance_number) != TRIM(emp.insurance_number) THEN
            INSERT INTO field_conflicts(employee_id, field_name, current_value, current_source, proposed_value, proposed_source, proposed_import_id)
            VALUES (employee_id_param, 'insurance_number', emp.insurance_number, 'employees_master', v_insurance_number, sheet_src, import_id_param)
            ON CONFLICT (employee_id, field_name) WHERE status = 'pending' DO NOTHING;
            conflict_count := conflict_count + 1;
        END IF;

        -- Hire Date
        IF v_hire_date IS NOT NULL AND v_hire_date != ''
           AND emp.hire_date IS NOT NULL AND emp.hire_date != ''
           AND TRIM(v_hire_date) != TRIM(emp.hire_date) THEN
            INSERT INTO field_conflicts(employee_id, field_name, current_value, current_source, proposed_value, proposed_source, proposed_import_id)
            VALUES (employee_id_param, 'hire_date', emp.hire_date, 'employees_master', v_hire_date, sheet_src, import_id_param)
            ON CONFLICT (employee_id, field_name) WHERE status = 'pending' DO NOTHING;
            conflict_count := conflict_count + 1;
        END IF;

        -- Job Title
        IF v_job_title IS NOT NULL AND v_job_title != ''
           AND emp.current_job_title IS NOT NULL AND emp.current_job_title != ''
           AND TRIM(LOWER(v_job_title)) != TRIM(LOWER(emp.current_job_title)) THEN
            INSERT INTO field_conflicts(employee_id, field_name, current_value, current_source, proposed_value, proposed_source, proposed_import_id)
            VALUES (employee_id_param, 'current_job_title', emp.current_job_title, 'employees_master', v_job_title, sheet_src, import_id_param)
            ON CONFLICT (employee_id, field_name) WHERE status = 'pending' DO NOTHING;
            conflict_count := conflict_count + 1;
        END IF;

        -- Region
        IF v_region IS NOT NULL AND v_region != ''
           AND emp.current_region IS NOT NULL AND emp.current_region != ''
           AND TRIM(LOWER(v_region)) != TRIM(LOWER(emp.current_region)) THEN
            INSERT INTO field_conflicts(employee_id, field_name, current_value, current_source, proposed_value, proposed_source, proposed_import_id)
            VALUES (employee_id_param, 'current_region', emp.current_region, 'employees_master', v_region, sheet_src, import_id_param)
            ON CONFLICT (employee_id, field_name) WHERE status = 'pending' DO NOTHING;
            conflict_count := conflict_count + 1;
        END IF;

        -- Phone Number
        IF v_phone IS NOT NULL AND v_phone != ''
           AND emp.phone_number IS NOT NULL AND emp.phone_number != ''
           AND TRIM(v_phone) != TRIM(emp.phone_number) THEN
            INSERT INTO field_conflicts(employee_id, field_name, current_value, current_source, proposed_value, proposed_source, proposed_import_id)
            VALUES (employee_id_param, 'phone_number', emp.phone_number, 'employees_master', v_phone, sheet_src, import_id_param)
            ON CONFLICT (employee_id, field_name) WHERE status = 'pending' DO NOTHING;
            conflict_count := conflict_count + 1;
        END IF;

        -- Insurance Start Date
        IF v_insurance_start_date IS NOT NULL AND v_insurance_start_date != ''
           AND emp.insurance_start_date IS NOT NULL AND emp.insurance_start_date != ''
           AND TRIM(v_insurance_start_date) != TRIM(emp.insurance_start_date) THEN
            INSERT INTO field_conflicts(employee_id, field_name, current_value, current_source, proposed_value, proposed_source, proposed_import_id)
            VALUES (employee_id_param, 'insurance_start_date', emp.insurance_start_date, 'employees_master', v_insurance_start_date, sheet_src, import_id_param)
            ON CONFLICT (employee_id, field_name) WHERE status = 'pending' DO NOTHING;
            conflict_count := conflict_count + 1;
        END IF;

    END LOOP;

    RETURN conflict_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION detect_employee_field_conflicts IS
    'يكتشف التعارضات بين شيتات الموظف وemployees_master ويسجلها في field_conflicts';

-- ───────────────────────────────────────────────────────────────────────────
-- 4. FUNCTION: Run conflict detection for ALL employees (batch)
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION detect_all_field_conflicts()
RETURNS TABLE(employees_scanned INTEGER, total_conflicts_found INTEGER) AS $$
DECLARE
    emp_rec RECORD;
    scanned INTEGER := 0;
    total INTEGER := 0;
    n INTEGER;
BEGIN
    FOR emp_rec IN SELECT id FROM employees_master ORDER BY created_at
    LOOP
        BEGIN
            SELECT detect_employee_field_conflicts(emp_rec.id) INTO n;
            total := total + n;
            scanned := scanned + 1;
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'فشل فحص الموظف %: %', emp_rec.id, SQLERRM;
        END;
    END LOOP;

    employees_scanned := scanned;
    total_conflicts_found := total;
    RETURN NEXT;
END;
$$ LANGUAGE plpgsql;

-- ───────────────────────────────────────────────────────────────────────────
-- 5. FUNCTION: Apply approved/rejected conflict decision to employees_master
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION apply_conflict_decision(
    conflict_id_param UUID,
    decision TEXT,          -- 'approved' | 'rejected' | 'merged'
    merged_val TEXT DEFAULT NULL,
    reviewed_by_param TEXT DEFAULT 'User'
)
RETURNS BOOLEAN AS $$
DECLARE
    cf RECORD;
    final_value TEXT;
BEGIN
    SELECT * INTO cf FROM field_conflicts WHERE id = conflict_id_param AND status = 'pending';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'التعارض غير موجود أو تمت معالجته بالفعل: %', conflict_id_param;
    END IF;

    -- Determine final value
    IF decision = 'approved' THEN
        final_value := cf.proposed_value;
    ELSIF decision = 'rejected' THEN
        final_value := cf.current_value;  -- keep current, no update needed
    ELSIF decision = 'merged' THEN
        final_value := merged_val;
    ELSE
        RAISE EXCEPTION 'قرار غير معروف: %', decision;
    END IF;

    -- Apply to employees_master if approved or merged
    IF decision IN ('approved', 'merged') AND final_value IS NOT NULL THEN
        EXECUTE format(
            'UPDATE employees_master SET %I = $1, last_updated_at = NOW() WHERE id = $2',
            cf.field_name
        ) USING final_value, cf.employee_id;

        -- Log to employee_history
        INSERT INTO employee_history(
            employee_id, change_type, changed_fields, old_values, new_values
        ) VALUES (
            cf.employee_id,
            'conflict_resolved',
            ARRAY[cf.field_name],
            jsonb_build_object(cf.field_name, cf.current_value),
            jsonb_build_object(cf.field_name, final_value)
        );
    END IF;

    -- Update conflict status
    UPDATE field_conflicts
    SET status = decision,
        merged_value = merged_val,
        reviewed_by = reviewed_by_param,
        reviewed_at = NOW()
    WHERE id = conflict_id_param;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION apply_conflict_decision IS
    'يطبق قرار المراجعة (قبول/رفض/دمج) على employees_master ويسجل في التاريخ';

-- ───────────────────────────────────────────────────────────────────────────
-- 6. VIEW: Conflicts with employee info for the UI
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW v_pending_conflicts AS
SELECT
    fc.id,
    fc.employee_id,
    em.employee_name,
    em.employee_code,
    em.national_id,
    em.company_account,
    fc.field_name,
    fc.current_value,
    fc.current_source,
    fc.proposed_value,
    fc.proposed_source,
    fc.status,
    fc.created_at,
    fc.updated_at
FROM field_conflicts fc
JOIN employees_master em ON em.id = fc.employee_id
WHERE fc.status = 'pending'
ORDER BY fc.created_at DESC;

COMMENT ON VIEW v_pending_conflicts IS 'تعارضات البيانات المعلقة مع بيانات الموظف — للعرض في واجهة المراجعة';

-- ───────────────────────────────────────────────────────────────────────────
-- SUCCESS
-- ───────────────────────────────────────────────────────────────────────────
DO $$ BEGIN
    RAISE NOTICE '✅ field_conflicts table created';
    RAISE NOTICE '✅ deduplicate_sheet_data() function ready';
    RAISE NOTICE '✅ detect_employee_field_conflicts() function ready';
    RAISE NOTICE '✅ detect_all_field_conflicts() function ready';
    RAISE NOTICE '✅ apply_conflict_decision() function ready';
    RAISE NOTICE '✅ v_pending_conflicts view ready';
END $$;
