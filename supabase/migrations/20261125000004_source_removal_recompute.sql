-- Forward migration: explicit source removal removes only that source's
-- contribution, with provenance; never resurrects a value after its last
-- source is deleted; distinct from the approved blank-cell no-erase policy.
--
-- Approved scope (user, WhatsApp, authenticated channel):
--   * 2026-11-25 12:04 EET "اكيد موافق..." — admin-DELETE consistency fix,
--     isolated test version only.
--   * 2026-11-25 12:05 EET "ايوه بالظبط كده الحذف بيكون في الورقه بس، لكن
--     بيناته بتكون في اكثر من ورقه تانيه" — a row missing on reimport of the
--     SAME worksheet removes THAT worksheet's contribution only; the employee
--     and other worksheets' contributions are retained; an absent whole
--     worksheet is NOT deletion; blank-cell no-erase still holds.
--
-- Design:
--   1. employees_master gains sheet_source_keys / sheet_source_columns:
--      provenance of which blob keys / scalar columns the sheet merge set
--      in its last run. Maintained on every consolidation.
--   2. _smart_per_key: the per-key newest-per-source pass, shared.
--   3. _smart_consolidate(emp, removal_mode): the 000002 merge logic, plus
--      in removal_mode: blob keys whose provenance was sheet sources and
--      which no surviving is_latest row provides are REMOVED (explicit
--      source removal), and scalar columns previously sheet-sourced with no
--      surviving provider are NULLed. Identity fields national_id and
--      employee_code are EXEMPT from nulling: the master row's identity
--      must survive a data deletion so future reimports still match the
--      same employee instead of duplicating them.
--      Keys never sheet-sourced (e.g. financial_ledger from the classic
--      route) are untouched in every mode. Blank-cell policy unchanged:
--      removal_mode only fires on explicit deletion / snapshot removal,
--      never on blank cells in surviving rows.
--   4. Triggers: AFTER DELETE (statement-level) and AFTER UPDATE when
--      is_latest flips true -> false (snapshot replacement) recompute the
--      affected employees. The UPDATE trigger is named zz_* so it runs
--      AFTER the existing after_sheet_data_change merge trigger.
--   5. Backfill fills provenance ONLY (no value changes): keys/columns
--      currently provided by surviving is_latest rows. Values whose only
--      evidence was deleted before this migration have no provenance and
--      stay as-is (pre-existing window, documented).

ALTER TABLE public.employees_master
  ADD COLUMN IF NOT EXISTS sheet_source_keys JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS sheet_source_columns JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Shared per-key newest-per-source pass over surviving latest rows.
CREATE OR REPLACE FUNCTION _smart_per_key(employee_id_param UUID)
RETURNS TABLE(key TEXT, nvals BIGINT, entries JSONB, anyval JSONB) AS $$
  WITH rows AS (
      SELECT sd.id, sd.row_data, sd.created_at, sd.row_number,
             sd.sheet_id, ds.sheet_name
      FROM sheet_data sd
      JOIN dynamic_sheets ds ON ds.id = sd.sheet_id
      WHERE sd.employee_id = employee_id_param
        AND sd.is_latest = true
  ),
  kv AS (
      SELECT rows.sheet_id, rows.sheet_name, rows.created_at,
             rows.row_number, e.key AS k, e.value AS v
      FROM rows, jsonb_each(rows.row_data) AS e
      WHERE e.value <> 'null'::jsonb
        AND (jsonb_typeof(e.value) <> 'string'
             OR btrim(e.value #>> '{}') <> '')
  ),
  newest_per_source AS (
      SELECT DISTINCT ON (kv.k, kv.sheet_id)
             kv.k AS key, kv.sheet_id, kv.sheet_name, kv.v AS value,
             kv.created_at
      FROM kv
      ORDER BY kv.k, kv.sheet_id, kv.created_at DESC, kv.row_number DESC,
               kv.v::text DESC
  )
  SELECT nps.key::text,
         count(DISTINCT nps.value) AS nvals,
         jsonb_agg(jsonb_build_object('source', nps.sheet_name,
                                      'sheet_id', nps.sheet_id,
                                      'value', nps.value,
                                      'at', nps.created_at)
                   ORDER BY nps.created_at DESC) AS entries,
         (array_agg(nps.value ORDER BY nps.created_at DESC))[1] AS anyval
  FROM newest_per_source nps
  GROUP BY nps.key;
$$ LANGUAGE sql STABLE;

-- Consolidation core. removal_mode = false reproduces the 000002 merge
-- exactly (plus provenance maintenance). removal_mode = true additionally
-- removes contributions whose sources no longer survive.
CREATE OR REPLACE FUNCTION _smart_consolidate(employee_id_param UUID, removal_mode BOOLEAN)
RETURNS VOID AS $$
DECLARE
    r RECORD;
    merged_data JSONB := '{}'::JSONB;
    per_key_data JSONB := '{}'::JSONB;
    conflicts JSONB := '{}'::JSONB;
    update_fields JSONB := '{}'::JSONB;
    null_fields TEXT[] := ARRAY[]::TEXT[];
    sheet_keys TEXT[] := ARRAY[]::TEXT[];
    old_keys TEXT[] := ARRAY[]::TEXT[];
    old_cols TEXT[] := ARRAY[]::TEXT[];
    rk TEXT;
    n BIGINT; v JSONB; ents JSONB;
    ins_sal NUMERIC := NULL;
    ins_sal_set BOOLEAN := false;
BEGIN
    SELECT COALESCE(consolidated_data, '{}'::jsonb),
           COALESCE((SELECT array_agg(x) FROM jsonb_array_elements_text(sheet_source_keys) AS x), ARRAY[]::TEXT[]),
           COALESCE((SELECT array_agg(x) FROM jsonb_array_elements_text(sheet_source_columns) AS x), ARRAY[]::TEXT[])
      INTO merged_data, old_keys, old_cols
    FROM employees_master WHERE id = employee_id_param;
    IF NOT FOUND THEN RETURN; END IF;
    merged_data := COALESCE(merged_data, '{}'::jsonb) - 'field_conflicts';

    FOR r IN SELECT * FROM _smart_per_key(employee_id_param)
    LOOP
        sheet_keys := array_append(sheet_keys, r.key);
        per_key_data := jsonb_set(per_key_data, ARRAY[r.key],
            jsonb_build_object('nvals', r.nvals, 'entries', r.entries));
        IF r.nvals = 1 THEN
            merged_data := jsonb_set(merged_data, ARRAY[r.key], r.anyval);
        ELSE
            merged_data := merged_data - r.key;
            conflicts := jsonb_set(conflicts, ARRAY[r.key], r.entries);
        END IF;
    END LOOP;

    IF removal_mode THEN
        FOREACH rk IN ARRAY old_keys LOOP
            IF NOT rk = ANY(sheet_keys) THEN
                merged_data := merged_data - rk;
            END IF;
        END LOOP;
    END IF;

    -- employee_code: identity field. Removal never nulls it (reimport
    -- matching must keep working); conflict still nulls, as in the merge.
    SELECT d.nvals, d.agreed_value, d.entries INTO n, v, ents
    FROM _smart_field_decision(per_key_data, ARRAY['employee_code','الكود']) d;
    IF n = 1 THEN update_fields := jsonb_set(update_fields, '{employee_code}', v);
    ELSIF n > 1 THEN null_fields := array_append(null_fields, 'employee_code'); conflicts := jsonb_set(conflicts, '{employee_code}', ents); END IF;
    -- national_id: same identity exemption.
    SELECT d.nvals, d.agreed_value, d.entries INTO n, v, ents
    FROM _smart_field_decision(per_key_data, ARRAY['national_id','الرقم القومى']) d;
    IF n = 1 THEN update_fields := jsonb_set(update_fields, '{national_id}', v);
    ELSIF n > 1 THEN null_fields := array_append(null_fields, 'national_id'); conflicts := jsonb_set(conflicts, '{national_id}', ents); END IF;
    -- current_job_title
    SELECT d.nvals, d.agreed_value, d.entries INTO n, v, ents
    FROM _smart_field_decision(per_key_data, ARRAY['job_title','الوظيفه']) d;
    IF n = 1 THEN update_fields := jsonb_set(update_fields, '{current_job_title}', v);
    ELSIF n > 1 THEN null_fields := array_append(null_fields, 'current_job_title'); conflicts := jsonb_set(conflicts, '{current_job_title}', ents);
    ELSIF removal_mode AND 'current_job_title' = ANY(old_cols) THEN null_fields := array_append(null_fields, 'current_job_title'); END IF;
    -- current_region
    SELECT d.nvals, d.agreed_value, d.entries INTO n, v, ents
    FROM _smart_field_decision(per_key_data, ARRAY['region','المنطقه']) d;
    IF n = 1 THEN update_fields := jsonb_set(update_fields, '{current_region}', v);
    ELSIF n > 1 THEN null_fields := array_append(null_fields, 'current_region'); conflicts := jsonb_set(conflicts, '{current_region}', ents);
    ELSIF removal_mode AND 'current_region' = ANY(old_cols) THEN null_fields := array_append(null_fields, 'current_region'); END IF;
    -- current_department
    SELECT d.nvals, d.agreed_value, d.entries INTO n, v, ents
    FROM _smart_field_decision(per_key_data, ARRAY['department','الاداره']) d;
    IF n = 1 THEN update_fields := jsonb_set(update_fields, '{current_department}', v);
    ELSIF n > 1 THEN null_fields := array_append(null_fields, 'current_department'); conflicts := jsonb_set(conflicts, '{current_department}', ents);
    ELSIF removal_mode AND 'current_department' = ANY(old_cols) THEN null_fields := array_append(null_fields, 'current_department'); END IF;
    -- current_status: NULL when its last source is removed. Never a guessed
    -- state (no 'مستقيل', no 'Active' default): unknown stays unknown.
    SELECT d.nvals, d.agreed_value, d.entries INTO n, v, ents
    FROM _smart_field_decision(per_key_data, ARRAY['status','الحاله']) d;
    IF n = 1 THEN update_fields := jsonb_set(update_fields, '{current_status}', v);
    ELSIF n > 1 THEN null_fields := array_append(null_fields, 'current_status'); conflicts := jsonb_set(conflicts, '{current_status}', ents);
    ELSIF removal_mode AND 'current_status' = ANY(old_cols) THEN null_fields := array_append(null_fields, 'current_status'); END IF;
    -- insurance_number
    SELECT d.nvals, d.agreed_value, d.entries INTO n, v, ents
    FROM _smart_field_decision(per_key_data, ARRAY['insurance_number','الرقم التامينى','الرقم التاميني','الرقم التأميني','الرقم التأمينى']) d;
    IF n = 1 THEN update_fields := jsonb_set(update_fields, '{insurance_number}', v);
    ELSIF n > 1 THEN null_fields := array_append(null_fields, 'insurance_number'); conflicts := jsonb_set(conflicts, '{insurance_number}', ents);
    ELSIF removal_mode AND 'insurance_number' = ANY(old_cols) THEN null_fields := array_append(null_fields, 'insurance_number'); END IF;
    -- insurance_status
    SELECT d.nvals, d.agreed_value, d.entries INTO n, v, ents
    FROM _smart_field_decision(per_key_data, ARRAY['insurance_status','الحاله التامينيه','الحالة التأمينية']) d;
    IF n = 1 THEN update_fields := jsonb_set(update_fields, '{insurance_status}', v);
    ELSIF n > 1 THEN null_fields := array_append(null_fields, 'insurance_status'); conflicts := jsonb_set(conflicts, '{insurance_status}', ents);
    ELSIF removal_mode AND 'insurance_status' = ANY(old_cols) THEN null_fields := array_append(null_fields, 'insurance_status'); END IF;
    -- insurance_salary (numeric; unparseable values are ignored)
    SELECT d.nvals, d.agreed_value, d.entries INTO n, v, ents
    FROM _smart_field_decision(per_key_data, ARRAY['insurance_salary','الاجر التامينى']) d;
    IF n = 1 THEN
        BEGIN
            ins_sal := (regexp_replace(v #>> '{}', '[^0-9.\-]', '', 'g'))::NUMERIC;
            ins_sal_set := true;
        EXCEPTION WHEN OTHERS THEN
            ins_sal_set := false;
        END;
    ELSIF n > 1 THEN null_fields := array_append(null_fields, 'insurance_salary'); conflicts := jsonb_set(conflicts, '{insurance_salary}', ents);
    ELSIF removal_mode AND 'insurance_salary' = ANY(old_cols) THEN null_fields := array_append(null_fields, 'insurance_salary'); END IF;
    -- insurance_job_title
    SELECT d.nvals, d.agreed_value, d.entries INTO n, v, ents
    FROM _smart_field_decision(per_key_data, ARRAY['insurance_job_title','الوظيفه في التامينات']) d;
    IF n = 1 THEN update_fields := jsonb_set(update_fields, '{insurance_job_title}', v);
    ELSIF n > 1 THEN null_fields := array_append(null_fields, 'insurance_job_title'); conflicts := jsonb_set(conflicts, '{insurance_job_title}', ents);
    ELSIF removal_mode AND 'insurance_job_title' = ANY(old_cols) THEN null_fields := array_append(null_fields, 'insurance_job_title'); END IF;
    -- phone_number
    SELECT d.nvals, d.agreed_value, d.entries INTO n, v, ents
    FROM _smart_field_decision(per_key_data, ARRAY['phone_number','رقم الهاتف']) d;
    IF n = 1 THEN update_fields := jsonb_set(update_fields, '{phone_number}', v);
    ELSIF n > 1 THEN null_fields := array_append(null_fields, 'phone_number'); conflicts := jsonb_set(conflicts, '{phone_number}', ents);
    ELSIF removal_mode AND 'phone_number' = ANY(old_cols) THEN null_fields := array_append(null_fields, 'phone_number'); END IF;
    -- address
    SELECT d.nvals, d.agreed_value, d.entries INTO n, v, ents
    FROM _smart_field_decision(per_key_data, ARRAY['address','العنوان']) d;
    IF n = 1 THEN update_fields := jsonb_set(update_fields, '{address}', v);
    ELSIF n > 1 THEN null_fields := array_append(null_fields, 'address'); conflicts := jsonb_set(conflicts, '{address}', ents);
    ELSIF removal_mode AND 'address' = ANY(old_cols) THEN null_fields := array_append(null_fields, 'address'); END IF;
    -- hire_date
    SELECT d.nvals, d.agreed_value, d.entries INTO n, v, ents
    FROM _smart_field_decision(per_key_data, ARRAY['hire_date','تاريخ استلام العمل']) d;
    IF n = 1 THEN update_fields := jsonb_set(update_fields, '{hire_date}', v);
    ELSIF n > 1 THEN null_fields := array_append(null_fields, 'hire_date'); conflicts := jsonb_set(conflicts, '{hire_date}', ents);
    ELSIF removal_mode AND 'hire_date' = ANY(old_cols) THEN null_fields := array_append(null_fields, 'hire_date'); END IF;
    -- insurance_start_date
    SELECT d.nvals, d.agreed_value, d.entries INTO n, v, ents
    FROM _smart_field_decision(per_key_data, ARRAY['subscription_start_date','تاريخ بدايه الاشتراك']) d;
    IF n = 1 THEN update_fields := jsonb_set(update_fields, '{insurance_start_date}', v);
    ELSIF n > 1 THEN null_fields := array_append(null_fields, 'insurance_start_date'); conflicts := jsonb_set(conflicts, '{insurance_start_date}', ents);
    ELSIF removal_mode AND 'insurance_start_date' = ANY(old_cols) THEN null_fields := array_append(null_fields, 'insurance_start_date'); END IF;
    -- resignation_date (RES sheet keys only appear on RES rows)
    SELECT d.nvals, d.agreed_value, d.entries INTO n, v, ents
    FROM _smart_field_decision(per_key_data, ARRAY['resignation_date','تاريخ الاستقاله']) d;
    IF n = 1 THEN update_fields := jsonb_set(update_fields, '{resignation_date}', v);
    ELSIF n > 1 THEN null_fields := array_append(null_fields, 'resignation_date'); conflicts := jsonb_set(conflicts, '{resignation_date}', ents);
    ELSIF removal_mode AND 'resignation_date' = ANY(old_cols) THEN null_fields := array_append(null_fields, 'resignation_date'); END IF;
    -- last_working_day
    SELECT d.nvals, d.agreed_value, d.entries INTO n, v, ents
    FROM _smart_field_decision(per_key_data, ARRAY['last_working_day','اخر يوم عمل']) d;
    IF n = 1 THEN update_fields := jsonb_set(update_fields, '{last_working_day}', v);
    ELSIF n > 1 THEN null_fields := array_append(null_fields, 'last_working_day'); conflicts := jsonb_set(conflicts, '{last_working_day}', ents);
    ELSIF removal_mode AND 'last_working_day' = ANY(old_cols) THEN null_fields := array_append(null_fields, 'last_working_day'); END IF;

    IF conflicts <> '{}'::jsonb THEN
        merged_data := jsonb_set(merged_data, '{field_conflicts}', conflicts);
    END IF;

    UPDATE employees_master
    SET
        employee_code = CASE WHEN 'employee_code' = ANY(null_fields) THEN NULL WHEN update_fields ? 'employee_code' THEN update_fields->>'employee_code' ELSE employee_code END,
        national_id = CASE WHEN 'national_id' = ANY(null_fields) THEN NULL WHEN update_fields ? 'national_id' THEN update_fields->>'national_id' ELSE national_id END,
        current_job_title = CASE WHEN 'current_job_title' = ANY(null_fields) THEN NULL WHEN update_fields ? 'current_job_title' THEN update_fields->>'current_job_title' ELSE current_job_title END,
        current_region = CASE WHEN 'current_region' = ANY(null_fields) THEN NULL WHEN update_fields ? 'current_region' THEN update_fields->>'current_region' ELSE current_region END,
        current_department = CASE WHEN 'current_department' = ANY(null_fields) THEN NULL WHEN update_fields ? 'current_department' THEN update_fields->>'current_department' ELSE current_department END,
        current_status = CASE WHEN 'current_status' = ANY(null_fields) THEN NULL WHEN update_fields ? 'current_status' THEN update_fields->>'current_status' ELSE current_status END,
        insurance_number = CASE WHEN 'insurance_number' = ANY(null_fields) THEN NULL WHEN update_fields ? 'insurance_number' THEN update_fields->>'insurance_number' ELSE insurance_number END,
        insurance_status = CASE WHEN 'insurance_status' = ANY(null_fields) THEN NULL WHEN update_fields ? 'insurance_status' THEN update_fields->>'insurance_status' ELSE insurance_status END,
        insurance_salary = CASE WHEN 'insurance_salary' = ANY(null_fields) THEN NULL WHEN ins_sal_set THEN ins_sal ELSE insurance_salary END,
        insurance_job_title = CASE WHEN 'insurance_job_title' = ANY(null_fields) THEN NULL WHEN update_fields ? 'insurance_job_title' THEN update_fields->>'insurance_job_title' ELSE insurance_job_title END,
        insurance_start_date = CASE WHEN 'insurance_start_date' = ANY(null_fields) THEN NULL WHEN update_fields ? 'insurance_start_date' THEN update_fields->>'insurance_start_date' ELSE insurance_start_date END,
        phone_number = CASE WHEN 'phone_number' = ANY(null_fields) THEN NULL WHEN update_fields ? 'phone_number' THEN update_fields->>'phone_number' ELSE phone_number END,
        address = CASE WHEN 'address' = ANY(null_fields) THEN NULL WHEN update_fields ? 'address' THEN update_fields->>'address' ELSE address END,
        hire_date = CASE WHEN 'hire_date' = ANY(null_fields) THEN NULL WHEN update_fields ? 'hire_date' THEN update_fields->>'hire_date' ELSE hire_date END,
        resignation_date = CASE WHEN 'resignation_date' = ANY(null_fields) THEN NULL WHEN update_fields ? 'resignation_date' THEN update_fields->>'resignation_date' ELSE resignation_date END,
        last_working_day = CASE WHEN 'last_working_day' = ANY(null_fields) THEN NULL WHEN update_fields ? 'last_working_day' THEN update_fields->>'last_working_day' ELSE last_working_day END,
        consolidated_data = merged_data,
        sheet_source_keys = to_jsonb(sheet_keys),
        sheet_source_columns = COALESCE(to_jsonb(
            (SELECT array_agg(DISTINCT c) FROM (
                SELECT jsonb_object_keys(update_fields) AS c
                UNION SELECT unnest(null_fields)
            ) t)
        ), '[]'::jsonb),
        data_completeness_score = calculate_employee_completeness(employee_id_param),
        last_updated_at = NOW()
    WHERE id = employee_id_param;
END;
$$ LANGUAGE plpgsql;

-- The public merge keeps its signature and semantics (removal_mode = false).
CREATE OR REPLACE FUNCTION smart_merge_employee_data(employee_id_param UUID)
RETURNS VOID AS $$
BEGIN
    PERFORM _smart_consolidate(employee_id_param, false);
END;
$$ LANGUAGE plpgsql;

-- Recompute after explicit source removal (removal_mode = true).
CREATE OR REPLACE FUNCTION smart_recompute_after_source_removal(employee_id_param UUID)
RETURNS VOID AS $$
BEGIN
    PERFORM _smart_consolidate(employee_id_param, true);
END;
$$ LANGUAGE plpgsql;

-- The baseline per-row merge trigger must NOT run its non-removal merge on
-- an is_latest true -> false flip: that merge would recompute provenance
-- from post-flip rows and wipe the evidence before the removal recompute
-- (zz_ trigger, which fires after it alphabetically) can read it. Skipping
-- here keeps every other INSERT/UPDATE path identical to the baseline.
-- (Body replacement of a baseline FUNCTION via forward migration, same
-- pattern as 000003.)
CREATE OR REPLACE FUNCTION trigger_consolidate_employee_data()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND OLD.is_latest IS TRUE AND NEW.is_latest IS FALSE THEN
        RETURN NEW; -- handled by zz_sheet_data_contribution_removed
    END IF;
    PERFORM smart_merge_employee_data(NEW.employee_id);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Admin DELETE on sheet_data: recompute every affected employee once.
CREATE OR REPLACE FUNCTION trigger_recompute_after_sheet_data_delete()
RETURNS TRIGGER AS $$
DECLARE emp RECORD;
BEGIN
    FOR emp IN SELECT DISTINCT employee_id FROM deleted_rows WHERE employee_id IS NOT NULL
    LOOP
        PERFORM smart_recompute_after_source_removal(emp.employee_id);
    END LOOP;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS after_sheet_data_delete ON sheet_data;
CREATE TRIGGER after_sheet_data_delete
    AFTER DELETE ON sheet_data
    REFERENCING OLD TABLE AS deleted_rows
    FOR EACH STATEMENT
    EXECUTE FUNCTION trigger_recompute_after_sheet_data_delete();

-- Snapshot replacement flips is_latest true -> false: same recompute. The
-- zz_ name makes it run AFTER the existing after_sheet_data_change merge
-- trigger (Postgres fires same-timing triggers alphabetically).
CREATE OR REPLACE FUNCTION trigger_recompute_after_sheet_data_unlatest()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM smart_recompute_after_source_removal(OLD.employee_id);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS zz_sheet_data_contribution_removed ON sheet_data;
CREATE TRIGGER zz_sheet_data_contribution_removed
    AFTER UPDATE OF is_latest ON sheet_data
    FOR EACH ROW
    WHEN (OLD.is_latest IS TRUE AND NEW.is_latest IS FALSE)
    EXECUTE FUNCTION trigger_recompute_after_sheet_data_unlatest();

-- Backfill provenance ONLY (no value changes): keys and alias-columns
-- currently provided by surviving is_latest rows. Anything whose evidence
-- was deleted before this migration has no provenance and stays as-is.
DO $$
DECLARE
    emp RECORD;
    keys_arr TEXT[];
    cols_arr TEXT[];
    pk RECORD;
    n BIGINT; v JSONB; ents JSONB;
BEGIN
    FOR emp IN SELECT DISTINCT employee_id FROM sheet_data WHERE is_latest = true AND employee_id IS NOT NULL
    LOOP
        keys_arr := ARRAY[]::TEXT[];
        cols_arr := ARRAY[]::TEXT[];
        FOR pk IN SELECT * FROM _smart_per_key(emp.employee_id)
        LOOP
            keys_arr := array_append(keys_arr, pk.key);
        END LOOP;
        -- alias columns currently provided (set or conflicting)
        DECLARE
            per_key_data JSONB := '{}'::JSONB;
            pk2 RECORD;
            -- comma-joined (postgres array literals must be rectangular)
            aliases TEXT[] := ARRAY[
                'employee_code,الكود',
                'national_id,الرقم القومى',
                'job_title,الوظيفه',
                'region,المنطقه',
                'department,الاداره',
                'status,الحاله',
                'insurance_number,الرقم التامينى,الرقم التاميني,الرقم التأميني,الرقم التأمينى',
                'insurance_status,الحاله التامينيه,الحالة التأمينية',
                'insurance_salary,الاجر التامينى',
                'insurance_job_title,الوظيفه في التامينات',
                'phone_number,رقم الهاتف',
                'address,العنوان',
                'hire_date,تاريخ استلام العمل',
                'subscription_start_date,تاريخ بدايه الاشتراك',
                'resignation_date,تاريخ الاستقاله',
                'last_working_day,اخر يوم عمل'
            ];
            colnames TEXT[] := ARRAY['employee_code','national_id','current_job_title','current_region','current_department','current_status','insurance_number','insurance_status','insurance_salary','insurance_job_title','phone_number','address','hire_date','insurance_start_date','resignation_date','last_working_day'];
            i INT;
        BEGIN
            FOR pk2 IN SELECT * FROM _smart_per_key(emp.employee_id)
            LOOP
                per_key_data := jsonb_set(per_key_data, ARRAY[pk2.key],
                    jsonb_build_object('nvals', pk2.nvals, 'entries', pk2.entries));
            END LOOP;
            FOR i IN 1..array_length(aliases, 1) LOOP
                SELECT d.nvals INTO n FROM _smart_field_decision(per_key_data, string_to_array(aliases[i], ',')) d;
                IF n >= 1 THEN cols_arr := array_append(cols_arr, colnames[i]); END IF;
            END LOOP;
        END;
        UPDATE employees_master
        SET sheet_source_keys = to_jsonb(keys_arr),
            sheet_source_columns = to_jsonb(cols_arr)
        WHERE id = emp.employee_id;
    END LOOP;
END;
$$;
