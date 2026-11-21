-- Migration: Data Quality, Matching Candidates & Saved Reports
-- Purpose: Add tables for discrepancy tracking, manual matching review, and saved report configs

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. DATA DISCREPANCIES TABLE (جدول التعارضات والأخطاء المكتشفة)
-- ═══════════════════════════════════════════════════════════════════════════
-- Stores every conflict detected between data sources for a given employee.
-- Runs of the dataQualityEngine upsert into this table.

CREATE TABLE IF NOT EXISTS public.data_discrepancies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Employee reference (may be NULL if employee not yet identified)
    employee_id UUID REFERENCES public.employees_master(id) ON DELETE CASCADE,

    -- Raw identifiers for cases where employee_id is not resolved
    raw_employee_code TEXT,
    raw_national_id TEXT,
    raw_employee_name TEXT,

    -- Discrepancy classification
    discrepancy_type TEXT NOT NULL,
    -- Examples:
    --   active_in_db_resigned_in_res
    --   active_no_insurance_number
    --   national_id_multiple_codes
    --   insurance_number_multiple_employees
    --   in_insurance_not_in_db
    --   in_db_not_in_insurance
    --   duplicate_bank_account
    --   multiple_job_titles
    --   insurance_ended_still_active
    --   job_title_mismatch_insurance
    --   salary_mismatch
    --   missing_national_id
    --   missing_phone
    --   missing_hire_date

    severity TEXT NOT NULL DEFAULT 'warning',
    -- critical | warning | info

    -- Conflict sources and values
    source_a TEXT,          -- e.g. 'Database', 'RES', 'Social Insurance'
    source_b TEXT,          -- second data source
    field_name TEXT,        -- the conflicting field, e.g. 'current_status'
    value_a TEXT,           -- value from source_a
    value_b TEXT,           -- value from source_b
    description TEXT,       -- human-readable description in Arabic

    -- Resolution tracking
    status TEXT NOT NULL DEFAULT 'open',
    -- open | resolved | ignored | false_positive

    resolved_at TIMESTAMPTZ,
    resolved_by TEXT,
    resolution_notes TEXT,

    -- Timestamps
    first_detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_discrepancies_employee
    ON public.data_discrepancies(employee_id, status);

CREATE INDEX IF NOT EXISTS idx_discrepancies_type
    ON public.data_discrepancies(discrepancy_type, severity, status);

CREATE INDEX IF NOT EXISTS idx_discrepancies_open
    ON public.data_discrepancies(status, first_detected_at DESC)
    WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_discrepancies_raw_ids
    ON public.data_discrepancies(raw_national_id, raw_employee_code);

ALTER TABLE public.data_discrepancies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all operations for service role on data_discrepancies"
    ON public.data_discrepancies FOR ALL USING (true) WITH CHECK (true);

COMMENT ON TABLE public.data_discrepancies IS
    'تعارضات البيانات المكتشفة بين المصادر المختلفة — يتم تحديثها عند كل فحص';


-- ═══════════════════════════════════════════════════════════════════════════
-- 2. MATCHING CANDIDATES TABLE (حالات المطابقة التي تحتاج مراجعة بشرية)
-- ═══════════════════════════════════════════════════════════════════════════
-- When the import engine cannot confidently match a row to an employee,
-- it stores it here as a "candidate" for human review.

CREATE TABLE IF NOT EXISTS public.matching_candidates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Context of where this candidate came from
    import_id UUID REFERENCES public.import_logs(id) ON DELETE SET NULL,
    sheet_name TEXT NOT NULL,

    -- The raw row that could not be auto-matched
    row_data JSONB NOT NULL,
    row_number INTEGER,

    -- Raw identifiers extracted from the row
    raw_code TEXT,
    raw_national_id TEXT,
    raw_name TEXT,

    -- Best candidate found (may be NULL if no candidate at all)
    candidate_employee_id UUID REFERENCES public.employees_master(id) ON DELETE SET NULL,

    -- How we found the candidate
    match_type TEXT,
    -- strong_national_id | strong_account_code | strong_insurance_no
    -- candidate_name | candidate_name_plus_data | no_match

    confidence_score FLOAT,  -- 0.0 – 1.0

    -- Comparison snapshots for the review UI
    candidate_snapshot JSONB,  -- snapshot of employees_master at decision time

    -- Human review
    status TEXT NOT NULL DEFAULT 'pending',
    -- pending | confirmed_match | rejected_new_employee | needs_more_info

    reviewed_by TEXT,
    reviewed_at TIMESTAMPTZ,
    notes TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_matching_candidates_pending
    ON public.matching_candidates(status, created_at DESC)
    WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_matching_candidates_import
    ON public.matching_candidates(import_id, sheet_name);

CREATE INDEX IF NOT EXISTS idx_matching_candidates_employee
    ON public.matching_candidates(candidate_employee_id);

ALTER TABLE public.matching_candidates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all operations for service role on matching_candidates"
    ON public.matching_candidates FOR ALL USING (true) WITH CHECK (true);

COMMENT ON TABLE public.matching_candidates IS
    'سجلات لم يتم مطابقتها تلقائياً وتنتظر مراجعة بشرية قبل الإدراج';


-- ═══════════════════════════════════════════════════════════════════════════
-- 3. SAVED REPORTS TABLE (التقارير المحفوظة — Report Builder)
-- ═══════════════════════════════════════════════════════════════════════════
-- Stores user-defined report configurations created via the Report Builder.

CREATE TABLE IF NOT EXISTS public.saved_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    report_name TEXT NOT NULL,
    report_description TEXT,

    -- Full report configuration as produced by the Report Builder UI
    report_config JSONB NOT NULL,
    -- Schema (example):
    -- {
    --   "sources": ["Database", "Social Insurance"],
    --   "columns": [{"field": "employee_name", "source": "Database", "label": "الاسم"}, ...],
    --   "filters": [{"field": "current_status", "op": "eq", "value": "Active"}, ...],
    --   "grouping": "company_account",
    --   "sorting": {"field": "employee_code", "order": "asc"},
    --   "calculations": ["count", "sum:insurance_salary"],
    --   "export_format": "excel"
    -- }

    -- Ownership
    created_by TEXT,
    is_public BOOLEAN NOT NULL DEFAULT true,
    is_pinned BOOLEAN NOT NULL DEFAULT false,

    -- Usage tracking
    last_run_at TIMESTAMPTZ,
    run_count INTEGER NOT NULL DEFAULT 0,
    last_row_count INTEGER,  -- number of rows returned on last run

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_saved_reports_pinned
    ON public.saved_reports(is_pinned DESC, last_run_at DESC);

CREATE INDEX IF NOT EXISTS idx_saved_reports_public
    ON public.saved_reports(is_public, created_at DESC);

ALTER TABLE public.saved_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all operations for service role on saved_reports"
    ON public.saved_reports FOR ALL USING (true) WITH CHECK (true);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_saved_reports_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_saved_reports_updated
    BEFORE UPDATE ON public.saved_reports
    FOR EACH ROW
    EXECUTE FUNCTION update_saved_reports_updated_at();

COMMENT ON TABLE public.saved_reports IS
    'تقارير مخصصة محفوظة من Report Builder — يمكن إعادة تشغيلها في أي وقت';


-- ═══════════════════════════════════════════════════════════════════════════
-- 4. QUALITY RUN LOG (سجل عمليات فحص الجودة)
-- ═══════════════════════════════════════════════════════════════════════════
-- Tracks each time the data quality engine was run so the UI can show
-- "last checked X minutes ago".

CREATE TABLE IF NOT EXISTS public.quality_run_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_type TEXT NOT NULL DEFAULT 'full',
    -- full | incremental | single_employee

    triggered_by TEXT,  -- 'manual' | 'import' | 'schedule'

    -- Summary stats from that run
    total_employees_checked INTEGER,
    discrepancies_found INTEGER,
    discrepancies_resolved INTEGER,
    new_discrepancies INTEGER,

    duration_ms INTEGER,
    error_message TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.quality_run_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all operations for service role on quality_run_log"
    ON public.quality_run_log FOR ALL USING (true) WITH CHECK (true);

COMMENT ON TABLE public.quality_run_log IS
    'سجل عمليات فحص جودة البيانات';
