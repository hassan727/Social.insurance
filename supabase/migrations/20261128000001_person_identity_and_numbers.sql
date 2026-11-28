-- Migration: 20261128000001_person_identity_and_numbers.sql
-- Permanent person identity + per-account sequential operating numbers.
--
-- WHY: until now the only "unique number" was account_employee_uid, which is
-- DERIVED from account code + employee code (EG-49560). A code change changed
-- the identity; a corrected national ID looked like a new person; nothing was
-- sequential or protected from re-use.
--
-- MODEL
--   persons                  one row per real person, permanent person_uid
--                            (P-0000001 ...), sequential, never re-used.
--   person_account_numbers   one operating number per (person, account)
--                            (EG-000123, MG-000045, GASCO-000007, DMC-000002),
--                            sequential per account, never re-used. A person who
--                            leaves and returns, or comes back to an account after
--                            a move, gets the SAME number in that account.
--   person_identifiers       national ID / employee code history per person with
--                            valid_from / valid_to. A corrected NID or changed
--                            code is added here; the person and numbers stay.
--   number_counters          gapless counters (row-locked upsert, rolled back with
--                            the transaction: no skipped numbers, no random ids).
--   employees_master         gets person_id, person_uid, operating_no (maintained
--                            by trigger on every insert/update path).
--
-- Nothing is deleted or rewritten: account_employee_uid is kept as is.
-- ROLLBACK: supabase/reversals/20261128000001_person_identity_and_numbers.reversal.sql

-- ── Counters ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.number_counters (
    scope    TEXT PRIMARY KEY,
    last_seq BIGINT NOT NULL DEFAULT 0
);

CREATE OR REPLACE FUNCTION public.next_number(p_scope TEXT) RETURNS BIGINT AS $$
DECLARE v BIGINT;
BEGIN
    INSERT INTO public.number_counters(scope, last_seq) VALUES (p_scope, 1)
    ON CONFLICT (scope) DO UPDATE SET last_seq = public.number_counters.last_seq + 1
    RETURNING last_seq INTO v;
    RETURN v;
END;
$$ LANGUAGE plpgsql;

-- ── Persons ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.persons (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    person_uid TEXT NOT NULL UNIQUE
               DEFAULT ('P-' || LPAD(public.next_number('PERSON')::text, 7, '0')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.person_account_numbers (
    person_id    UUID    NOT NULL REFERENCES public.persons(id),
    account_id   INTEGER NOT NULL REFERENCES public.company_accounts(id),
    seq          BIGINT  NOT NULL,
    operating_no TEXT    NOT NULL UNIQUE,
    assigned_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (person_id, account_id),
    UNIQUE (account_id, seq)
);

CREATE TABLE IF NOT EXISTS public.person_identifiers (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    person_id   UUID NOT NULL REFERENCES public.persons(id),
    kind        TEXT NOT NULL CHECK (kind IN ('national_id', 'employee_code')),
    value       TEXT NOT NULL,
    account_id  INTEGER REFERENCES public.company_accounts(id),  -- codes are per account
    is_current  BOOLEAN NOT NULL DEFAULT TRUE,
    valid_from  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    valid_to    TIMESTAMPTZ,
    reason      TEXT,
    recorded_by TEXT
);
-- One person per national ID, system-wide; one person per code inside an account.
CREATE UNIQUE INDEX IF NOT EXISTS idx_person_ident_current_nid
    ON public.person_identifiers(value) WHERE kind = 'national_id' AND is_current;
CREATE UNIQUE INDEX IF NOT EXISTS idx_person_ident_current_code
    ON public.person_identifiers(account_id, value) WHERE kind = 'employee_code' AND is_current;
CREATE INDEX IF NOT EXISTS idx_person_ident_person ON public.person_identifiers(person_id, kind);
CREATE INDEX IF NOT EXISTS idx_person_ident_value ON public.person_identifiers(kind, value);

ALTER TABLE public.employees_master
    ADD COLUMN IF NOT EXISTS person_id    UUID REFERENCES public.persons(id),
    ADD COLUMN IF NOT EXISTS person_uid   TEXT,
    ADD COLUMN IF NOT EXISTS operating_no TEXT;
CREATE INDEX IF NOT EXISTS idx_employees_master_person ON public.employees_master(person_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_master_person_uid_account
    ON public.employees_master(person_uid, account_id) WHERE person_uid IS NOT NULL AND account_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_employees_master_operating_no ON public.employees_master(operating_no);

-- ── Identity trigger (runs AFTER resolve_employee_account_uid, by name) ──
CREATE OR REPLACE FUNCTION public.assign_employee_identity() RETURNS TRIGGER AS $$
DECLARE
    v_nid        TEXT;
    v_code       TEXT;
    v_person     UUID;
    v_holder     UUID;
    v_seq        BIGINT;
    v_acc_code   TEXT;
    v_op         TEXT;
    v_by         TEXT := NULLIF(current_setting('app.confirmed_by', true), '');
    v_old_nid    TEXT;
    v_old_code   TEXT;
BEGIN
    v_nid  := NULLIF(REGEXP_REPLACE(COALESCE(NEW.national_id, ''), '[^0-9]', '', 'g'), '');
    IF v_nid IS NOT NULL AND LENGTH(v_nid) <> 14 THEN v_nid := NULL; END IF;
    v_code := NULLIF(REGEXP_REPLACE(COALESCE(NEW.employee_code, ''), '[^0-9a-zA-Z]', '', 'g'), '');

    IF TG_OP = 'UPDATE' THEN
        IF NEW.person_id IS DISTINCT FROM OLD.person_id AND OLD.person_id IS NOT NULL THEN
            RAISE EXCEPTION 'person_id is permanent and cannot be changed (employee %)', OLD.id;
        END IF;
        v_person := COALESCE(OLD.person_id, NEW.person_id);
    ELSE
        v_person := NEW.person_id;
    END IF;

    -- 1) Resolve the person: existing current NID first; otherwise a new person.
    IF v_person IS NULL AND v_nid IS NOT NULL THEN
        SELECT person_id INTO v_person FROM public.person_identifiers
        WHERE kind = 'national_id' AND value = v_nid AND is_current;
    END IF;
    IF v_person IS NULL THEN
        INSERT INTO public.persons DEFAULT VALUES RETURNING id INTO v_person;
    END IF;
    NEW.person_id := v_person;

    -- 2) National ID identifier (history on change, never a new person).
    IF v_nid IS NOT NULL THEN
        SELECT person_id INTO v_holder FROM public.person_identifiers
        WHERE kind = 'national_id' AND value = v_nid AND is_current;
        IF v_holder IS NOT NULL AND v_holder <> v_person THEN
            RAISE EXCEPTION 'identity_conflict: national id % already belongs to another person', v_nid
                USING ERRCODE = '23505';
        END IF;
        IF v_holder IS NULL THEN
            SELECT value INTO v_old_nid FROM public.person_identifiers
            WHERE person_id = v_person AND kind = 'national_id' AND is_current;
            UPDATE public.person_identifiers SET is_current = FALSE, valid_to = NOW()
            WHERE person_id = v_person AND kind = 'national_id' AND is_current;
            INSERT INTO public.person_identifiers(person_id, kind, value, reason, recorded_by)
            VALUES (v_person, 'national_id', v_nid,
                    CASE WHEN v_old_nid IS NULL THEN 'initial' ELSE 'correction' END, v_by);
        END IF;
    END IF;

    -- 3) Employee code identifier (per account).
    IF v_code IS NOT NULL AND NEW.account_id IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM public.person_identifiers
                       WHERE person_id = v_person AND kind = 'employee_code'
                         AND account_id = NEW.account_id AND value = v_code AND is_current) THEN
            SELECT value INTO v_old_code FROM public.person_identifiers
            WHERE person_id = v_person AND kind = 'employee_code' AND account_id = NEW.account_id AND is_current;
            UPDATE public.person_identifiers SET is_current = FALSE, valid_to = NOW()
            WHERE person_id = v_person AND kind = 'employee_code' AND account_id = NEW.account_id AND is_current;
            INSERT INTO public.person_identifiers(person_id, kind, value, account_id, reason, recorded_by)
            VALUES (v_person, 'employee_code', v_code, NEW.account_id,
                    CASE WHEN v_old_code IS NULL THEN 'initial' ELSE 'code_change' END, v_by);
        END IF;
    END IF;

    -- 4) Operating number for this account: reuse if the person had one here.
    IF NEW.account_id IS NOT NULL THEN
        SELECT operating_no INTO v_op FROM public.person_account_numbers
        WHERE person_id = v_person AND account_id = NEW.account_id;
        IF v_op IS NULL THEN
            SELECT account_code INTO v_acc_code FROM public.company_accounts WHERE id = NEW.account_id;
            v_seq := public.next_number('ACC:' || NEW.account_id);
            v_op := v_acc_code || '-' || LPAD(v_seq::text, 6, '0');
            INSERT INTO public.person_account_numbers(person_id, account_id, seq, operating_no)
            VALUES (v_person, NEW.account_id, v_seq, v_op);
        END IF;
        NEW.operating_no := v_op;
    ELSE
        NEW.operating_no := NULL;
    END IF;
    SELECT person_uid INTO NEW.person_uid FROM public.persons WHERE id = v_person;

    -- 5) Audit trail on the existing history table (updates only: the row
    --    must exist for the foreign key).
    IF TG_OP = 'UPDATE' AND (v_old_nid IS NOT NULL OR v_old_code IS NOT NULL) THEN
        INSERT INTO public.employee_history(employee_id, change_type, from_employee_code, to_employee_code,
            changed_fields, old_values, new_values, change_reason, confirmed_by, effective_date)
        VALUES (OLD.id, 'identity_change', OLD.employee_code, NEW.employee_code,
            ARRAY_REMOVE(ARRAY[CASE WHEN v_old_nid IS NOT NULL THEN 'national_id' END,
                               CASE WHEN v_old_code IS NOT NULL THEN 'employee_code' END], NULL),
            jsonb_build_object('national_id', OLD.national_id, 'employee_code', OLD.employee_code,
                               'person_uid', OLD.person_uid, 'operating_no', OLD.operating_no),
            jsonb_build_object('national_id', NEW.national_id, 'employee_code', NEW.employee_code,
                               'person_uid', NEW.person_uid, 'operating_no', NEW.operating_no),
            NULLIF(current_setting('app.change_reason', true), ''), v_by, CURRENT_DATE);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS zz_employees_master_identity ON public.employees_master;
CREATE TRIGGER zz_employees_master_identity
    BEFORE INSERT OR UPDATE OF national_id, employee_code, company_account, account_id, person_id
    ON public.employees_master
    FOR EACH ROW EXECUTE FUNCTION public.assign_employee_identity();

-- ── Accounts: GASCO and DMC (names to be confirmed by the owner) ─────────
INSERT INTO public.company_accounts(account_code, account_name, aliases, description)
VALUES ('GASCO', 'GASCO', ARRAY['GASCO','gasco','Gasco'], 'account added 2026-11-28; display name to be confirmed'),
       ('DMC',   'DMC',   ARRAY['DMC','dmc','Dmc'],       'account added 2026-11-28; display name to be confirmed')
ON CONFLICT (account_code) DO NOTHING;

-- ── Backfill existing employees, deterministic order (account, code, NID) ──
-- The last_updated_at trigger is paused so dates stay untouched.
ALTER TABLE public.employees_master DISABLE TRIGGER trigger_employees_master_updated;
DO $$
DECLARE r RECORD;
BEGIN
    FOR r IN
        SELECT id FROM public.employees_master WHERE person_id IS NULL
        ORDER BY account_id NULLS LAST,
                 NULLIF(REGEXP_REPLACE(COALESCE(employee_code, ''), '\D', '', 'g'), '')::bigint NULLS LAST,
                 national_id, id
    LOOP
        UPDATE public.employees_master SET national_id = national_id WHERE id = r.id;
    END LOOP;
END $$;
ALTER TABLE public.employees_master ENABLE TRIGGER trigger_employees_master_updated;

-- ── Approved identity correction (explicit, with provenance) ───────────────
CREATE OR REPLACE FUNCTION public.confirm_identity_correction(
    p_employee_id UUID,
    p_new_national_id TEXT DEFAULT NULL,
    p_new_employee_code TEXT DEFAULT NULL,
    p_reason TEXT DEFAULT NULL,
    p_confirmed_by TEXT DEFAULT NULL
) RETURNS jsonb AS $$
DECLARE
    v_emp public.employees_master%ROWTYPE;
    v_nid TEXT := NULLIF(REGEXP_REPLACE(COALESCE(p_new_national_id, ''), '[^0-9]', '', 'g'), '');
    v_holder_uid TEXT;
    v_after public.employees_master%ROWTYPE;
BEGIN
    IF p_confirmed_by IS NULL OR BTRIM(p_confirmed_by) = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'confirmed_by_required');
    END IF;
    IF v_nid IS NULL AND NULLIF(BTRIM(COALESCE(p_new_employee_code, '')), '') IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'nothing_to_change');
    END IF;
    IF v_nid IS NOT NULL AND LENGTH(v_nid) <> 14 THEN
        RETURN jsonb_build_object('success', false, 'error', 'national_id_must_be_14_digits');
    END IF;
    SELECT * INTO v_emp FROM public.employees_master WHERE id = p_employee_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'employee_not_found');
    END IF;
    IF v_nid IS NOT NULL THEN
        SELECT p.person_uid INTO v_holder_uid
        FROM public.person_identifiers i JOIN public.persons p ON p.id = i.person_id
        WHERE i.kind = 'national_id' AND i.value = v_nid AND i.is_current AND i.person_id <> v_emp.person_id;
        IF v_holder_uid IS NOT NULL THEN
            RETURN jsonb_build_object('success', false, 'error', 'national_id_belongs_to_other_person',
                                      'other_person_uid', v_holder_uid);
        END IF;
    END IF;
    PERFORM set_config('app.confirmed_by', p_confirmed_by, true);
    PERFORM set_config('app.change_reason', COALESCE(p_reason, 'identity correction'), true);
    UPDATE public.employees_master
    SET national_id = COALESCE(v_nid, national_id),
        employee_code = COALESCE(NULLIF(BTRIM(p_new_employee_code), ''), employee_code)
    WHERE id = p_employee_id
    RETURNING * INTO v_after;
    RETURN jsonb_build_object('success', true, 'employee_id', p_employee_id,
        'person_uid', v_after.person_uid, 'operating_no', v_after.operating_no,
        'national_id', v_after.national_id, 'employee_code', v_after.employee_code);
END;
$$ LANGUAGE plpgsql;

-- ── Privileges: same posture as the rest (service role only) ─────────────
ALTER TABLE public.number_counters         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.persons                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.person_account_numbers  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.person_identifiers      ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.number_counters, public.persons, public.person_account_numbers, public.person_identifiers FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.number_counters, public.persons,
    public.person_account_numbers, public.person_identifiers TO service_role;
CREATE POLICY "service role only" ON public.number_counters FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service role only" ON public.persons FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service role only" ON public.person_account_numbers FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service role only" ON public.person_identifiers FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE EXECUTE ON FUNCTION public.next_number(TEXT), public.assign_employee_identity(),
    public.confirm_identity_correction(UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.next_number(TEXT), public.assign_employee_identity(),
    public.confirm_identity_correction(UUID, TEXT, TEXT, TEXT, TEXT) TO service_role;
