-- Migration: Add search_history table
-- Purpose: Track all employee search queries to enable search history export

-- Search History Table
CREATE TABLE IF NOT EXISTS public.search_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    search_query TEXT NOT NULL,
    national_id TEXT,
    employee_code TEXT,
    employee_name TEXT,
    result_found BOOLEAN DEFAULT false,
    results_count INTEGER DEFAULT 0,
    search_timestamp TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    user_ip TEXT,
    -- Store snapshot of key data at search time
    company_account TEXT,
    insurance_status TEXT,
    status TEXT,
    has_resignation BOOLEAN,
    first_both_month TEXT,
    attendance_days TEXT,
    -- Store complete search result for reference
    search_result JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

ALTER TABLE public.search_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all operations for service role on search_history"
    ON public.search_history FOR ALL USING (true) WITH CHECK (true);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_search_history_timestamp 
    ON public.search_history(search_timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_search_history_national_id 
    ON public.search_history(national_id);

CREATE INDEX IF NOT EXISTS idx_search_history_employee_code 
    ON public.search_history(employee_code);

CREATE INDEX IF NOT EXISTS idx_search_history_employee_name 
    ON public.search_history(employee_name);

-- Comment
COMMENT ON TABLE public.search_history IS 'Tracks all employee lookup searches to enable comprehensive search history reporting and export';
