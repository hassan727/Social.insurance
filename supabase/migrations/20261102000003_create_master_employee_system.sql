-- Migration: Create Master Employee System with Dynamic Multi-Sheet Support
-- Purpose: Unified employee master table with history tracking and dynamic sheet imports

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. EMPLOYEES MASTER TABLE (الجدول الرئيسي الموحد للموظفين)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.employees_master (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Core Identifiers (المعرفات الأساسية)
    company_account TEXT NOT NULL, -- E.G or m.g
    employee_code TEXT, -- الكود (unique per company_account)
    national_id TEXT, -- الرقم القومي (global unique identifier)
    employee_name TEXT NOT NULL,
    
    -- Current Status (الحالة الحالية)
    current_status TEXT, -- Active, Resigned, Terminated, New, etc.
    current_job_title TEXT, -- الوظيفة الحالية
    current_region TEXT, -- المنطقة الحالية
    current_department TEXT, -- الإدارة الحالية
    
    -- Insurance Data (بيانات التأمينات)
    insurance_number TEXT, -- الرقم التأميني
    insurance_status TEXT, -- الحالة التأمينية
    insurance_salary DECIMAL(12,2), -- الأجر التأميني
    insurance_job_title TEXT, -- الوظيفة في التأمينات
    insurance_start_date TEXT, -- تاريخ بداية الاشتراك
    
    -- Employment Dates (تواريخ التوظيف)
    hire_date TEXT, -- تاريخ استلام العمل
    resignation_date TEXT, -- تاريخ الاستقالة
    last_working_day TEXT, -- آخر يوم عمل
    
    -- Contact Info (معلومات الاتصال)
    phone_number TEXT,
    address TEXT,
    
    -- Consolidated Data from All Sheets (بيانات مجمعة من كل الورقات)
    -- This JSONB field stores ALL data from all sheets for this employee
    consolidated_data JSONB DEFAULT '{}'::jsonb,
    
    -- Metadata
    first_seen_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    last_updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    last_import_id UUID, -- آخر عملية استيراد
    
    -- Data Quality Flags
    has_duplicate_risk BOOLEAN DEFAULT false,
    data_completeness_score FLOAT, -- 0-100 score based on filled fields
    
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_employees_master_company_code 
    ON public.employees_master(company_account, employee_code);

CREATE INDEX IF NOT EXISTS idx_employees_master_national_id 
    ON public.employees_master(national_id) WHERE national_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_employees_master_status 
    ON public.employees_master(company_account, current_status);

CREATE INDEX IF NOT EXISTS idx_employees_master_name 
    ON public.employees_master(employee_name);

CREATE INDEX IF NOT EXISTS idx_employees_master_updated 
    ON public.employees_master(last_updated_at DESC);

-- Unique constraints
CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_master_unique_code 
    ON public.employees_master(company_account, employee_code) 
    WHERE employee_code IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_master_unique_national_global 
    ON public.employees_master(national_id) 
    WHERE national_id IS NOT NULL;

-- RLS
ALTER TABLE public.employees_master ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all operations for service role on employees_master"
    ON public.employees_master FOR ALL USING (true) WITH CHECK (true);

COMMENT ON TABLE public.employees_master IS 'جدول الموظفين الرئيسي الموحد - يجمع بيانات الموظفين من جميع المصادر';


-- ═══════════════════════════════════════════════════════════════════════════
-- 2. EMPLOYEE HISTORY TABLE (تاريخ تتبع الموظفين)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.employee_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID REFERENCES public.employees_master(id) ON DELETE CASCADE,
    
    -- What changed (ماذا تغير)
    change_type TEXT NOT NULL, -- account_transfer, status_change, data_update, initial_import
    
    -- Transfer tracking (تتبع النقل بين الحسابات)
    from_company_account TEXT,
    to_company_account TEXT,
    from_employee_code TEXT,
    to_employee_code TEXT,
    
    -- Changed fields
    changed_fields TEXT[], -- Array of field names that changed
    old_values JSONB, -- Old values snapshot
    new_values JSONB, -- New values snapshot
    
    -- Context
    import_id UUID REFERENCES public.import_logs(id),
    change_reason TEXT,
    notes TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_employee_history_employee 
    ON public.employee_history(employee_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_employee_history_type 
    ON public.employee_history(change_type);

CREATE INDEX IF NOT EXISTS idx_employee_history_transfer 
    ON public.employee_history(from_company_account, to_company_account) 
    WHERE change_type = 'account_transfer';

ALTER TABLE public.employee_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all operations for service role on employee_history"
    ON public.employee_history FOR ALL USING (true) WITH CHECK (true);

COMMENT ON TABLE public.employee_history IS 'سجل تاريخي لكل التغييرات التي تحدث للموظفين';


-- ═══════════════════════════════════════════════════════════════════════════
-- 3. DYNAMIC SHEETS REGISTRY (سجل الورقات الديناميكية)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.dynamic_sheets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Sheet Identification
    sheet_name TEXT NOT NULL UNIQUE, -- Database, Archives, New, RES, etc.
    display_name TEXT NOT NULL, -- اسم عربي للعرض
    description TEXT,
    
    -- Sheet Configuration
    column_definitions JSONB NOT NULL, -- Array of {key, label, type, aliases[]}
    matching_keys TEXT[] NOT NULL, -- ['employee_code', 'national_id', 'employee_name']
    primary_key_field TEXT, -- Which field is the unique identifier
    
    -- Sheet Behavior
    is_active BOOLEAN DEFAULT true,
    is_master_source BOOLEAN DEFAULT false, -- Is this the authoritative source?
    update_strategy TEXT DEFAULT 'merge', -- merge, replace, append
    
    -- Data Stats
    total_columns INTEGER,
    last_import_date TIMESTAMPTZ,
    total_records_imported INTEGER DEFAULT 0,
    
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_dynamic_sheets_name 
    ON public.dynamic_sheets(sheet_name);

CREATE INDEX IF NOT EXISTS idx_dynamic_sheets_active 
    ON public.dynamic_sheets(is_active);

ALTER TABLE public.dynamic_sheets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all operations for service role on dynamic_sheets"
    ON public.dynamic_sheets FOR ALL USING (true) WITH CHECK (true);

COMMENT ON TABLE public.dynamic_sheets IS 'تعريف ديناميكي لكل ورقة Excel مع قواعد المطابقة والاستيراد';


-- ═══════════════════════════════════════════════════════════════════════════
-- 4. SHEET DATA STORE (تخزين بيانات الورقات)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.sheet_data (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    sheet_id UUID REFERENCES public.dynamic_sheets(id) ON DELETE CASCADE,
    employee_id UUID REFERENCES public.employees_master(id) ON DELETE CASCADE,
    
    -- Row Data
    row_data JSONB NOT NULL, -- Full row data from the sheet
    
    -- Row Identifiers (for matching)
    row_code TEXT,
    row_national_id TEXT,
    row_name TEXT,
    
    -- Metadata
    import_id UUID REFERENCES public.import_logs(id),
    row_number INTEGER, -- Original row number in Excel
    is_latest BOOLEAN DEFAULT true, -- Is this the latest version?
    
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sheet_data_sheet 
    ON public.sheet_data(sheet_id, is_latest);

CREATE INDEX IF NOT EXISTS idx_sheet_data_employee 
    ON public.sheet_data(employee_id, sheet_id);

CREATE INDEX IF NOT EXISTS idx_sheet_data_identifiers 
    ON public.sheet_data(row_code, row_national_id);

CREATE INDEX IF NOT EXISTS idx_sheet_data_import 
    ON public.sheet_data(import_id);

ALTER TABLE public.sheet_data ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all operations for service role on sheet_data"
    ON public.sheet_data FOR ALL USING (true) WITH CHECK (true);

COMMENT ON TABLE public.sheet_data IS 'تخزين فعلي لبيانات كل صف من كل ورقة Excel';


-- ═══════════════════════════════════════════════════════════════════════════
-- 5. MATCHING CONFLICTS LOG (سجل تعارضات المطابقة)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.matching_conflicts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Conflict parties
    employee_a_id UUID REFERENCES public.employees_master(id),
    employee_b_id UUID REFERENCES public.employees_master(id),
    
    -- Conflict details
    conflict_type TEXT NOT NULL, -- same_national_id_diff_code, same_code_diff_national_id, name_similarity
    confidence_score FLOAT, -- 0-100
    
    conflict_data JSONB, -- Details about the conflict
    
    -- Resolution
    resolved BOOLEAN DEFAULT false,
    resolution_action TEXT, -- merged, marked_different, manual_review
    resolved_by TEXT,
    resolved_at TIMESTAMPTZ,
    resolution_notes TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_matching_conflicts_unresolved 
    ON public.matching_conflicts(resolved, created_at DESC) WHERE NOT resolved;

CREATE INDEX IF NOT EXISTS idx_matching_conflicts_employees 
    ON public.matching_conflicts(employee_a_id, employee_b_id);

ALTER TABLE public.matching_conflicts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all operations for service role on matching_conflicts"
    ON public.matching_conflicts FOR ALL USING (true) WITH CHECK (true);

COMMENT ON TABLE public.matching_conflicts IS 'سجل تعارضات المطابقة التي تحتاج مراجعة يدوية';


-- ═══════════════════════════════════════════════════════════════════════════
-- 6. HELPER FUNCTIONS
-- ═══════════════════════════════════════════════════════════════════════════

-- Function to update last_updated_at automatically
CREATE OR REPLACE FUNCTION update_last_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.last_updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for employees_master
CREATE TRIGGER trigger_employees_master_updated
    BEFORE UPDATE ON public.employees_master
    FOR EACH ROW
    EXECUTE FUNCTION update_last_updated_at();

-- Trigger for sheet_data
CREATE TRIGGER trigger_sheet_data_updated
    BEFORE UPDATE ON public.sheet_data
    FOR EACH ROW
    EXECUTE FUNCTION update_last_updated_at();

-- Trigger for dynamic_sheets
CREATE TRIGGER trigger_dynamic_sheets_updated
    BEFORE UPDATE ON public.dynamic_sheets
    FOR EACH ROW
    EXECUTE FUNCTION update_last_updated_at();
