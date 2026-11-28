import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServiceClient } from '@/lib/supabaseServer';
import { getSessionRole } from '@/lib/auth';

/**
 * PATCH /api/employee/[id]/master
 * The one safe way to edit anything in the profile + master: name, national ID, code, insurance profession and the rest.
 * (The system number never changes; the account changes only through /transfer.)
 * All checks, uniqueness and history happen inside edit_master_core, in one transaction.
 */
const MESSAGES: Record<string, string> = {
  confirmed_by_required: 'اكتب اسم من يعدّل',
  employee_not_found: 'الموظف غير موجود',
  name_required: 'الاسم لا يمكن أن يكون فارغا',
  national_id_required: 'الرقم القومي مطلوب',
  national_id_must_be_14_digits: 'الرقم القومي لازم يكون 14 رقم',
  national_id_taken: 'الرقم القومي ده مسجل لموظف آخر',
  code_taken: 'الكود ده مسجل لموظف آخر في نفس الحساب',
  invalid_value: 'قيمة غير صالحة في أحد الحقول',
  duplicate_blocked: 'التعديل يسبب تكرار ورُفض',
};

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { confirmed_by, reason } = body || {};
    const FIELDS = ['employee_name', 'national_id', 'employee_code', 'current_status', 'current_job_title', 'current_region',
      'current_department', 'insurance_number', 'insurance_status', 'insurance_salary', 'insurance_job_title',
      'insurance_start_date', 'hire_date', 'resignation_date', 'last_working_day', 'phone_number', 'address'];
    const fields: Record<string, unknown> = {};
    for (const f of FIELDS) if (body && f in body && body[f] !== undefined) fields[f] = body[f];
    if (!confirmed_by || !String(confirmed_by).trim()) {
      return NextResponse.json({ success: false, error: 'confirmed_by_required', message: MESSAGES.confirmed_by_required }, { status: 400 });
    }
    const role = await getSessionRole();
    const by = role ? `${String(confirmed_by).trim()} (shared ${role} session)` : String(confirmed_by).trim();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (getSupabaseServiceClient() as any).rpc('edit_employee_profile', {
      p_employee_id: id,
      p_fields: fields,
      p_by: by,
      p_reason: reason || null,
    });
    if (error) throw new Error(error.message);
    const result = data as unknown as Record<string, unknown> | null;
    if (!result || result.success !== true) {
      const code = (result?.error as string) || 'unknown';
      const holder = result?.holder_name ? ` (${result.holder_name}${result.holder_number ? ` - ${result.holder_number}` : ''})` : '';
      return NextResponse.json({ ...result, success: false, error: code, message: (MESSAGES[code] ?? code) + holder },
        { status: code === 'employee_not_found' ? 404 : code.endsWith('_taken') ? 409 : 400 });
    }
    return NextResponse.json(result);
  } catch (err: unknown) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 });
  }
}
