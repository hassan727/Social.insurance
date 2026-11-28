-- 20261128000005: one-time fill of EMPTY insurance professions in the master (Hassan 2026-11-28 20:16 / 20:22).
-- Priority: 1) official insurance print 22/9/2026  2) incoming sheet "ارقام وارد التامين" rows with form S1
--           3) insured-list tab of EGYPT GAS.xlsx  4) else stay empty (manual edit).
-- Rules: only empty professions are filled (existing fixed ones untouched); a source row counts only when its
-- national ID matches a person (person_id); tatweel (kashida) is removed, no other change to the wording.
-- The insured-list rows with status مناقضه (contradictory) are skipped. Tatweel is also removed from existing professions (logged).
-- Every fill is written to employee_history (by the 000004 guard) and to insurance_job_fill_log (for rollback).
CREATE TABLE IF NOT EXISTS public.insurance_job_fill_log (
  employee_id UUID PRIMARY KEY, person_id UUID, job TEXT NOT NULL, source TEXT NOT NULL, filled_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
ALTER TABLE public.insurance_job_fill_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service role only" ON public.insurance_job_fill_log;
CREATE POLICY "service role only" ON public.insurance_job_fill_log TO service_role USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.insurance_job_tatweel_log (employee_id UUID PRIMARY KEY, old_job TEXT NOT NULL, new_job TEXT NOT NULL, changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
ALTER TABLE public.insurance_job_tatweel_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service role only" ON public.insurance_job_tatweel_log;
CREATE POLICY "service role only" ON public.insurance_job_tatweel_log TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.clean_job_text(t TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT NULLIF(NULLIF(NULLIF(btrim(regexp_replace(replace(COALESCE(t,''), 'ـ', ''), '\s+', ' ', 'g')), ''), '-'), 'NULL') $$;

DO $$
DECLARE v_src TEXT; v_n INT; v_expected TEXT[] := ARRAY['print_22_9','incoming_s1','insured_list_tab'];
  v_print UUID; v_inc UUID; v_tab UUID; v_before INT;
BEGIN
  SELECT id INTO v_print FROM public.import_logs WHERE source_type='official_insurance_print' ORDER BY created_at DESC LIMIT 1;
  v_inc := '387b8a72-85f4-45ae-afd0-806930203920'; v_tab := '46733197-dd44-47d5-aa4f-9c9c23c4a243';
  IF v_print IS NULL OR NOT EXISTS (SELECT 1 FROM public.import_logs WHERE id = v_inc) OR NOT EXISTS (SELECT 1 FROM public.import_logs WHERE id = v_tab) THEN
    RAISE EXCEPTION 'source imports not found';
  END IF;
  -- step 0: remove tatweel only, from professions that already exist (Hassan 20:26: nothing else about them changes)
  PERFORM set_config('app.manual_edit', 'on', true);
  PERFORM set_config('app.confirmed_by', 'إزالة التطويل فقط (قرار حسن 28/11)', true);
  PERFORM set_config('app.change_reason', 'إزالة التطويل من المهنة التأمينية', true);
  INSERT INTO public.insurance_job_tatweel_log(employee_id, old_job, new_job)
    SELECT id, insurance_job_title, replace(insurance_job_title, 'ـ', '') FROM public.employees_master
     WHERE insurance_job_title LIKE '%ـ%' AND btrim(replace(insurance_job_title, 'ـ', '')) <> '';
  UPDATE public.employees_master m SET insurance_job_title = l.new_job FROM public.insurance_job_tatweel_log l WHERE m.id = l.employee_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; RAISE NOTICE 'tatweel removed from existing: %', v_n;
  PERFORM set_config('app.manual_edit', 'off', true);
  SELECT COUNT(*) INTO v_before FROM public.employees_master WHERE NULLIF(btrim(COALESCE(insurance_job_title,'')),'') IS NOT NULL;
  PERFORM set_config('app.confirmed_by', 'ملء تلقائي مرة واحدة (برنت 22/9 ثم وارد س1 ثم قايمة المؤمنين)', true);

  FOREACH v_src IN ARRAY v_expected LOOP
    CREATE TEMP TABLE _cand ON COMMIT DROP AS
    SELECT person_id, job FROM (
      SELECT i.person_id, public.clean_job_text(
               CASE v_src WHEN 'incoming_s1' THEN COALESCE(NULLIF(btrim(i.insurance_job_title),''), NULLIF(btrim(i.job_title),'')) ELSE i.insurance_job_title END) AS job,
             row_number() OVER (PARTITION BY i.person_id ORDER BY (public.clean_job_text(
               CASE v_src WHEN 'incoming_s1' THEN COALESCE(NULLIF(btrim(i.insurance_job_title),''), NULLIF(btrim(i.job_title),'')) ELSE i.insurance_job_title END)) IS NULL, i.created_at DESC) rn
        FROM public.incoming_insurance_records i
       WHERE i.person_id IS NOT NULL
         AND i.import_id = CASE v_src WHEN 'print_22_9' THEN v_print WHEN 'incoming_s1' THEN v_inc ELSE v_tab END
         AND (v_src <> 'insured_list_tab' OR COALESCE(i.insurance_status,'') <> 'مناقضه')
         AND (v_src <> 'incoming_s1' OR (COALESCE(i.form_type,'') ~ 'س\s*1' AND i.insurance_status IN ('تم التوريد','تم التامين')))
    ) q WHERE rn = 1 AND job IS NOT NULL;
    PERFORM set_config('app.change_reason', 'ملء المهنة التأمينية الفاضية من: ' || v_src, true);
    WITH up AS (
      UPDATE public.employees_master m SET insurance_job_title = c.job, last_updated_at = NOW()
        FROM _cand c
       WHERE m.person_id = c.person_id AND NULLIF(btrim(COALESCE(m.insurance_job_title,'')),'') IS NULL
      RETURNING m.id, m.person_id, c.job)
    INSERT INTO public.insurance_job_fill_log(employee_id, person_id, job, source) SELECT id, person_id, job, v_src FROM up;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RAISE NOTICE 'filled from %: %', v_src, v_n;
    DROP TABLE _cand;
  END LOOP;
  -- safety: nothing that already had a profession was changed
  IF (SELECT COUNT(*) FROM public.employees_master WHERE NULLIF(btrim(COALESCE(insurance_job_title,'')),'') IS NOT NULL)
       <> v_before + (SELECT COUNT(*) FROM public.insurance_job_fill_log) THEN
    RAISE EXCEPTION 'count check failed';
  END IF;
END $$;
