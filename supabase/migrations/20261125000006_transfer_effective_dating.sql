-- Migration: 20261125000006_transfer_effective_dating.sql
-- Explicit reviewed account transfers vs stamp corrections, with effective dating.
--
-- Model (user-confirmed 2026-11-25): ONE current company per person (no
-- simultaneous employment). employees_master.company_account is a CURRENT
-- SNAPSHOT that moves to a DIFFERENT account ONLY through
-- confirm_account_transfer below — never by an upload (the cross-account
-- import guard already fails closed; import/patch/sync routes were audited
-- 2026-11-25 and none of their update payloads touch company_account).
-- Two distinct recorded events share this table:
--   * account_transfer  — a real-world move; effective_date = the actual
--                         transfer day supplied at confirmation.
--   * stamp_correction  — fixing an earlier WRONG company stamp (not a
--                         real-world event; never rendered as a "transfer").
-- Per-company facts (sheet_data, monthly rows, source rows) are never
-- touched: the old company's rows stay as that company's true history.
--
-- Company TEXT is canonical: the stored snapshot and history always use the
-- account's canonical dotted alias (E.G / M.G — the dominant forms in
-- production data and in import writes), never raw client/operator text;
-- list/report/profile filters match exact text, so variants are load-bearing.
--
-- Effective dates must be TODAY OR EARLIER. Future-dated ("scheduled")
-- confirmations are REJECTED: there is no scheduler in the app, and a stored
-- snapshot that silently matures on read would leave lists/reports stale and
-- hide writes inside GET requests. A move is recorded when it is real.
--
-- ROLLBACK CAVEAT (honest): before any transfer/correction event exists,
-- rollback = DROP these functions + DROP the two columns, fully data-intact.
-- AFTER events are recorded, dropping effective_date/confirmed_by DESTROYS
-- their date and provenance values — that rollback is NOT data-intact and
-- must be presented as data-losing.
--
-- PRIVILEGES: EXECUTE is revoked from PUBLIC and granted to the app's roles
-- (anon/authenticated/service_role), matching the existing table policies.
-- All functions are SECURITY INVOKER (no definer escalation). NOTE (residual,
-- pre-existing posture): the app connects with the public anon key, so
-- RPC/table exposure through that key is unchanged by this migration; the
-- login check lives in the app route layer, as with the rest of the app.

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
-- canonical_company_text: maps ANY accepted account spelling (code or alias,
-- any language/case) to the ONE canonical stored form — the account's first
-- dotted alias (E.G / M.G), falling back to the account code. Exact-text
-- list/report filters depend on this canonical form.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.canonical_company_text(p_input TEXT)
RETURNS TEXT AS $$
DECLARE
    v_code TEXT;
    v_aliases TEXT[];
    v_dotted TEXT;
BEGIN
    IF p_input IS NULL OR BTRIM(p_input) = '' THEN
        RETURN NULL;
    END IF;
    SELECT account_code, aliases INTO v_code, v_aliases
    FROM public.company_accounts
    WHERE account_code = UPPER(TRIM(p_input))
       OR TRIM(p_input) = ANY(aliases)
       OR LOWER(TRIM(p_input)) = ANY(aliases)
    LIMIT 1;
    IF v_code IS NULL THEN
        RETURN NULL;
    END IF;
    SELECT u.a INTO v_dotted
    FROM unnest(v_aliases) WITH ORDINALITY AS u(a, ord)
    WHERE POSITION('.' IN u.a) > 0
    ORDER BY u.ord
    LIMIT 1;
    RETURN COALESCE(v_dotted, v_code);
END;
$$ LANGUAGE plpgsql STABLE;

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
--                             event (pre-transfer known snapshot — NOT an
--                             employment-history claim)
--   * no events at all      = NULL (caller leaves the master as-is)
-- Scope honesty: this resolves only the CURRENT snapshot. It makes no claim
-- about periods before the earliest recorded state or across evidence gaps;
-- any future period derivation must mark those unknown. stamp_correction
-- events move the SNAPSHOT here (that is what they are for) but are never
-- presented as real-world transfers.
-- ─────────────────────────────────────────────────────────────────────────────
-- resolve_current_company: read-side resolution from recorded events.
-- HONEST SEMANTICS — initial state: when no event is applicable at p_as_of
-- the function returns the EARLIEST recorded event's from-company. That is a
-- display-continuity inference ("the snapshot before the first recorded
-- event"), NOT proof the employee belonged to that company for all earlier
-- time — history before the first recorded event is simply unrecorded.
-- A stamp_correction applies from its own effective_date forward; it never
-- rewrites resolution for earlier dates, so recording a correction cannot
-- fabricate past employment at the corrected company.
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
-- apply_due_company_transfers: OPS-ONLY reconciliation helper (NOT wired to
-- any read path — reads must not write). Applies events whose effective_date
-- has ARRIVED: with no due event the stored snapshot stays untouched (the
-- pre-state fallback is the resolver's read-side answer, not a state change).
-- Recomputes the stored snapshot from the due events and applies it, with the
-- same UID-collision fail-closed guard as confirm. Useful for repairing rows
-- inserted outside the function; with future-dated events rejected at
-- confirmation it is normally a no-op.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.apply_due_company_transfers(p_employee_id UUID)
RETURNS jsonb AS $$
DECLARE
    v_emp public.employees_master%ROWTYPE;
    v_current TEXT;
    v_candidate_uid TEXT;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.employee_history
        WHERE employee_id = p_employee_id AND effective_date <= CURRENT_DATE
    ) THEN
        RETURN jsonb_build_object('changed', false, 'reason', 'no_due_events');
    END IF;

    v_current := public.canonical_company_text(public.resolve_current_company(p_employee_id, CURRENT_DATE));
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
-- confirm_account_transfer: the ONLY app path that moves the current snapshot
-- to a different account. ONE transaction (any failure aborts everything: no
-- half-written master+history pairs). Guards, in order:
--   1. change_type must be account_transfer | stamp_correction
--   2. account_transfer requires an explicit effective_date (the real move
--      day); stamp_correction defaults to today when omitted
--   3. future effective dates REJECTED (no scheduler; no stale lists;
--      no writes hidden in reads)
--   4. confirmed_by required — every snapshot move carries provenance
--   5. master row locked FOR UPDATE (serialization point)
--   6. expected_current_company, when supplied, must match the stored
--      snapshot (optimistic concurrency: the reviewer confirms what they saw)
--   7. self-transfer rejected — by CANONICAL account, so a text-variant
--      spelling of the same account is a no-op, not a fake "move"
--   8. target company must resolve to a known account (blocks the UID
--      trigger's silent EG fallback on a typo)
--   9. UID collision pre-check (explicit rejection, not a raw 23505)
-- Then: history row written with CANONICAL company text (durable trail with
-- evidence link + provenance), and the snapshot recomputed from the FULL
-- trail — a backdated/out-of-order event never clobbers a later applicable
-- one; it is recorded for the trail without rewriting the present.
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
    v_canonical TEXT;
    v_current_canonical TEXT;
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
    IF p_effective_date > CURRENT_DATE THEN
        RETURN jsonb_build_object('success', false, 'error', 'future_effective_date');
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

    SELECT account_code INTO v_target_code
    FROM public.company_accounts
    WHERE account_code = UPPER(TRIM(p_to_company_account))
       OR TRIM(p_to_company_account) = ANY(aliases)
       OR LOWER(TRIM(p_to_company_account)) = ANY(aliases)
    LIMIT 1;
    IF v_target_code IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'unknown_company_account');
    END IF;
    v_canonical := public.canonical_company_text(p_to_company_account);
    v_current_canonical := public.canonical_company_text(v_emp.company_account);

    IF v_current_canonical IS NOT NULL AND v_current_canonical = v_canonical THEN
        RETURN jsonb_build_object('success', false, 'error', 'self_transfer');
    END IF;

    v_candidate_uid := public.compute_account_employee_uid(v_canonical, v_emp.employee_code, v_emp.national_id, v_emp.id);
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
        v_emp.company_account, v_canonical,
        v_emp.employee_code, v_emp.employee_code,
        ARRAY['company_account'],
        jsonb_build_object(
            'company_account', v_emp.company_account,
            'account_id', v_emp.account_id,
            'account_employee_uid', v_emp.account_employee_uid
        ),
        jsonb_build_object('company_account', v_canonical),
        p_import_id, p_change_reason, p_notes,
        p_confirmed_by, p_effective_date
    )
    RETURNING id INTO v_history_id;

    v_current := public.canonical_company_text(public.resolve_current_company(v_emp.id, CURRENT_DATE));
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
        'to_company_account', v_canonical,
        'effective_date', p_effective_date,
        'applied_now', v_applied,
        'scheduled', false,
        'current_company', COALESCE(v_current, v_emp.company_account)
    );
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION public.canonical_company_text(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.compute_account_employee_uid(TEXT, TEXT, TEXT, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.resolve_current_company(UUID, DATE) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.apply_due_company_transfers(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.confirm_account_transfer(UUID, TEXT, DATE, TEXT, TEXT, TEXT, TEXT, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.canonical_company_text(TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.compute_account_employee_uid(TEXT, TEXT, TEXT, UUID) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_current_company(UUID, DATE) TO anon, authenticated, service_role;
-- Mutating functions: trusted server execution identity ONLY. Neither the
-- public anon key nor an authenticated end-user role may invoke them
-- directly — the only caller is the session-validated Next.js route holding
-- the server-only SUPABASE_SERVICE_ROLE_KEY. (The read functions above stay
-- callable: they are pure/STABLE and move no state.)
REVOKE EXECUTE ON FUNCTION public.apply_due_company_transfers(UUID) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.confirm_account_transfer(UUID, TEXT, DATE, TEXT, TEXT, TEXT, TEXT, TEXT, UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_due_company_transfers(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.confirm_account_transfer(UUID, TEXT, DATE, TEXT, TEXT, TEXT, TEXT, TEXT, UUID) TO service_role;
