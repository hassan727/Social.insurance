-- Reversal of 20261128000004. Run in one transaction (psql -1). History already written stays in
-- employee_history / source_row_changes (the latter is dropped only if you uncomment the last line).
DROP TRIGGER IF EXISTS zzz_employees_master_guard ON public.employees_master;
DROP FUNCTION IF EXISTS public.guard_employee_master();
DROP FUNCTION IF EXISTS public.edit_employee_profile(UUID, JSONB, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.edit_master_core(UUID, TEXT, TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.get_person_timeline(UUID, INT);
DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['monthly_payroll_records','monthly_insurance_records','incoming_insurance_records','resignation_records'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS zz_log_row_change ON public.%I', t); END LOOP; END $$;
DROP FUNCTION IF EXISTS public.log_source_row_change();
-- DROP TABLE IF EXISTS public.source_row_changes;
