-- Reversal of 20261128000005: empties again only the professions that the fill wrote (and nobody edited since).
-- Run in one transaction (psql -1).
SELECT set_config('app.manual_edit', 'on', true);
SELECT set_config('app.confirmed_by', 'reversal of 000005', true);
UPDATE public.employees_master m SET insurance_job_title = NULL
  FROM public.insurance_job_fill_log l WHERE m.id = l.employee_id AND m.insurance_job_title = l.job;
DELETE FROM public.employee_history h USING public.insurance_job_fill_log l
 WHERE h.employee_id = l.employee_id AND h.change_type = 'insurance_job_change'
   AND h.confirmed_by LIKE 'ملء تلقائي مرة واحدة%';
UPDATE public.employees_master m SET insurance_job_title = l.old_job
  FROM public.insurance_job_tatweel_log l WHERE m.id = l.employee_id AND m.insurance_job_title = l.new_job;
DELETE FROM public.employee_history h USING public.insurance_job_tatweel_log l
 WHERE h.employee_id = l.employee_id AND h.change_type = 'insurance_job_change' AND h.confirmed_by LIKE 'إزالة التطويل%';
DROP TABLE IF EXISTS public.insurance_job_tatweel_log;
DROP TABLE IF EXISTS public.insurance_job_fill_log;
DROP FUNCTION IF EXISTS public.clean_job_text(TEXT);
