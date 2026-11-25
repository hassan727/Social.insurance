import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';
import { isAuthenticated, getSessionRole } from '@/lib/auth';

/**
 * POST /api/employee/[id]/transfer
 * The ONLY write path that moves an employee's current-company snapshot.
 * Records an explicit reviewed decision:
 *   change_type 'account_transfer'  — a real-world move (effective_date required)
 *   change_type 'stamp_correction'  — fixing an earlier wrong company stamp
 * All validation, locking and the atomic master+history write happen inside
 * the confirm_account_transfer SQL function (one transaction).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    if (!(await isAuthenticated())) {
      return NextResponse.json({ error: 'يجب تسجيل الدخول لتأكيد نقل أو تصحيح إسناد' }, { status: 401 });
    }

    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: 'Employee ID is required' }, { status: 400 });
    }

    const body = await request.json();
    const {
      to_company_account,
      effective_date,
      change_type,
      change_reason,
      notes,
      confirmed_by,
      expected_current_company,
      import_id,
    } = body || {};

    if (!to_company_account) {
      return NextResponse.json({ error: 'to_company_account is required' }, { status: 400 });
    }
    if (!confirmed_by || !String(confirmed_by).trim()) {
      return NextResponse.json({ error: 'confirmed_by is required — كل قرار نقل/تصحيح لازم يسجّل من أكّده' }, { status: 400 });
    }
    const type = change_type || 'account_transfer';
    if (!['account_transfer', 'stamp_correction'].includes(type)) {
      return NextResponse.json({ error: 'change_type must be account_transfer or stamp_correction' }, { status: 400 });
    }
    if (type === 'account_transfer' && !effective_date) {
      return NextResponse.json({ error: 'effective_date is required for an actual transfer — يوم النقل الحقيقي' }, { status: 400 });
    }
    if (effective_date && !/^\d{4}-\d{2}-\d{2}$/.test(String(effective_date))) {
      return NextResponse.json({ error: 'effective_date must be YYYY-MM-DD' }, { status: 400 });
    }
    if (effective_date && String(effective_date) > new Date().toISOString().slice(0, 10)) {
      return NextResponse.json({ error: 'future_effective_date', message: 'النقل يُسجَّل بتاريخه الفعلي بعد حدوثه — لا تُقبل تواريخ مستقبلية' }, { status: 400 });
    }

    // Authorization = the verified session. The typed reviewer name is only a
    // display label; the record carries what the session actually proves.
    const sessionRole = await getSessionRole();
    const recordedBy = sessionRole ? `${String(confirmed_by).trim()} (${sessionRole})` : String(confirmed_by).trim();

    const { data, error } = await supabaseServer.rpc('confirm_account_transfer', {
      p_employee_id: id,
      p_to_company_account: String(to_company_account),
      p_effective_date: effective_date || null,
      p_change_type: type,
      p_change_reason: change_reason || null,
      p_notes: notes || null,
      p_confirmed_by: recordedBy,
      p_expected_current_company: expected_current_company ?? null,
      p_import_id: import_id || null,
    });
    if (error) throw new Error(error.message);

    const result = data as unknown as Record<string, unknown> | null;
    if (!result || result.success !== true) {
      const code = (result?.error as string) || 'unknown';
      const status =
        code === 'employee_not_found' ? 404 :
        code === 'concurrent_update' ? 409 :
        code === 'uid_collision' ? 409 :
        400;
      const messages: Record<string, string> = {
        future_effective_date: 'النقل يُسجَّل بتاريخه الفعلي بعد حدوثه — لا تُقبل تواريخ مستقبلية',
        self_transfer: 'الموظف مسجّل بالفعل في هذه الشركة',
        concurrent_update: 'الشركة الحالية تغيّرت منذ العرض — حدّث الصفحة وأعد المحاولة',
        uid_collision: 'تعارض معرّف في الشركة المستهدفة — يحتاج مراجعة يدوية',
      };
      return NextResponse.json({
        success: false,
        error: code,
        message: messages[code] ?? null,
        actual_current_company: result?.actual_current_company ?? null,
        candidate_uid: result?.candidate_uid ?? null,
      }, { status });
    }

    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
