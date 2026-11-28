-- Migration: 20261128000003_source_rows_one_per_person.sql
-- Uploads become UPDATES: one row per person per period/request, enforced by the database.
--
-- WHY: payroll / insurance / incoming / resignation tables were plain INSERT targets with
-- only a primary key. Re-uploading a file, or a file with extra blank rows (April payroll had
-- 4678 rows that carried only a national ID), created duplicate rows. Only the code in the
-- route stood between a mistake and a duplicate; the database enforced nothing.
--
-- WHAT
--   1. person_id on the 4 source tables, filled from the national ID (master identity).
--   2. identity_key + row_key (generated): the lock. One row per
--        payroll / monthly insurance : account + year + month + person
--        resignation                 : person + resignation date
--        incoming insurance          : person + company + form + record date + start date + status
--      A person not (yet) in the master is keyed by national ID, never lost, never duplicated.
--   3. Existing duplicates are removed ONLY after being copied to
--      public.removed_duplicate_rows (full row as JSON) so the step is reversible.
--   4. import_source_records(): the single write path. Upsert, preview mode (counts only),
--      master wins on name, review items go to matching_conflicts (existing review list).
-- ROLLBACK: supabase/reversals/20261128000003_source_rows_one_per_person.reversal.sql

-- ── 1. person_id ───────────────────────────────────────────────────────
ALTER TABLE public.monthly_payroll_records   ADD COLUMN IF NOT EXISTS person_id UUID REFERENCES public.persons(id);
ALTER TABLE public.monthly_insurance_records ADD COLUMN IF NOT EXISTS person_id UUID REFERENCES public.persons(id);
ALTER TABLE public.incoming_insurance_records ADD COLUMN IF NOT EXISTS person_id UUID REFERENCES public.persons(id);
ALTER TABLE public.resignation_records       ADD COLUMN IF NOT EXISTS person_id UUID REFERENCES public.persons(id);

CREATE OR REPLACE FUNCTION public.link_source_person_ids() RETURNS JSONB
LANGUAGE plpgsql AS $$
DECLARE a INT; b INT; c INT; d INT;
BEGIN
  UPDATE public.monthly_payroll_records t SET person_id = i.person_id FROM public.person_identifiers i
   WHERE t.person_id IS NULL AND i.kind='national_id' AND i.is_current AND i.value = t.national_id;
  GET DIAGNOSTICS a = ROW_COUNT;
  UPDATE public.monthly_insurance_records t SET person_id = i.person_id FROM public.person_identifiers i
   WHERE t.person_id IS NULL AND i.kind='national_id' AND i.is_current AND i.value = t.national_id;
  GET DIAGNOSTICS b = ROW_COUNT;
  UPDATE public.incoming_insurance_records t SET person_id = i.person_id FROM public.person_identifiers i
   WHERE t.person_id IS NULL AND i.kind='national_id' AND i.is_current AND i.value = t.national_id;
  GET DIAGNOSTICS c = ROW_COUNT;
  UPDATE public.resignation_records t SET person_id = i.person_id FROM public.person_identifiers i
   WHERE t.person_id IS NULL AND i.kind='national_id' AND i.is_current AND i.value = t.national_id;
  GET DIAGNOSTICS d = ROW_COUNT;
  RETURN jsonb_build_object('payroll',a,'monthly_insurance',b,'incoming',c,'resignation',d);
END $$;

SELECT public.link_source_person_ids();

-- ── 2. keys (generated, so no code path can forget them) ───────────────
ALTER TABLE public.monthly_payroll_records ADD COLUMN IF NOT EXISTS identity_key TEXT GENERATED ALWAYS AS (
  COALESCE(person_id::text, 'nid:' || NULLIF(national_id,''), CASE WHEN length(regexp_replace(COALESCE(employee_code,'') || COALESCE(employee_name,''), '[\s\-\.]', '', 'g'))=0 THEN 'row:' || id::text ELSE 'nm:' || COALESCE(employee_code,'') || '|' || COALESCE(employee_name,'') END)) STORED;
ALTER TABLE public.monthly_payroll_records ADD COLUMN IF NOT EXISTS row_key TEXT GENERATED ALWAYS AS (
  COALESCE(account_id::text,'') || '|' || period_year || '|' || period_month || '|' ||
  COALESCE(person_id::text, 'nid:' || NULLIF(national_id,''), CASE WHEN length(regexp_replace(COALESCE(employee_code,'') || COALESCE(employee_name,''), '[\s\-\.]', '', 'g'))=0 THEN 'row:' || id::text ELSE 'nm:' || COALESCE(employee_code,'') || '|' || COALESCE(employee_name,'') END)) STORED;

ALTER TABLE public.monthly_insurance_records ADD COLUMN IF NOT EXISTS identity_key TEXT GENERATED ALWAYS AS (
  COALESCE(person_id::text, 'nid:' || NULLIF(national_id,''), CASE WHEN length(regexp_replace(COALESCE(employee_code,'') || COALESCE(employee_name,''), '[\s\-\.]', '', 'g'))=0 THEN 'row:' || id::text ELSE 'nm:' || COALESCE(employee_code,'') || '|' || COALESCE(employee_name,'') END)) STORED;
ALTER TABLE public.monthly_insurance_records ADD COLUMN IF NOT EXISTS row_key TEXT GENERATED ALWAYS AS (
  COALESCE(account_id::text,'') || '|' || period_year || '|' || period_month || '|' ||
  COALESCE(person_id::text, 'nid:' || NULLIF(national_id,''), CASE WHEN length(regexp_replace(COALESCE(employee_code,'') || COALESCE(employee_name,''), '[\s\-\.]', '', 'g'))=0 THEN 'row:' || id::text ELSE 'nm:' || COALESCE(employee_code,'') || '|' || COALESCE(employee_name,'') END)) STORED;

ALTER TABLE public.resignation_records ADD COLUMN IF NOT EXISTS identity_key TEXT GENERATED ALWAYS AS (
  COALESCE(person_id::text, 'nid:' || NULLIF(national_id,''), CASE WHEN length(regexp_replace(COALESCE(employee_code,'') || COALESCE(employee_name,''), '[\s\-\.]', '', 'g'))=0 THEN 'row:' || id::text ELSE 'nm:' || COALESCE(employee_code,'') || '|' || COALESCE(employee_name,'') END)) STORED;
ALTER TABLE public.resignation_records ADD COLUMN IF NOT EXISTS row_key TEXT GENERATED ALWAYS AS (
  COALESCE(person_id::text, 'nid:' || NULLIF(national_id,''), CASE WHEN length(regexp_replace(COALESCE(employee_code,'') || COALESCE(employee_name,''), '[\s\-\.]', '', 'g'))=0 THEN 'row:' || id::text ELSE 'nm:' || COALESCE(employee_code,'') || '|' || COALESCE(employee_name,'') END) || '|' || COALESCE(resignation_date,'') || '|' || COALESCE(last_working_day,'') || '|' || COALESCE(resignation_type,'') || '|' || COALESCE(supply_date,'')) STORED;

ALTER TABLE public.incoming_insurance_records ADD COLUMN IF NOT EXISTS identity_key TEXT GENERATED ALWAYS AS (
  COALESCE(person_id::text, 'nid:' || NULLIF(national_id,''), CASE WHEN length(regexp_replace(COALESCE(employee_code,'') || COALESCE(employee_name,''), '[\s\-\.]', '', 'g'))=0 THEN 'row:' || id::text ELSE 'nm:' || COALESCE(employee_code,'') || '|' || COALESCE(employee_name,'') END)) STORED;
ALTER TABLE public.incoming_insurance_records ADD COLUMN IF NOT EXISTS row_key TEXT GENERATED ALWAYS AS (
  COALESCE(person_id::text, 'nid:' || NULLIF(national_id,''), CASE WHEN length(regexp_replace(COALESCE(employee_code,'') || COALESCE(employee_name,''), '[\s\-\.]', '', 'g'))=0 THEN 'row:' || id::text ELSE 'nm:' || COALESCE(employee_code,'') || '|' || COALESCE(employee_name,'') END) || '|' ||
  UPPER(COALESCE(company_account,'')) || '|' || COALESCE(form_type,'') || '|' || COALESCE(record_date,'') || '|' ||
  COALESCE(subscription_start_date,'') || '|' || COALESCE(insurance_status,'')) STORED;

-- ── 3. remove existing duplicates, keeping the best row, after archiving ─
CREATE TABLE IF NOT EXISTS public.removed_duplicate_rows (
  id BIGSERIAL PRIMARY KEY, src_table TEXT NOT NULL, kept_id UUID, row_json JSONB NOT NULL,
  removed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), reason TEXT NOT NULL);

-- "Fullness" = how many business fields carry a value (ignoring 0 / empty).
CREATE OR REPLACE FUNCTION public.row_fullness(p JSONB) RETURNS INT LANGUAGE sql IMMUTABLE AS $$
  SELECT COUNT(*)::int FROM jsonb_each_text(p - 'id' - 'import_id' - 'created_at' - 'person_id' - 'identity_key' - 'row_key' - 'raw_data' - 'national_id' - 'period_year' - 'period_month' - 'account_id' - 'company_account') e
   WHERE btrim(e.value) NOT IN ('', '0') $$;

-- Only rows that carry NOTHING the kept row does not already carry are removed
-- (the NID-only rows in April payroll, repeated identical rows). Anything else is
-- left alone so the lock below fails loudly instead of deleting data silently.
CREATE OR REPLACE FUNCTION public.row_is_covered_by(p_row JSONB, p_kept JSONB) RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM jsonb_each_text(p_row - 'id' - 'import_id' - 'created_at' - 'person_id' - 'identity_key' - 'row_key' - 'raw_data') e
     WHERE btrim(e.value) NOT IN ('', '0') AND (p_kept ->> e.key) IS DISTINCT FROM e.value) $$;

DO $$
DECLARE t TEXT; n INT;
BEGIN
  FOREACH t IN ARRAY ARRAY['monthly_payroll_records','monthly_insurance_records','incoming_insurance_records','resignation_records'] LOOP
    EXECUTE format($f$
      WITH ranked AS (
        SELECT id, row_number() OVER w rn, first_value(id) OVER w kept
          FROM public.%I x
        WINDOW w AS (PARTITION BY row_key ORDER BY public.row_fullness(to_jsonb(x)) DESC, created_at DESC, id)),
      del AS (SELECT r.id, r.kept FROM ranked r
               JOIN public.%I d ON d.id = r.id JOIN public.%I k ON k.id = r.kept
              WHERE r.rn > 1 AND public.row_is_covered_by(to_jsonb(d), to_jsonb(k))),
      arch AS (INSERT INTO public.removed_duplicate_rows(src_table, kept_id, row_json, reason)
               SELECT %L, d.kept, to_jsonb(x), 'duplicate: everything it holds is already in the kept row'
                 FROM public.%I x JOIN del d ON d.id = x.id RETURNING 1)
      DELETE FROM public.%I x USING del d WHERE x.id = d.id$f$, t, t, t, t, t, t);
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'removed % covered duplicate rows from %', n, t;
  END LOOP;
END $$;

-- Hassan's explicit decision (19:34, 2026-11-28): for these two people keep the row that has
-- the insurance number. Matched by name + company + form, not by id, so it is reproducible.
WITH ranked AS (
  SELECT id, row_key, row_number() OVER (PARTITION BY row_key
         ORDER BY (NULLIF(NULLIF(btrim(insurance_number),''),'0') IS NOT NULL) DESC, created_at DESC, id) rn,
         first_value(id) OVER (PARTITION BY row_key
         ORDER BY (NULLIF(NULLIF(btrim(insurance_number),''),'0') IS NOT NULL) DESC, created_at DESC, id) kept
    FROM public.incoming_insurance_records
   WHERE (employee_name LIKE 'حسام احمد عوض احمد%' AND UPPER(company_account)='E.G')
      OR (employee_name LIKE 'ابراهيم طنطاوي احمد%' AND employee_code='51796')),
del AS (SELECT id, kept FROM ranked WHERE rn > 1 AND row_key IN (SELECT row_key FROM ranked GROUP BY row_key HAVING COUNT(*) > 1)),
arch AS (INSERT INTO public.removed_duplicate_rows(src_table, kept_id, row_json, reason)
         SELECT 'incoming_insurance_records', d.kept, to_jsonb(x), 'Hassan decision 2026-11-28 19:34: keep the row with the insurance number'
           FROM public.incoming_insurance_records x JOIN del d ON d.id = x.id RETURNING 1)
DELETE FROM public.incoming_insurance_records x USING del d WHERE x.id = d.id;

-- DECISION PENDING (Hassan): 4 April payroll rows have every business column blank but carry a stray
-- number only in the SAP code column (sap_code / "كود الساب": 5743.36 / 6700 / 6381.12 / 6700) next to a full row for
-- the same person. They are archived (not lost) and removed so the lock can be created.
WITH ranked AS (
  SELECT id, row_number() OVER w rn, first_value(id) OVER w kept
    FROM public.monthly_payroll_records x
  WINDOW w AS (PARTITION BY row_key ORDER BY public.row_fullness(to_jsonb(x)) DESC, created_at DESC, id)),
del AS (SELECT r.id, r.kept FROM ranked r JOIN public.monthly_payroll_records d ON d.id = r.id
         WHERE r.rn > 1 AND public.row_fullness(to_jsonb(d) - 'sap_code') = 0),
arch AS (INSERT INTO public.removed_duplicate_rows(src_table, kept_id, row_json, reason)
         SELECT 'monthly_payroll_records', d.kept, to_jsonb(x), 'blank row (only a stray number inside raw_data) next to the full row of the same person'
           FROM public.monthly_payroll_records x JOIN del d ON d.id = x.id RETURNING 1)
DELETE FROM public.monthly_payroll_records x USING del d WHERE x.id = d.id;

-- ── 4. the locks ───────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uq_payroll_one_per_person_month      ON public.monthly_payroll_records(row_key);
CREATE UNIQUE INDEX IF NOT EXISTS uq_monthly_ins_one_per_person_month  ON public.monthly_insurance_records(row_key);
CREATE UNIQUE INDEX IF NOT EXISTS uq_incoming_one_per_request          ON public.incoming_insurance_records(row_key);
CREATE UNIQUE INDEX IF NOT EXISTS uq_resignation_one_per_event         ON public.resignation_records(row_key);
CREATE INDEX IF NOT EXISTS idx_payroll_person   ON public.monthly_payroll_records(person_id);
CREATE INDEX IF NOT EXISTS idx_mins_person      ON public.monthly_insurance_records(person_id);
CREATE INDEX IF NOT EXISTS idx_incoming_person  ON public.incoming_insurance_records(person_id);
CREATE INDEX IF NOT EXISTS idx_res_person       ON public.resignation_records(person_id);

-- ── 5. the single write path ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.norm_ar(p TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT translate(lower(btrim(regexp_replace(COALESCE(p,''), '\s+', ' ', 'g'))), 'أإآىة', 'ااايه') $$;

-- p_rows: JSON array of objects using the target table's own column names.
-- p_preview = TRUE: nothing is written, only counts are returned.
-- Rules: identity = national ID -> person. One row per key (see locks). A re-upload updates.
-- A blank cell never erases a stored value. Master wins on name. Rows that carry only a
-- national ID are skipped. Unmatched people / name / code differences go to matching_conflicts.
CREATE OR REPLACE FUNCTION public.import_source_records(p_table TEXT, p_import_id UUID, p_rows JSONB, p_preview BOOLEAN DEFAULT FALSE)
RETURNS JSONB LANGUAGE plpgsql AS $fn$
DECLARE
  v_ins INT := 0; v_upd INT := 0; v_same INT := 0; v_empty INT := 0; v_dupfile INT := 0;
  v_total INT; v_cols TEXT; v_sel TEXT; v_set TEXT; v_has_acc BOOLEAN; v_inc BOOLEAN; v_rev JSONB;
  v_extra TEXT[] := ARRAY['_acc','_empty','_master_name','_full','_rn','_exists','_same'];
BEGIN
  IF p_table NOT IN ('monthly_payroll_records','monthly_insurance_records','incoming_insurance_records','resignation_records') THEN
    RAISE EXCEPTION 'unsupported table %', p_table;
  END IF;
  v_has_acc := p_table IN ('monthly_payroll_records','monthly_insurance_records');
  v_inc := p_table = 'incoming_insurance_records';
  v_total := jsonb_array_length(p_rows);

  SELECT string_agg(quote_ident(column_name), ',' ORDER BY ordinal_position),
         string_agg('r.' || quote_ident(column_name), ',' ORDER BY ordinal_position)
    INTO v_cols, v_sel
    FROM information_schema.columns
   WHERE table_schema='public' AND table_name=p_table AND column_name NOT IN ('id','identity_key','row_key','created_at');
  SELECT string_agg(format(CASE WHEN data_type='text' THEN '%1$I = COALESCE(NULLIF(EXCLUDED.%1$I, ''''), t.%1$I)'
                              ELSE '%1$I = COALESCE(EXCLUDED.%1$I, t.%1$I)' END, column_name), ', ' ORDER BY ordinal_position)
    INTO v_set
    FROM information_schema.columns
   WHERE table_schema='public' AND table_name=p_table AND column_name NOT IN ('id','identity_key','row_key','created_at');

  DROP TABLE IF EXISTS _in; DROP TABLE IF EXISTS _rev;
  EXECUTE format('CREATE TEMP TABLE _in (LIKE public.%I INCLUDING DEFAULTS INCLUDING GENERATED) ON COMMIT DROP', p_table);
  ALTER TABLE _in ADD COLUMN _acc INT, ADD COLUMN _empty BOOLEAN, ADD COLUMN _master_name TEXT,
                  ADD COLUMN _full INT, ADD COLUMN _rn INT, ADD COLUMN _exists BOOLEAN, ADD COLUMN _same BOOLEAN;
  EXECUTE format('INSERT INTO _in (%s) SELECT %s FROM jsonb_populate_recordset(NULL::public.%I, $1) r', v_cols, v_sel, p_table) USING p_rows;
  UPDATE _in SET import_id = p_import_id, national_id = NULLIF(btrim(national_id), '');

  IF NOT p_preview THEN PERFORM public.link_source_person_ids(); END IF;
  UPDATE _in i SET person_id = pi.person_id FROM public.person_identifiers pi
   WHERE pi.kind='national_id' AND pi.is_current AND pi.value = i.national_id;
  IF v_has_acc THEN UPDATE _in SET _acc = account_id;
  ELSIF v_inc THEN
    UPDATE _in i SET _acc = a.id FROM public.company_accounts a
     WHERE UPPER(btrim(i.company_account)) = UPPER(a.account_code)
        OR UPPER(btrim(i.company_account)) = ANY (SELECT UPPER(x) FROM unnest(a.aliases) x);
  END IF;
  UPDATE _in i SET _master_name = (SELECT m.employee_name FROM public.employees_master m WHERE m.person_id = i.person_id
                                    ORDER BY (m.account_id IS NOT DISTINCT FROM i._acc) DESC LIMIT 1)
   WHERE i.person_id IS NOT NULL;
  UPDATE _in i SET _full = (SELECT COUNT(*) FROM jsonb_each_text(COALESCE(i.raw_data,'{}'::jsonb)) e WHERE btrim(e.value) NOT IN ('','-') AND e.value <> COALESCE(i.national_id,''))
                           + (CASE WHEN COALESCE(i.employee_name,'') NOT IN ('','-') THEN 1 ELSE 0 END)
                           + (CASE WHEN COALESCE(i.employee_code,'') NOT IN ('','-') THEN 1 ELSE 0 END);
  UPDATE _in SET _empty = (_full = 0);

  -- review items (before anything is removed from the batch)
  CREATE TEMP TABLE _rev (kind TEXT, nid TEXT, code TEXT, name TEXT, data JSONB) ON COMMIT DROP;
  INSERT INTO _rev SELECT DISTINCT 'import_empty_row_only', i.national_id, NULL, NULL,
         jsonb_build_object('note','الصف يحتوي على الرقم القومي فقط ولا توجد له بيانات في هذا الملف')
    FROM _in i WHERE i._empty AND i.national_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM _in j WHERE j.national_id = i.national_id AND NOT j._empty);
  INSERT INTO _rev SELECT DISTINCT 'import_unmatched_person', i.national_id, i.employee_code, i.employee_name,
         jsonb_build_object('note','الرقم القومي غير موجود في قاعدة الموظفين الرئيسية، تم حفظ الصف ويحتاج مراجعة')
    FROM _in i WHERE NOT i._empty AND i.person_id IS NULL AND i.national_id IS NOT NULL;
  INSERT INTO _rev SELECT DISTINCT 'import_no_national_id', NULL, i.employee_code, i.employee_name,
         jsonb_build_object('note','الصف بدون رقم قومي، تم حفظه بالكود والاسم ويحتاج مراجعة')
    FROM _in i WHERE NOT i._empty AND i.national_id IS NULL;
  INSERT INTO _rev SELECT DISTINCT 'import_name_differs', i.national_id, i.employee_code, i.employee_name,
         jsonb_build_object('file_name', i.employee_name, 'master_name', i._master_name,
                            'note','الاسم في الملف يختلف عن الاسم في الماستر. الماستر هو المعتمد ولم يتغير')
    FROM _in i WHERE NOT i._empty AND i._master_name IS NOT NULL AND COALESCE(i.employee_name,'') <> ''
     AND public.norm_ar(i.employee_name) <> public.norm_ar(i._master_name);
  INSERT INTO _rev SELECT DISTINCT 'import_code_conflict', i.national_id, i.employee_code, i.employee_name,
         jsonb_build_object('file_code', i.employee_code, 'master_code', c.value, 'note','كود الملف يختلف عن كود الشخص في الماستر لنفس الحساب')
    FROM _in i JOIN public.person_identifiers c ON c.person_id = i.person_id AND c.kind='employee_code' AND c.is_current AND c.account_id = i._acc
   WHERE NOT i._empty AND COALESCE(i.employee_code,'') <> '' AND c.value <> i.employee_code
     AND NOT EXISTS (SELECT 1 FROM public.person_identifiers c2 WHERE c2.person_id=i.person_id AND c2.kind='employee_code' AND c2.is_current AND c2.account_id=i._acc AND c2.value=i.employee_code);
  INSERT INTO _rev SELECT DISTINCT 'import_code_conflict', i.national_id, i.employee_code, i.employee_name,
         jsonb_build_object('file_code', i.employee_code, 'note','هذا الكود مسجل لشخص آخر في نفس الحساب')
    FROM _in i JOIN public.person_identifiers c ON c.kind='employee_code' AND c.is_current AND c.account_id = i._acc AND c.value = i.employee_code
   WHERE NOT i._empty AND c.person_id IS DISTINCT FROM i.person_id;

  -- skip empties, master name wins, collapse repeats inside the file
  SELECT COUNT(*) INTO v_empty FROM _in WHERE _empty;
  DELETE FROM _in WHERE _empty;
  UPDATE _in SET employee_name = _master_name WHERE _master_name IS NOT NULL;
  UPDATE _in SET _rn = x.rn FROM (SELECT ctid c, row_number() OVER (PARTITION BY row_key ORDER BY _full DESC, ctid) rn FROM _in) x WHERE _in.ctid = x.c;
  SELECT COUNT(*) INTO v_dupfile FROM _in WHERE _rn > 1;
  DELETE FROM _in WHERE _rn > 1;

  EXECUTE format($q$UPDATE _in i SET _exists = EXISTS (SELECT 1 FROM public.%1$I t WHERE t.row_key = i.row_key),
      _same = EXISTS (SELECT 1 FROM public.%1$I t WHERE t.row_key = i.row_key AND public.row_is_covered_by(to_jsonb(i) - %2$L::text[], to_jsonb(t)))$q$, p_table, v_extra);

  IF p_preview THEN
    SELECT COUNT(*) FILTER (WHERE NOT _exists), COUNT(*) FILTER (WHERE _exists AND NOT _same), COUNT(*) FILTER (WHERE _same)
      INTO v_ins, v_upd, v_same FROM _in;
  ELSE
    EXECUTE format($q$WITH up AS (
        INSERT INTO public.%1$I AS t (%2$s)
        SELECT %3$s FROM _in r WHERE NOT r._same
        ON CONFLICT (row_key) DO UPDATE SET %4$s
        RETURNING (xmax = 0) AS ins)
      SELECT COUNT(*) FILTER (WHERE ins), COUNT(*) FILTER (WHERE NOT ins) FROM up$q$, p_table, v_cols, v_sel, v_set) INTO v_ins, v_upd;
    SELECT COUNT(*) INTO v_same FROM _in WHERE _same;
    INSERT INTO public.matching_conflicts(conflict_type, conflict_data, resolved)
    SELECT r.kind, jsonb_build_object('source_table', p_table, 'import_id', p_import_id, 'national_id', r.nid,
                                      'employee_code', r.code, 'employee_name', r.name) || r.data, FALSE
      FROM _rev r
     WHERE NOT EXISTS (SELECT 1 FROM public.matching_conflicts m WHERE NOT m.resolved AND m.conflict_type = r.kind
                          AND m.conflict_data->>'source_table' = p_table
                          AND COALESCE(m.conflict_data->>'national_id','') = COALESCE(r.nid,'')
                          AND COALESCE(m.conflict_data->>'employee_code','') = COALESCE(r.code,'')
                          AND COALESCE(m.conflict_data->>'employee_name','') = COALESCE(r.name,''));
  END IF;

  SELECT COALESCE(jsonb_object_agg(kind, n), '{}'::jsonb) INTO v_rev FROM (SELECT kind, COUNT(*) n FROM _rev GROUP BY kind) q;
  RETURN jsonb_build_object('preview', p_preview, 'rows_in_file', v_total, 'skipped_national_id_only', v_empty,
    'repeats_in_same_file', v_dupfile, 'new', v_ins, 'updated', v_upd, 'unchanged', v_same, 'review', v_rev);
END $fn$;

REVOKE EXECUTE ON FUNCTION public.import_source_records(TEXT, UUID, JSONB, BOOLEAN), public.link_source_person_ids() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.import_source_records(TEXT, UUID, JSONB, BOOLEAN), public.link_source_person_ids() TO service_role;

-- ── 6. the 224 people who only have an empty April payroll row go to review ──
INSERT INTO public.matching_conflicts(conflict_type, conflict_data, resolved)
SELECT 'import_empty_row_only', jsonb_build_object('source_table','monthly_payroll_records','national_id', p.national_id,
       'period', p.period_year || '-' || p.period_month, 'import_id', p.import_id,
       'note','صف مرتبات فيه الرقم القومي فقط بدون أي بيانات. لم يُحذف'), FALSE
  FROM public.monthly_payroll_records p
 WHERE p.national_id IS NOT NULL AND COALESCE(p.employee_name,'')='' AND COALESCE(p.employee_code,'')='' AND COALESCE(p.attendance_days,'')=''
;
