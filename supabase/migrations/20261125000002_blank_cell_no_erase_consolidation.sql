-- Forward migration: source-aware consolidation (blank-cell no-erase +
-- same-source correction + cross-source conflict withholding).
--
-- Blank-cell policy approved by the user on their WhatsApp channel
-- 2026-11-25 11:04 EET ("ابددا"), replying yes to the assistant's 11:02
-- proposal: a blank cell in an import file never erases an existing value;
-- clearing requires an explicit user request. Message id
-- wamid.HBgMMjAxMTExNTg1NTI3FQIAEhgWM0VCMDRFMDIyMEFGMjc2OEZDQjA1MwA=.
--
-- Semantics of this merge (independent-source truth design):
--   1. consolidated_data starts from the CURRENT blob, so keys no sheet
--      provides (e.g. financial_ledger written by the classic import route)
--      are never erased by a sheet import.
--   2. For every key that sheet rows DO provide, values are grouped by
--      source (dynamic_sheets.id). Within one source, the NEWEST non-blank
--      row wins: a corrected reimport of the same sheet is a same-source
--      correction and takes effect.
--   3. Across DIFFERENT sources there is NO automatic precedence (no
--      latest-upload-wins, no master-wins): if all sources agree, the key
--      is set; if they disagree, the scalar key is WITHHELD from
--      consolidated_data and every competing value is recorded with its
--      source under consolidated_data.field_conflicts for review.
--      Undated master fields get no special precedence either.
--   4. Blank (jsonb null / empty string) cells never participate: blank
--      means "no data in this file", never "erase". Meaningful 0/false
--      are preserved. Clearing a value is a deliberate user action.
--   5. employees_master scalar columns follow the same rule over their
--      known alias keys: agreement sets the column, disagreement sets it
--      to NULL (unknown stays unknown) and records the conflict.
--
-- Rollback: restore the baseline body of smart_merge_employee_data (and
-- drop _smart_field_decision) with an inverse CREATE OR REPLACE; see the
-- baseline migration 20261113000001_smart_consolidation_system.sql.

-- Helper: given per-key newest-per-source entries (from the blob pass) and
-- a set of alias keys that mean the same canonical field, decide the field:
-- returns nvals = number of DISTINCT values across sources, agreed_value =
-- the single value when nvals = 1, entries = per-source newest entries
-- (newest alias entry per source) for review display.
CREATE OR REPLACE FUNCTION _smart_field_decision(per_key_data JSONB, alias_keys TEXT[])
RETURNS TABLE(nvals BIGINT, agreed_value JSONB, entries JSONB) AS $$
  WITH src AS (
    SELECT e->>'sheet_id' AS sheet_id, e->>'source' AS source,
           e->'value' AS value, (e->>'at')::timestamptz AS at
    FROM jsonb_array_elements(
      COALESCE((
        SELECT jsonb_agg(x)
        FROM unnest(alias_keys) AS a,
             LATERAL jsonb_array_elements(per_key_data->a->'entries') AS x
        WHERE per_key_data ? a
      ), '[]'::jsonb)
    ) AS e
  ),
  newest AS (
    SELECT DISTINCT ON (sheet_id) sheet_id, source, value, at
    FROM src
    ORDER BY sheet_id, at DESC, value::text DESC
  )
  SELECT count(DISTINCT value),
         (array_agg(value ORDER BY at DESC))[1],
         jsonb_agg(jsonb_build_object('source', source, 'sheet_id', sheet_id,
                                      'value', value, 'at', at)
                   ORDER BY at DESC)
  FROM newest;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION smart_merge_employee_data(employee_id_param UUID)
RETURNS VOID AS $$
DECLARE
    r RECORD;
    merged_data JSONB := '{}'::JSONB;
    per_key_data JSONB := '{}'::JSONB;
    conflicts JSONB := '{}'::JSONB;
    update_fields JSONB := '{}'::JSONB;
    null_fields TEXT[] := ARRAY[]::TEXT[];
    n BIGINT; v JSONB; ents JSONB;
    ins_sal NUMERIC := NULL;
    ins_sal_set BOOLEAN := false;
BEGIN
    -- Start from the CURRENT consolidated data; sheet rows then adjust only
    -- the keys they actually provide. field_conflicts is derived state and
    -- is recomputed from sheet rows on every run.
    SELECT COALESCE(consolidated_data, '{}'::jsonb) INTO merged_data
    FROM employees_master WHERE id = employee_id_param;
    merged_data := COALESCE(merged_data, '{}'::jsonb) - 'field_conflicts';

    -- Per-key decision over all latest sheet rows: newest non-blank row per
    -- (key, source sheet); then across sources require agreement.
    FOR r IN
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
                   rows.row_number, e.key, e.value
            FROM rows, jsonb_each(rows.row_data) AS e
            WHERE e.value <> 'null'::jsonb
              AND (jsonb_typeof(e.value) <> 'string'
                   OR btrim(e.value #>> '{}') <> '')
        ),
        newest_per_source AS (
            SELECT DISTINCT ON (key, sheet_id)
                   key, sheet_id, sheet_name, value, created_at
            FROM kv
            ORDER BY key, sheet_id, created_at DESC, row_number DESC,
                     value::text DESC
        ),
        per_key AS (
            SELECT key,
                   count(DISTINCT value) AS nvals,
                   jsonb_agg(jsonb_build_object('source', sheet_name,
                                                'sheet_id', sheet_id,
                                                'value', value,
                                                'at', created_at)
                             ORDER BY created_at DESC) AS entries,
                   (array_agg(value ORDER BY created_at DESC))[1] AS anyval
            FROM newest_per_source
            GROUP BY key
        )
        SELECT * FROM per_key
    LOOP
        per_key_data := jsonb_set(per_key_data, ARRAY[r.key],
            jsonb_build_object('nvals', r.nvals, 'entries', r.entries));
        IF r.nvals = 1 THEN
            merged_data := jsonb_set(merged_data, ARRAY[r.key], r.anyval);
        ELSE
            -- Cross-source disagreement: withhold the scalar, keep every
            -- competing value with its source for review.
            merged_data := merged_data - r.key;
            conflicts := jsonb_set(conflicts, ARRAY[r.key], r.entries);
        END IF;
    END LOOP;

    -- employees_master scalar columns: same rule over alias keys.
    -- Agreement -> set column. Disagreement -> NULL the column (unknown
    -- stays unknown) and record the conflict. No data -> leave column.
    -- employee_code
    SELECT d.nvals, d.agreed_value, d.entries INTO n, v, ents
    FROM _smart_field_decision(per_key_data, ARRAY['employee_code','الكود']) d;
    IF n = 1 THEN update_fields := jsonb_set(update_fields, '{employee_code}', v);
    ELSIF n > 1 THEN null_fields := array_append(null_fields, 'employee_code'); conflicts := jsonb_set(conflicts, '{employee_code}', ents); END IF;
    -- national_id
    SELECT d.nvals, d.agreed_value, d.entries INTO n, v, ents
    FROM _smart_field_decision(per_key_data, ARRAY['national_id','الرقم القومى']) d;
    IF n = 1 THEN update_fields := jsonb_set(update_fields, '{national_id}', v);
    ELSIF n > 1 THEN null_fields := array_append(null_fields, 'national_id'); conflicts := jsonb_set(conflicts, '{national_id}', ents); END IF;
    -- current_job_title
    SELECT d.nvals, d.agreed_value, d.entries INTO n, v, ents
    FROM _smart_field_decision(per_key_data, ARRAY['job_title','الوظيفه']) d;
    IF n = 1 THEN update_fields := jsonb_set(update_fields, '{current_job_title}', v);
    ELSIF n > 1 THEN null_fields := array_append(null_fields, 'current_job_title'); conflicts := jsonb_set(conflicts, '{current_job_title}', ents); END IF;
    -- current_region
    SELECT d.nvals, d.agreed_value, d.entries INTO n, v, ents
    FROM _smart_field_decision(per_key_data, ARRAY['region','المنطقه']) d;
    IF n = 1 THEN update_fields := jsonb_set(update_fields, '{current_region}', v);
    ELSIF n > 1 THEN null_fields := array_append(null_fields, 'current_region'); conflicts := jsonb_set(conflicts, '{current_region}', ents); END IF;
    -- current_department
    SELECT d.nvals, d.agreed_value, d.entries INTO n, v, ents
    FROM _smart_field_decision(per_key_data, ARRAY['department','الاداره']) d;
    IF n = 1 THEN update_fields := jsonb_set(update_fields, '{current_department}', v);
    ELSIF n > 1 THEN null_fields := array_append(null_fields, 'current_department'); conflicts := jsonb_set(conflicts, '{current_department}', ents); END IF;
    -- current_status
    SELECT d.nvals, d.agreed_value, d.entries INTO n, v, ents
    FROM _smart_field_decision(per_key_data, ARRAY['status','الحاله']) d;
    IF n = 1 THEN update_fields := jsonb_set(update_fields, '{current_status}', v);
    ELSIF n > 1 THEN null_fields := array_append(null_fields, 'current_status'); conflicts := jsonb_set(conflicts, '{current_status}', ents); END IF;
    -- insurance_number
    SELECT d.nvals, d.agreed_value, d.entries INTO n, v, ents
    FROM _smart_field_decision(per_key_data, ARRAY['insurance_number','الرقم التامينى','الرقم التاميني','الرقم التأميني','الرقم التأمينى']) d;
    IF n = 1 THEN update_fields := jsonb_set(update_fields, '{insurance_number}', v);
    ELSIF n > 1 THEN null_fields := array_append(null_fields, 'insurance_number'); conflicts := jsonb_set(conflicts, '{insurance_number}', ents); END IF;
    -- insurance_status
    SELECT d.nvals, d.agreed_value, d.entries INTO n, v, ents
    FROM _smart_field_decision(per_key_data, ARRAY['insurance_status','الحاله التامينيه','الحالة التأمينية']) d;
    IF n = 1 THEN update_fields := jsonb_set(update_fields, '{insurance_status}', v);
    ELSIF n > 1 THEN null_fields := array_append(null_fields, 'insurance_status'); conflicts := jsonb_set(conflicts, '{insurance_status}', ents); END IF;
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
    ELSIF n > 1 THEN null_fields := array_append(null_fields, 'insurance_salary'); conflicts := jsonb_set(conflicts, '{insurance_salary}', ents); END IF;
    -- insurance_job_title
    SELECT d.nvals, d.agreed_value, d.entries INTO n, v, ents
    FROM _smart_field_decision(per_key_data, ARRAY['insurance_job_title','الوظيفه في التامينات']) d;
    IF n = 1 THEN update_fields := jsonb_set(update_fields, '{insurance_job_title}', v);
    ELSIF n > 1 THEN null_fields := array_append(null_fields, 'insurance_job_title'); conflicts := jsonb_set(conflicts, '{insurance_job_title}', ents); END IF;
    -- phone_number
    SELECT d.nvals, d.agreed_value, d.entries INTO n, v, ents
    FROM _smart_field_decision(per_key_data, ARRAY['phone_number','رقم الهاتف']) d;
    IF n = 1 THEN update_fields := jsonb_set(update_fields, '{phone_number}', v);
    ELSIF n > 1 THEN null_fields := array_append(null_fields, 'phone_number'); conflicts := jsonb_set(conflicts, '{phone_number}', ents); END IF;
    -- address
    SELECT d.nvals, d.agreed_value, d.entries INTO n, v, ents
    FROM _smart_field_decision(per_key_data, ARRAY['address','العنوان']) d;
    IF n = 1 THEN update_fields := jsonb_set(update_fields, '{address}', v);
    ELSIF n > 1 THEN null_fields := array_append(null_fields, 'address'); conflicts := jsonb_set(conflicts, '{address}', ents); END IF;
    -- hire_date
    SELECT d.nvals, d.agreed_value, d.entries INTO n, v, ents
    FROM _smart_field_decision(per_key_data, ARRAY['hire_date','تاريخ استلام العمل']) d;
    IF n = 1 THEN update_fields := jsonb_set(update_fields, '{hire_date}', v);
    ELSIF n > 1 THEN null_fields := array_append(null_fields, 'hire_date'); conflicts := jsonb_set(conflicts, '{hire_date}', ents); END IF;
    -- insurance_start_date
    SELECT d.nvals, d.agreed_value, d.entries INTO n, v, ents
    FROM _smart_field_decision(per_key_data, ARRAY['subscription_start_date','تاريخ بدايه الاشتراك']) d;
    IF n = 1 THEN update_fields := jsonb_set(update_fields, '{insurance_start_date}', v);
    ELSIF n > 1 THEN null_fields := array_append(null_fields, 'insurance_start_date'); conflicts := jsonb_set(conflicts, '{insurance_start_date}', ents); END IF;
    -- resignation_date (RES sheet keys only appear on RES rows)
    SELECT d.nvals, d.agreed_value, d.entries INTO n, v, ents
    FROM _smart_field_decision(per_key_data, ARRAY['resignation_date','تاريخ الاستقاله']) d;
    IF n = 1 THEN update_fields := jsonb_set(update_fields, '{resignation_date}', v);
    ELSIF n > 1 THEN null_fields := array_append(null_fields, 'resignation_date'); conflicts := jsonb_set(conflicts, '{resignation_date}', ents); END IF;
    -- last_working_day
    SELECT d.nvals, d.agreed_value, d.entries INTO n, v, ents
    FROM _smart_field_decision(per_key_data, ARRAY['last_working_day','اخر يوم عمل']) d;
    IF n = 1 THEN update_fields := jsonb_set(update_fields, '{last_working_day}', v);
    ELSIF n > 1 THEN null_fields := array_append(null_fields, 'last_working_day'); conflicts := jsonb_set(conflicts, '{last_working_day}', ents); END IF;

    IF conflicts <> '{}'::jsonb THEN
        merged_data := jsonb_set(merged_data, '{field_conflicts}', conflicts);
    END IF;

    -- Update employees_master with merged data. For each column: conflict
    -- -> NULL, agreed value -> set, no data -> keep existing value.
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
        data_completeness_score = calculate_employee_completeness(employee_id_param),
        last_updated_at = NOW()
    WHERE id = employee_id_param;

END;
$$ LANGUAGE plpgsql;
