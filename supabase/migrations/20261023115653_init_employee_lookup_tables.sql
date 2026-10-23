-- Migration: init_employee_lookup_tables
-- Purpose: Schema for Employee Insurance & Payroll Lookup application

-- 1. Import Logs Table
CREATE TABLE IF NOT EXISTS public.import_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_type TEXT NOT NULL, -- 'incoming_insurance', 'res', 'monthly_payroll', 'monthly_insurance'
    file_name TEXT NOT NULL,
    sheet_name TEXT,
    period_year INTEGER,
    period_month INTEGER,
    total_rows_read INTEGER DEFAULT 0,
    rows_accepted INTEGER DEFAULT 0,
    rows_rejected INTEGER DEFAULT 0,
    column_mapping JSONB,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

ALTER TABLE public.import_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all operations for service role on import_logs"
    ON public.import_logs FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_import_logs_source_period 
    ON public.import_logs(source_type, period_year, period_month);

-- 2. Incoming Insurance Records (ارقام وارد التامين)
CREATE TABLE IF NOT EXISTS public.incoming_insurance_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    import_id UUID REFERENCES public.import_logs(id) ON DELETE CASCADE,
    employee_code TEXT,
    employee_name TEXT,
    national_id TEXT,
    job_title TEXT,
    status TEXT,
    company_account TEXT, -- الشركه (Account)
    insurance_number TEXT,
    insurance_status TEXT,
    termination_reason TEXT,
    form_type TEXT,
    insurance_job_title TEXT,
    subscription_start_date TEXT,
    subscription_end_date TEXT,
    supply_method TEXT,
    crm_number TEXT,
    record_date TEXT,
    note TEXT,
    raw_data JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

ALTER TABLE public.incoming_insurance_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all operations for service role on incoming_insurance_records"
    ON public.incoming_insurance_records FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_incoming_ins_nat_id ON public.incoming_insurance_records(national_id);
CREATE INDEX IF NOT EXISTS idx_incoming_ins_code ON public.incoming_insurance_records(employee_code);
CREATE INDEX IF NOT EXISTS idx_incoming_ins_name ON public.incoming_insurance_records(employee_name);

-- 3. Resignation Records (ملف RES.)
CREATE TABLE IF NOT EXISTS public.resignation_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    import_id UUID REFERENCES public.import_logs(id) ON DELETE CASCADE,
    employee_code TEXT,
    employee_name TEXT,
    national_id TEXT,
    resignation_date TEXT,
    last_working_day TEXT,
    resignation_type TEXT,
    insurance_supply_type TEXT,
    supply_date TEXT,
    raw_data JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

ALTER TABLE public.resignation_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all operations for service role on resignation_records"
    ON public.resignation_records FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_res_nat_id ON public.resignation_records(national_id);
CREATE INDEX IF NOT EXISTS idx_res_code ON public.resignation_records(employee_code);
CREATE INDEX IF NOT EXISTS idx_res_name ON public.resignation_records(employee_name);

-- 4. Monthly Payroll Records (مرتبات شهرية)
CREATE TABLE IF NOT EXISTS public.monthly_payroll_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    import_id UUID REFERENCES public.import_logs(id) ON DELETE CASCADE,
    period_year INTEGER NOT NULL,
    period_month INTEGER NOT NULL,
    employee_code TEXT,
    national_id TEXT,
    employee_name TEXT,
    attendance_days TEXT,
    job_title TEXT,
    region TEXT,
    department TEXT,
    sap_code TEXT,
    review_status TEXT,
    note TEXT,
    raw_data JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

ALTER TABLE public.monthly_payroll_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all operations for service role on monthly_payroll_records"
    ON public.monthly_payroll_records FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_payroll_period ON public.monthly_payroll_records(period_year, period_month);
CREATE INDEX IF NOT EXISTS idx_payroll_nat_id ON public.monthly_payroll_records(national_id);
CREATE INDEX IF NOT EXISTS idx_payroll_code ON public.monthly_payroll_records(employee_code);
CREATE INDEX IF NOT EXISTS idx_payroll_name ON public.monthly_payroll_records(employee_name);

-- 5. Monthly Insurance Records (تأمينات شهرية)
CREATE TABLE IF NOT EXISTS public.monthly_insurance_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    import_id UUID REFERENCES public.import_logs(id) ON DELETE CASCADE,
    period_year INTEGER NOT NULL,
    period_month INTEGER NOT NULL,
    employee_code TEXT,
    employee_name TEXT,
    national_id TEXT,
    insurance_number TEXT,
    job_title TEXT,
    region TEXT,
    department TEXT,
    sap_code TEXT,
    raw_data JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

ALTER TABLE public.monthly_insurance_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all operations for service role on monthly_insurance_records"
    ON public.monthly_insurance_records FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_ins_period ON public.monthly_insurance_records(period_year, period_month);
CREATE INDEX IF NOT EXISTS idx_ins_nat_id ON public.monthly_insurance_records(national_id);
CREATE INDEX IF NOT EXISTS idx_ins_code ON public.monthly_insurance_records(employee_code);
CREATE INDEX IF NOT EXISTS idx_ins_name ON public.monthly_insurance_records(employee_name);
