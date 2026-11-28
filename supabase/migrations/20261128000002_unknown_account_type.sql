-- Migration: 20261128000002_unknown_account_type.sql
-- New account type "مجهول الحساب" (code UNK) for people whose company is not known.
-- It has its own gapless counter (UNK-000001 ...), like EG / MG / GASCO / DMC, so these
-- people are separated from Egypt Gas. A person keeps the same person number (P-...)
-- when the real account becomes known: they are moved with confirm_account_transfer,
-- get (or keep) the number of the real account, and the UNK number stays in
-- person_account_numbers as history. Nothing is deleted or rewritten.
-- ROLLBACK: supabase/reversals/20261128000002_unknown_account_type.reversal.sql

SELECT setval('public.company_accounts_id_seq', (SELECT COALESCE(MAX(id), 1) FROM public.company_accounts));
INSERT INTO public.company_accounts(account_code, account_name, aliases, description)
VALUES ('UNK', 'مجهول الحساب', ARRAY['UNK','unk','unknown','Unknown','غير محدد','مجهول الحساب','مجهول'],
        'people whose company is not known yet; moved to a real account with confirm_account_transfer')
ON CONFLICT (account_code) DO NOTHING;

-- Everything the database holds about one person, found through ALL of the person's
-- national IDs (current and corrected/old ones). Read-only; the source tables are not changed.
CREATE OR REPLACE FUNCTION public.person_source_records(p_person_uid TEXT)
RETURNS TABLE(source TEXT, record_id TEXT, national_id TEXT, employee_code TEXT, employee_name TEXT,
              period_year INT, period_month INT, account TEXT, detail TEXT)
LANGUAGE sql STABLE AS $$
    WITH p AS (SELECT id FROM public.persons WHERE person_uid = p_person_uid),
    nids AS (SELECT DISTINCT i.value AS nid FROM public.person_identifiers i JOIN p ON p.id = i.person_id WHERE i.kind = 'national_id')
    SELECT 'monthly_payroll_records', r.id::text, r.national_id, r.employee_code, r.employee_name,
           r.period_year, r.period_month, (SELECT account_code FROM public.company_accounts a WHERE a.id = r.account_id), r.job_title
    FROM public.monthly_payroll_records r WHERE REGEXP_REPLACE(COALESCE(r.national_id,''),'\D','','g') IN (SELECT nid FROM nids)
    UNION ALL
    SELECT 'monthly_insurance_records', r.id::text, r.national_id, r.employee_code, r.employee_name,
           r.period_year, r.period_month, (SELECT account_code FROM public.company_accounts a WHERE a.id = r.account_id), r.job_title
    FROM public.monthly_insurance_records r WHERE REGEXP_REPLACE(COALESCE(r.national_id,''),'\D','','g') IN (SELECT nid FROM nids)
    UNION ALL
    SELECT 'incoming_insurance_records', r.id::text, r.national_id, r.employee_code, r.employee_name,
           NULL, NULL, r.company_account, COALESCE(r.insurance_status,'') || ' ' || COALESCE(r.form_type,'')
    FROM public.incoming_insurance_records r WHERE REGEXP_REPLACE(COALESCE(r.national_id,''),'\D','','g') IN (SELECT nid FROM nids)
    UNION ALL
    SELECT 'resignation_records', r.id::text, r.national_id, r.employee_code, r.employee_name,
           NULL, NULL, NULL, COALESCE(r.resignation_type,'') || ' ' || COALESCE(r.resignation_date::text,'')
    FROM public.resignation_records r WHERE REGEXP_REPLACE(COALESCE(r.national_id,''),'\D','','g') IN (SELECT nid FROM nids)
    UNION ALL
    SELECT 'sheet_data', s.id::text, s.row_national_id, s.row_code, s.row_name, NULL, NULL, NULL, s.sheet_id::text
    FROM public.sheet_data s WHERE REGEXP_REPLACE(COALESCE(s.row_national_id,''),'\D','','g') IN (SELECT nid FROM nids)
    UNION ALL
    SELECT 'employee_history', h.id::text, NULL, h.to_employee_code, NULL, NULL, NULL, NULL, h.change_type
    FROM public.employee_history h JOIN public.employees_master e ON e.id = h.employee_id JOIN p ON p.id = e.person_id
$$;

-- Register one person whose account is not known. Never touches someone who already exists:
-- an existing national ID is refused (use confirm_account_transfer to change an account).
CREATE OR REPLACE FUNCTION public.register_unknown_account_person(
    p_national_id TEXT, p_name TEXT, p_employee_code TEXT DEFAULT NULL,
    p_source TEXT DEFAULT NULL, p_confirmed_by TEXT DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    v_nid TEXT := NULLIF(REGEXP_REPLACE(COALESCE(p_national_id,''),'[^0-9]','','g'),'');
    v_exist public.employees_master%ROWTYPE;
    v_new public.employees_master%ROWTYPE;
    v_counts jsonb;
BEGIN
    IF p_confirmed_by IS NULL OR BTRIM(p_confirmed_by) = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'confirmed_by_required');
    END IF;
    IF v_nid IS NULL OR LENGTH(v_nid) <> 14 THEN
        RETURN jsonb_build_object('success', false, 'error', 'national_id_must_be_14_digits');
    END IF;
    IF p_name IS NULL OR BTRIM(p_name) = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'name_required');
    END IF;
    SELECT * INTO v_exist FROM public.employees_master WHERE national_id = v_nid LIMIT 1;
    IF FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'already_exists',
            'person_uid', v_exist.person_uid, 'operating_no', v_exist.operating_no, 'company_account', v_exist.company_account);
    END IF;
    PERFORM set_config('app.confirmed_by', p_confirmed_by, true);
    INSERT INTO public.employees_master(company_account, employee_name, national_id, employee_code, current_status)
    VALUES ('UNK', BTRIM(p_name), v_nid, NULLIF(BTRIM(COALESCE(p_employee_code,'')),''), 'Unknown account')
    RETURNING * INTO v_new;
    SELECT COALESCE(jsonb_object_agg(source, n), '{}'::jsonb) INTO v_counts
    FROM (SELECT source, COUNT(*) n FROM public.person_source_records(v_new.person_uid) GROUP BY source) c;
    RETURN jsonb_build_object('success', true, 'employee_id', v_new.id, 'person_uid', v_new.person_uid,
        'operating_no', v_new.operating_no, 'account', 'UNK', 'source', p_source, 'records_found', v_counts);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.person_source_records(TEXT),
    public.register_unknown_account_person(TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.person_source_records(TEXT),
    public.register_unknown_account_person(TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;
