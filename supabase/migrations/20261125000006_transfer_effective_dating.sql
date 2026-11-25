-- Migration: 20261125000006_transfer_effective_dating.sql
-- Explicit reviewed account transfers vs stamp corrections, with effective dating.
--
-- Model (user-confirmed 2026-11-25): ONE current company per person (no
-- simultaneous employment). employees_master.company_account is a CURRENT
-- SNAPSHOT that changes ONLY by an explicit confirmed action through
-- confirm_account_transfer below — never by an upload (the cross-account
-- import guard already fails closed). Two distinct recorded events share this
-- table:
--   * account_transfer  — a real-world move; effective_date = the actual
--                         transfer day supplied at confirmation.
--   * stamp_correction  — fixing an earlier WRONG company stamp (not a
--                         real-world event; never rendered as a "transfer").
-- Per-company facts (sheet_data, monthly rows, source rows) are never
-- touched: the old company's rows stay as that company's true history.
--
-- ROLLBACK CAVEAT (honest): before any transfer/correction event exists,
-- rollback = DROP these functions + DROP the two columns, fully data-intact.
-- AFTER events are recorded, dropping effective_date/confirmed_by DESTROYS
-- their date and provenance values — that rollback is NOT data-intact and
-- must be presented as data-losing.

ALTER TABLE public.employee_history
    ADD COLUMN IF NOT EXISTS effective_date DATE,
    ADD COLUMN IF NOT EXISTS confirmed_by TEXT;

COMMENT ON COLUMN public.employee_history.effective_date IS
    'يوم سريان الحدث الفعلي (يوم النقل الحقيقي أو يوم سريان التصحيح) — مستقل عن created_at وقت التسجيل';
COMMENT ON COLUMN public.employee_history.confirmed_by IS
    'من أكّد القرار (هوية المُراجع) — إثبات مصدر كل تغيير للشركة الحالية';

CREATE INDEX IF NOT EXISTS idx_employee_history_effective
    ON public.employee_history(employee_id, effective_date DESC)
    WHERE change_type IN ('account_transfer', 'stamp_correction');

-- ─────────────────────────────────────────────────────────────────────────────
-- compute_account_employee_uid: mirrors the resolve_employee_account_uid
-- trigger logic so a transfer can PRE-CHECK the UID it would generate in the
-- target account and reject a collision explicitly, instead of dying on the
-- unique index mid-transaction.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.compute_account_employee_uid(
    p_company_account TEXT,
    p_employee_code TEXT,
    p_national_id TEXT,
    p_id UUID
) RETURNS TEXT AS $$
DECLARE
    v_account_code TEXT;
    v_clean_code TEXT;
    v_clean_nat_id TEXT;
BEGIN
    SELECT account_code INTO v_account_code
    FROM public.company_accounts
    WHERE account_code = UPPER(TRIM(p_company_account))
       OR TRIM(p_company_account) = ANY(aliases)
       OR LOWER(TRIM(p_company_account)) = ANY(aliases)
    LIMIT 1;
    IF v_account_code IS NULL THEN
        SELECT account_code INTO v_account_code
        FROM public.company_accounts WHERE account_code = 'EG' LIMIT 1;
    END IF;

    v_clean_code := NULLIF(REGEXP_REPLACE(COALESCE(p_employee_code, ''), '[^0-9a-zA-Z]', '', 'g'), '');
    v_clean_nat_id := NULLIF(REGEXP_REPLACE(COALESCE(p_national_id, ''), '[^0-9]', '', 'g'), '');

    IF v_clean_code IS NOT NULL THEN
        RETURN v_account_code || '-' || v_clean_code;
    ELSIF v_clean_nat_id IS NOT NULL THEN
        RETURN v_account_code || '-NID' || v_clean_nat_id;
    ELSE
        RETURN v_account_code || '-ID' || SUBSTRING(COALESCE(p_id::text, gen_random_uuid()::text), 1, 8);
    END IF;
END;
$$ LANGUAGE plpgsql STABLE;

-- ─────────────────────────────────────────────────────────────────────────────
-- resolve_current_company: derives the current-company snapshot AS OF a date
-- from the recorded snapshot-moving events.
--   * applicable event      = effective_date <= p_as_of
--   * current               = to_company_account of the applicable event with
--                             the latest effective_date (tie: latest recorded)
--   * none applicable yet   = from_company_account of the EARLIEST recorded
--                             event (pre-transfer known state) — a future-
--                             dated transfer NEVER switches the snapshot early
--   * no events at all      = NULL (caller leaves the master as-is)
-- Scope honesty: this resolves only the CURRENT snapshot. It makes no claim
-- about periods before the earliest recorded state or across evidence gaps;
-- any future period derivation must mark those unknown.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.resolve_current_company(
    p_employee_id UUID,
    p_as_of DATE DEFAULT CURRENT_DATE
) RETURNS TEXT AS $$
DECLARE
    v_current TEXT;
    v_initial TEXT;
BEGIN
    SELECT to_company_account INTO v_current
    FROM public.employee_history
    WHERE employee_id = p_employee_id
      AND change_type IN ('account_transfer', 'stamp_correction')
      AND effective_date IS NOT NULL
      AND effective_date <= p_as_of
    ORDER BY effective_date DESC, created_at DESC
    LIMIT 1;

    IF v_current IS NOT NULL THEN
        RETURN v_current;
    END IF;

    SELECT from_company_account INTO v_initial
    FROM public.employee_history
    WHERE employee_id = p_employee_id
      AND change_type IN ('account_transfer', 'stamp_correction')
    ORDER BY effective_date ASC NULLS LAST, created_at ASC
    LIMIT 1;

    RETURN v_initial;
END;
$$ LANGUAGE plpgsql STABLE;

-- ─────────────────────────────────────────────────────────────────────────────
-- apply_due_company_transfers: recompute-on-read. Applies the resolver to the
-- stored snapshot. Called when an employee profile is read and after every
-- confirmation — this is how a future-dated transfer takes effect once its
-- effective date arrives, with no scheduler and no duplicate registry.
-- Surfaces reading the master WITHOUT this refresh show the stored snapshot
-- until the next refresh (reported limitation).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.apply_due_company_transfers(p_employee_id UUID)
RETURNS jsonb AS $$
DECLARE
    v_emp public.employees_master%ROWTYPE;
    v_current TEXT;
    v_candidate_uid TEXT;
BEGIN
    v_current := public.resolve_current_company(p_employee_id, CURRENT_DATE);
    IF v_current IS NULL THEN
        RETURN jsonb_build_object('changed', false, 'reason', 'no_events');
    END IF;

    SELECT * INTO v_emp FROM public.employees_master WHERE id = p_employee_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('changed', false, 'error', 'employee_not_found');
    END IF;

    IF v_emp.company_account IS NOT DISTINCT FROM v_current THEN
        RETURN jsonb_build_object('changed', false, 'current_company', v_emp.company_account);
    END IF;

    -- A colliding row may have arrived in the target account AFTER the event
    -- was confirmed. Fail closed: keep the stored snapshot, surface the block.
    v_candidate_uid := public.compute_account_employee_uid(v_current, v_emp.employee_code, v_emp.national_id, v_emp.id);
    IF EXISTS (
        SELECT 1 FROM public.employees_master
        WHERE account_employee_uid = v_candidate_uid AND id <> p_employee_id
    ) THEN
        RETURN jsonb_build_object('changed', false, 'error', 'uid_collision_at_maturity', 'candidate_uid', v_candidate_uid);
    END IF;

    UPDATE public.employees_master
    SET company_account = v_current, last_updated_at = NOW()
    WHERE id = p_employee_id;

    RETURN jsonb_build_object(
        'changed', true,
        'from', v_emp.company_account,
        'to', v_current,
        'current_company', v_current
    );
END;
$$ LANGUAGE plpgsql;

-- ─────────────────────────────────────────────────────────────────────────────
-- confirm_account_transfer: the ONLY write path that moves the current
-- snapshot. ONE transaction (any failure aborts everything: no half-written
-- master+history pairs). Guards, in order:
--   1. change_type must be account_transfer | stamp_correction
--   2. account_transfer requires an explicit effective_date (the real move
--      day); stamp_correction defaults to today when omitted
--   3. confirmed_by required — every snapshot move carries provenance
--   4. master row locked FOR UPDATE (serialization point)
--   5. expected_current_company, when supplied, must match the stored
--      snapshot (optimistic concurrency: the reviewer confirms what they saw)
--   6. self-transfer rejected
--   7. target company must resolve to a known account (blocks the UID
--      trigger's silent EG fallback on a typo)
--   8. UID collision pre-check (explicit rejection, not a raw 23505)
-- Then: history row written (durable trail with evidence link + provenance),
-- snapshot recomputed from the FULL trail — future-dated events do not switch
-- early; backdated/out-of-order events never clobber a later applicable one.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.confirm_account_transfer(
    p_employee_id UUID,
    p_to_company_account TEXT,
    p_effective_date DATE DEFAULT NULL,
    p_change_type TEXT DEFAULT 'account_transfer',
    p_change_reason TEXT DEFAULT NULL,
    p_notes TEXT DEFAULT NULL,
    p_confirmed_by TEXT DEFAULT NULL,
    p_expected_current_company TEXT DEFAULT NULL,
    p_import_id UUID DEFAULT NULL
) RETURNS jsonb AS $$
DECLARE
    v_emp public.employees_master%ROWTYPE;
    v_target_code TEXT;
    v_candidate_uid TEXT;
    v_current TEXT;
    v_history_id UUID;
    v_applied BOOLEAN := false;
BEGIN
    IF p_change_type NOT IN ('account_transfer', 'stamp_correction') THEN
        RETURN jsonb_build_object('success', false, 'error', 'invalid_change_type');
    END IF;
    IF p_change_type = 'account_transfer' AND p_effective_date IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'effective_date_required');
    END IF;
    IF p_effective_date IS NULL THEN
        p_effective_date := CURRENT_DATE;
    END IF;
    IF p_to_company_account IS NULL OR BTRIM(p_to_company_account) = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'to_company_required');
    END IF;
    IF p_confirmed_by IS NULL OR BTRIM(p_confirmed_by) = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'confirmed_by_required');
    END IF;

    SELECT * INTO v_emp FROM public.employees_master WHERE id = p_employee_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'employee_not_found');
    END IF;

    IF p_expected_current_company IS NOT NULL
       AND v_emp.company_account IS DISTINCT FROM p_expected_current_company THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'concurrent_update',
            'actual_current_company', v_emp.company_account
        );
    END IF;

    IF v_emp.company_account = p_to_company_account THEN
        RETURN jsonb_build_object('success', false, 'error', 'self_transfer');
    END IF;

    SELECT account_code INTO v_target_code
    FROM public.company_accounts
    WHERE account_code = UPPER(TRIM(p_to_company_account))
       OR TRIM(p_to_company_account) = ANY(aliases)
       OR LOWER(TRIM(p_to_company_account)) = ANY(aliases)
    LIMIT 1;
    IF v_target_code IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'unknown_company_account');
    END IF;

    v_candidate_uid := public.compute_account_employee_uid(p_to_company_account, v_emp.employee_code, v_emp.national_id, v_emp.id);
    IF EXISTS (
        SELECT 1 FROM public.employees_master
        WHERE account_employee_uid = v_candidate_uid AND id <> p_employee_id
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'uid_collision', 'candidate_uid', v_candidate_uid);
    END IF;

    INSERT INTO public.employee_history (
        employee_id, change_type,
        from_company_account, to_company_account,
        from_employee_code, to_employee_code,
        changed_fields, old_values, new_values,
        import_id, change_reason, notes,
        confirmed_by, effective_date
    ) VALUES (
        v_emp.id, p_change_type,
        v_emp.company_account, p_to_company_account,
        v_emp.employee_code, v_emp.employee_code,
        ARRAY['company_account'],
        jsonb_build_object(
            'company_account', v_emp.company_account,
            'account_id', v_emp.account_id,
            'account_employee_uid', v_emp.account_employee_uid
        ),
        jsonb_build_object('company_account', p_to_company_account),
        p_import_id, p_change_reason, p_notes,
        p_confirmed_by, p_effective_date
    )
    RETURNING id INTO v_history_id;

    v_current := public.resolve_current_company(v_emp.id, CURRENT_DATE);
    IF v_current IS NOT NULL AND v_current IS DISTINCT FROM v_emp.company_account THEN
        UPDATE public.employees_master
        SET company_account = v_current, last_updated_at = NOW()
        WHERE id = v_emp.id;
        v_applied := true;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'employee_id', v_emp.id,
        'history_id', v_history_id,
        'change_type', p_change_type,
        'from_company_account', v_emp.company_account,
        'to_company_account', p_to_company_account,
        'effective_date', p_effective_date,
        'applied_now', v_applied,
        'scheduled', p_effective_date > CURRENT_DATE,
        'current_company', COALESCE(v_current, v_emp.company_account)
    );
END;
$$ LANGUAGE plpgsql;
