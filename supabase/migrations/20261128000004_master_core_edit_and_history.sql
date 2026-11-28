-- 20261128000004: the master (4 fields) is editable safely, and every change keeps old vs new.
-- Master = system number (operating_no / person_uid), account, name, national ID, code.
-- Rules live in the database so no screen or script can break them.
--   1. person_uid never changes. operating_no changes only together with an account transfer.
--   2. The account changes only through confirm_account_transfer / apply_due_company_transfers.
--   3. Every name change is written to employee_history (old and new).
--   4. edit_master_core(): the one safe way to edit name / national ID / code, with clear errors.
--   4b. edit_employee_profile(): edit any profile field + the master in one transaction (history old vs new).
--      The insurance profession is fixed: uploads never change an existing value; only a manual edit does.
--   5. source_row_changes: old vs new for every update to payroll / insurance / incoming / resignation rows.
--   6. get_person_timeline(): current data + latest data per source + the full change list.
-- Reversal: supabase/reversals/20261128000004_master_core_edit_and_history.reversal.sql

-- ── 1-3. guard trigger ──
CREATE OR REPLACE FUNCTION public.guard_employee_master()
RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  v_by TEXT := NULLIF(current_setting('app.confirmed_by', true), '');
  v_transfer BOOLEAN := FALSE;
BEGIN
  IF OLD.person_uid IS NOT NULL AND NEW.person_uid IS DISTINCT FROM OLD.person_uid THEN
    RAISE EXCEPTION 'person_uid_immutable: the unique system number % can never change', OLD.person_uid USING ERRCODE = '23514';
  END IF;
  IF OLD.account_id IS NOT NULL AND NEW.account_id IS DISTINCT FROM OLD.account_id THEN
    -- allowed only when a confirmed transfer / stamp correction to exactly this account is recorded for this employee
    SELECT EXISTS (SELECT 1 FROM public.employee_history h
                    WHERE h.employee_id = OLD.id AND h.change_type IN ('account_transfer','stamp_correction')
                      AND lower(btrim(COALESCE(h.to_company_account,''))) = lower(btrim(COALESCE(NEW.company_account,'')))
                      AND h.effective_date <= CURRENT_DATE) INTO v_transfer;
  END IF;
  IF OLD.account_id IS NOT NULL AND NEW.account_id IS DISTINCT FROM OLD.account_id AND NOT v_transfer THEN
    RAISE EXCEPTION 'account_change_requires_transfer: the account changes only through a confirmed transfer' USING ERRCODE = '23514';
  END IF;
  IF OLD.operating_no IS NOT NULL AND NEW.operating_no IS DISTINCT FROM OLD.operating_no
     AND NEW.account_id IS NOT DISTINCT FROM OLD.account_id THEN
    RAISE EXCEPTION 'operating_no_immutable: the system number % changes only with an account transfer', OLD.operating_no USING ERRCODE = '23514';
  END IF;
  -- Insurance profession is fixed: uploads may fill it only while it is empty, never change it.
  -- Only a manual edit (edit_employee_profile sets app.manual_edit) can change a value that exists.
  IF NEW.insurance_job_title IS DISTINCT FROM OLD.insurance_job_title THEN
    IF NULLIF(btrim(COALESCE(OLD.insurance_job_title,'')), '') IS NOT NULL
       AND COALESCE(current_setting('app.manual_edit', true), '') <> 'on' THEN
      NEW.insurance_job_title := OLD.insurance_job_title;
    ELSE
      INSERT INTO public.employee_history(employee_id, change_type, changed_fields, old_values, new_values,
                                          change_reason, confirmed_by, effective_date)
      VALUES (OLD.id, 'insurance_job_change', ARRAY['insurance_job_title'],
              jsonb_build_object('insurance_job_title', OLD.insurance_job_title),
              jsonb_build_object('insurance_job_title', NEW.insurance_job_title),
              NULLIF(current_setting('app.change_reason', true), ''),
              COALESCE(v_by, CASE WHEN COALESCE(current_setting('app.manual_edit', true), '') = 'on' THEN NULL ELSE 'upload (filled while empty)' END),
              CURRENT_DATE);
    END IF;
  END IF;
  IF NEW.employee_name IS DISTINCT FROM OLD.employee_name THEN
    IF NULLIF(btrim(NEW.employee_name), '') IS NULL THEN
      RAISE EXCEPTION 'name_required: the employee name cannot be empty' USING ERRCODE = '23514';
    END IF;
    INSERT INTO public.employee_history(employee_id, change_type, changed_fields, old_values, new_values,
                                        change_reason, confirmed_by, effective_date)
    VALUES (OLD.id, 'name_change', ARRAY['employee_name'],
            jsonb_build_object('employee_name', OLD.employee_name),
            jsonb_build_object('employee_name', NEW.employee_name),
            NULLIF(current_setting('app.change_reason', true), ''), v_by, CURRENT_DATE);
  END IF;
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS zzz_employees_master_guard ON public.employees_master;
CREATE TRIGGER zzz_employees_master_guard BEFORE UPDATE ON public.employees_master
  FOR EACH ROW EXECUTE FUNCTION public.guard_employee_master();

-- (the two legitimate account-change paths, confirm_account_transfer / apply_due_company_transfers, write the confirmed
--  history row first; the guard above accepts an account change only when such a row matches the new account)

-- ── 4. the one safe edit path ──
CREATE OR REPLACE FUNCTION public.edit_master_core(p_employee_id UUID, p_name TEXT, p_national_id TEXT, p_code TEXT,
                                                  p_by TEXT, p_reason TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql AS $fn$
DECLARE
  e public.employees_master%ROWTYPE;
  v_name TEXT; v_nid TEXT; v_code TEXT; v_holder RECORD; v_changed TEXT[] := '{}';
BEGIN
  IF NULLIF(btrim(COALESCE(p_by,'')), '') IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'confirmed_by_required'); END IF;
  SELECT * INTO e FROM public.employees_master WHERE id = p_employee_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'employee_not_found'); END IF;

  v_name := COALESCE(NULLIF(btrim(p_name), ''), e.employee_name);
  IF p_name IS NOT NULL AND NULLIF(btrim(p_name), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'name_required');
  END IF;
  v_nid := CASE WHEN p_national_id IS NULL THEN e.national_id ELSE NULLIF(regexp_replace(p_national_id, '[^0-9]', '', 'g'), '') END;
  IF v_nid IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'national_id_required'); END IF;
  IF length(v_nid) <> 14 THEN RETURN jsonb_build_object('success', false, 'error', 'national_id_must_be_14_digits'); END IF;
  v_code := CASE WHEN p_code IS NULL THEN e.employee_code ELSE NULLIF(regexp_replace(p_code, '[^0-9a-zA-Z]', '', 'g'), '') END;

  IF v_nid IS DISTINCT FROM e.national_id THEN
    SELECT m.id, m.employee_name, m.company_account, m.operating_no INTO v_holder
      FROM public.person_identifiers pi JOIN public.employees_master m ON m.person_id = pi.person_id
     WHERE pi.kind = 'national_id' AND pi.is_current AND pi.value = v_nid AND pi.person_id <> e.person_id LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'national_id_taken', 'holder_name', v_holder.employee_name,
                                'holder_account', v_holder.company_account, 'holder_number', v_holder.operating_no);
    END IF;
    v_changed := array_append(v_changed, 'national_id');
  END IF;
  IF v_code IS DISTINCT FROM e.employee_code AND v_code IS NOT NULL THEN
    SELECT m.employee_name, m.operating_no INTO v_holder FROM public.employees_master m
     WHERE m.account_id IS NOT DISTINCT FROM e.account_id AND m.id <> e.id
       AND regexp_replace(COALESCE(m.employee_code,''), '[^0-9a-zA-Z]', '', 'g') = v_code LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'code_taken', 'holder_name', v_holder.employee_name, 'holder_number', v_holder.operating_no);
    END IF;
  END IF;
  IF v_code IS DISTINCT FROM e.employee_code THEN v_changed := array_append(v_changed, 'employee_code'); END IF;
  IF v_name IS DISTINCT FROM e.employee_name THEN v_changed := array_append(v_changed, 'employee_name'); END IF;
  IF cardinality(v_changed) = 0 THEN RETURN jsonb_build_object('success', true, 'changed', false, 'changed_fields', '[]'::jsonb); END IF;

  PERFORM set_config('app.confirmed_by', btrim(p_by), true);
  PERFORM set_config('app.change_reason', COALESCE(p_reason, ''), true);
  UPDATE public.employees_master SET employee_name = v_name, national_id = v_nid, employee_code = v_code, last_updated_at = NOW()
   WHERE id = e.id;
  RETURN jsonb_build_object('success', true, 'changed', true, 'changed_fields', to_jsonb(v_changed));
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('success', false, 'error', 'duplicate_blocked', 'detail', SQLERRM);
END $fn$;

-- ── 4b. edit anything in the profile + master, one transaction, one history row ──
CREATE OR REPLACE FUNCTION public.edit_employee_profile(p_employee_id UUID, p_fields JSONB, p_by TEXT, p_reason TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql AS $fn$
DECLARE
  e public.employees_master%ROWTYPE; r public.employees_master%ROWTYPE;
  v_cols TEXT[] := ARRAY['current_status','current_job_title','current_region','current_department','insurance_number',
     'insurance_status','insurance_salary','insurance_job_title','insurance_start_date','hire_date','resignation_date',
     'last_working_day','phone_number','address'];
  v_f JSONB := '{}'; c TEXT; v_set TEXT[] := '{}'; v_old JSONB := '{}'; v_new JSONB := '{}'; v_core JSONB; v_core_changed BOOLEAN := FALSE;
BEGIN
  IF NULLIF(btrim(COALESCE(p_by,'')), '') IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'confirmed_by_required'); END IF;
  SELECT * INTO e FROM public.employees_master WHERE id = p_employee_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'employee_not_found'); END IF;
  PERFORM set_config('app.manual_edit', 'on', true);

  IF p_fields ? 'employee_name' OR p_fields ? 'national_id' OR p_fields ? 'employee_code' THEN
    v_core := public.edit_master_core(p_employee_id, p_fields->>'employee_name', p_fields->>'national_id', p_fields->>'employee_code', p_by, p_reason);
    IF (v_core->>'success')::boolean IS NOT TRUE THEN RETURN v_core; END IF;
    v_core_changed := COALESCE((v_core->>'changed')::boolean, FALSE);
    PERFORM set_config('app.manual_edit', 'on', true);
  END IF;

  FOREACH c IN ARRAY v_cols LOOP
    IF p_fields ? c THEN
      v_f := v_f || jsonb_build_object(c, CASE WHEN jsonb_typeof(p_fields->c) = 'string' AND btrim(p_fields->>c) = '' THEN 'null'::jsonb ELSE p_fields->c END);
    END IF;
  END LOOP;
  IF v_f <> '{}'::jsonb THEN
    BEGIN
      SELECT * INTO e FROM public.employees_master WHERE id = p_employee_id;
      r := jsonb_populate_record(e, v_f);
    EXCEPTION WHEN others THEN
      RETURN jsonb_build_object('success', false, 'error', 'invalid_value', 'detail', SQLERRM);
    END;
    FOREACH c IN ARRAY v_cols LOOP
      IF v_f ? c AND (to_jsonb(r)->c) IS DISTINCT FROM (to_jsonb(e)->c) THEN
        v_set := array_append(v_set, format('%I = ($2).%I', c, c));
        v_old := v_old || jsonb_build_object(c, to_jsonb(e)->c); v_new := v_new || jsonb_build_object(c, to_jsonb(r)->c);
      END IF;
    END LOOP;
    IF cardinality(v_set) > 0 THEN
      PERFORM set_config('app.confirmed_by', btrim(p_by), true);
      PERFORM set_config('app.change_reason', COALESCE(p_reason, ''), true);
      EXECUTE 'UPDATE public.employees_master SET ' || array_to_string(v_set, ', ') || ', last_updated_at = NOW() WHERE id = $1' USING e.id, r;
      -- the insurance profession has its own history row written by the guard
      IF (v_old - 'insurance_job_title') <> '{}'::jsonb THEN
        INSERT INTO public.employee_history(employee_id, change_type, changed_fields, old_values, new_values, change_reason, confirmed_by, effective_date)
        VALUES (e.id, 'profile_change', ARRAY(SELECT jsonb_object_keys(v_old - 'insurance_job_title')), v_old - 'insurance_job_title',
                v_new - 'insurance_job_title', NULLIF(p_reason, ''), btrim(p_by), CURRENT_DATE);
      END IF;
    END IF;
  END IF;
  RETURN jsonb_build_object('success', true, 'changed', v_core_changed OR cardinality(v_set) > 0,
    'changed_fields', COALESCE(v_core->'changed_fields', '[]'::jsonb) || to_jsonb(ARRAY(SELECT jsonb_object_keys(v_new))),
    'core', v_core);
END $fn$;

-- ── 5. old vs new for updates of source rows ──
CREATE TABLE IF NOT EXISTS public.source_row_changes (
  id BIGSERIAL PRIMARY KEY,
  source_table TEXT NOT NULL, row_id UUID NOT NULL, person_id UUID, national_id TEXT,
  import_id UUID, changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  changed_fields TEXT[] NOT NULL, old_values JSONB NOT NULL, new_values JSONB NOT NULL);
CREATE INDEX IF NOT EXISTS idx_src_changes_person ON public.source_row_changes(person_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_src_changes_nid ON public.source_row_changes(national_id);
ALTER TABLE public.source_row_changes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service role only" ON public.source_row_changes;
CREATE POLICY "service role only" ON public.source_row_changes TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.log_source_row_change()
RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE o JSONB; n JSONB; k TEXT; fo JSONB := '{}'; fn JSONB := '{}';
  skip TEXT[] := ARRAY['id','created_at','import_id','person_id','identity_key','row_key','raw_data'];
BEGIN
  o := to_jsonb(OLD); n := to_jsonb(NEW);
  FOR k IN SELECT jsonb_object_keys(n) LOOP
    IF k = ANY(skip) THEN CONTINUE; END IF;
    IF o->k IS DISTINCT FROM n->k THEN fo := fo || jsonb_build_object(k, o->k); fn := fn || jsonb_build_object(k, n->k); END IF;
  END LOOP;
  FOR k IN SELECT jsonb_object_keys(COALESCE(n->'raw_data','{}'::jsonb)) LOOP
    IF (o->'raw_data'->k) IS DISTINCT FROM (n->'raw_data'->k) THEN
      fo := fo || jsonb_build_object(k, o->'raw_data'->k); fn := fn || jsonb_build_object(k, n->'raw_data'->k);
    END IF;
  END LOOP;
  IF fn <> '{}'::jsonb THEN
    INSERT INTO public.source_row_changes(source_table, row_id, person_id, national_id, import_id, changed_fields, old_values, new_values)
    VALUES (TG_TABLE_NAME, NEW.id, NEW.person_id, NEW.national_id, NEW.import_id,
            ARRAY(SELECT jsonb_object_keys(fn)), fo, fn);
  END IF;
  RETURN NEW;
END $fn$;
DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['monthly_payroll_records','monthly_insurance_records','incoming_insurance_records','resignation_records'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS zz_log_row_change ON public.%I', t);
    EXECUTE format('CREATE TRIGGER zz_log_row_change AFTER UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.log_source_row_change()', t);
  END LOOP; END $$;

-- ── 6. everything about one employee ──
-- Returns: master (current data), numbers (system numbers per account), latest (newest row per source table),
-- events (newest first: what changed, old vs new, when, by whom, from which file).
CREATE OR REPLACE FUNCTION public.get_person_timeline(p_employee_id UUID, p_limit INT DEFAULT 300)
RETURNS JSONB LANGUAGE plpgsql STABLE AS $fn$
DECLARE e public.employees_master%ROWTYPE; v_person UUID; v_events JSONB; v_latest JSONB; v_numbers JSONB;
BEGIN
  SELECT * INTO e FROM public.employees_master WHERE id = p_employee_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'employee_not_found'); END IF;
  v_person := e.person_id;

  SELECT COALESCE(jsonb_agg(to_jsonb(q) ORDER BY q.at DESC), '[]'::jsonb) INTO v_events FROM (
    SELECT * FROM (
      SELECT h.created_at AS at, h.change_type AS kind, to_jsonb(h.changed_fields) AS fields, h.old_values AS old_values,
             h.new_values AS new_values, h.confirmed_by AS by, h.change_reason AS reason, NULL::TEXT AS source
        FROM public.employee_history h
       WHERE h.employee_id IN (SELECT id FROM public.employees_master WHERE person_id = v_person)
      UNION ALL
      SELECT c.changed_at, 'source_update:' || c.source_table, to_jsonb(c.changed_fields), c.old_values, c.new_values, NULL, NULL,
             (SELECT l.file_name || COALESCE(' / ' || l.sheet_name, '') FROM public.import_logs l WHERE l.id = c.import_id)
        FROM public.source_row_changes c WHERE c.person_id = v_person
      UNION ALL
      SELECT r.created_at, 'source_row_added:monthly_payroll_records', NULL, NULL,
             jsonb_build_object('period', r.period_year || '-' || r.period_month, 'name', r.employee_name), NULL, NULL,
             (SELECT l.file_name || COALESCE(' / ' || l.sheet_name, '') FROM public.import_logs l WHERE l.id = r.import_id)
        FROM public.monthly_payroll_records r WHERE r.person_id = v_person
      UNION ALL
      SELECT r.created_at, 'source_row_added:monthly_insurance_records', NULL, NULL,
             jsonb_build_object('period', r.period_year || '-' || r.period_month, 'name', r.employee_name), NULL, NULL,
             (SELECT l.file_name || COALESCE(' / ' || l.sheet_name, '') FROM public.import_logs l WHERE l.id = r.import_id)
        FROM public.monthly_insurance_records r WHERE r.person_id = v_person
      UNION ALL
      SELECT r.created_at, 'source_row_added:incoming_insurance_records', NULL, NULL,
             jsonb_build_object('name', r.employee_name, 'status', r.insurance_status), NULL, NULL,
             (SELECT l.file_name || COALESCE(' / ' || l.sheet_name, '') FROM public.import_logs l WHERE l.id = r.import_id)
        FROM public.incoming_insurance_records r WHERE r.person_id = v_person
      UNION ALL
      SELECT r.created_at, 'source_row_added:resignation_records', NULL, NULL,
             jsonb_build_object('resignation_date', r.resignation_date, 'type', r.resignation_type), NULL, NULL,
             (SELECT l.file_name || COALESCE(' / ' || l.sheet_name, '') FROM public.import_logs l WHERE l.id = r.import_id)
        FROM public.resignation_records r WHERE r.person_id = v_person
    ) u ORDER BY u.at DESC LIMIT GREATEST(p_limit, 1)
  ) q;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('account', a.account_code, 'operating_no', n.operating_no, 'assigned_at', n.assigned_at)
                            ORDER BY n.assigned_at), '[]'::jsonb) INTO v_numbers
    FROM public.person_account_numbers n JOIN public.company_accounts a ON a.id = n.account_id WHERE n.person_id = v_person;

  v_latest := jsonb_build_object(
    'payroll', (SELECT to_jsonb(r) - 'raw_data' || jsonb_build_object('raw_data', r.raw_data) FROM public.monthly_payroll_records r
                 WHERE r.person_id = v_person ORDER BY r.period_year DESC, r.period_month DESC, r.created_at DESC LIMIT 1),
    'monthly_insurance', (SELECT to_jsonb(r) FROM public.monthly_insurance_records r
                 WHERE r.person_id = v_person ORDER BY r.period_year DESC, r.period_month DESC, r.created_at DESC LIMIT 1),
    'incoming', (SELECT to_jsonb(r) FROM public.incoming_insurance_records r WHERE r.person_id = v_person ORDER BY r.created_at DESC LIMIT 1),
    'resignation', (SELECT to_jsonb(r) FROM public.resignation_records r WHERE r.person_id = v_person ORDER BY r.created_at DESC LIMIT 1));

  RETURN jsonb_build_object('success', true, 'person_uid', e.person_uid, 'operating_no', e.operating_no,
    'master', jsonb_build_object('employee_name', e.employee_name, 'national_id', e.national_id, 'employee_code', e.employee_code,
                                 'company_account', e.company_account, 'operating_no', e.operating_no, 'person_uid', e.person_uid),
    'numbers', v_numbers, 'latest', v_latest, 'events', v_events);
END $fn$;

REVOKE EXECUTE ON FUNCTION public.edit_master_core(UUID, TEXT, TEXT, TEXT, TEXT, TEXT), public.edit_employee_profile(UUID, JSONB, TEXT, TEXT), public.get_person_timeline(UUID, INT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.edit_master_core(UUID, TEXT, TEXT, TEXT, TEXT, TEXT), public.edit_employee_profile(UUID, JSONB, TEXT, TEXT), public.get_person_timeline(UUID, INT) TO service_role;
