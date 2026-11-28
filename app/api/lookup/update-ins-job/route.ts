import { NextRequest, NextResponse } from 'next/server';
import { supabaseService } from '@/lib/supabaseServer';

/**
 * POST /api/lookup/update-ins-job
 * Hassan's manual edit of the employee's INSURANCE profession (مهنة التأمينات),
 * saved directly on employees_master.insurance_job_title. Payroll profession,
 * sheets and the search log are never touched. The insurance profession is
 * fixed: uploads never change an existing value, only this manual edit does
 * (Hassan, 2026-11-28 20:06). Goes through edit_employee_profile (history old/new).
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const nid = String(body?.national_id || '').replace(/\D/g, '');
    const title = String(body?.insurance_job_title || '').trim();

    if (nid.length !== 14) {
      return NextResponse.json({ error: 'الرقم القومي لازم يكون 14 رقم' }, { status: 400 });
    }
    if (!title) {
      return NextResponse.json({ error: 'اكتب مهنة التأمينات الأول' }, { status: 400 });
    }
    if (title.length > 120) {
      return NextResponse.json({ error: 'اسم المهنة طويل جداً' }, { status: 400 });
    }

    const { data: found, error: findErr } = await supabaseService
      .from('employees_master')
      .select('id')
      .eq('national_id', nid)
      .limit(1);
    if (findErr) throw new Error(findErr.message);
    if (!found || found.length === 0) {
      return NextResponse.json({ error: 'الموظف مش موجود في الماستر' }, { status: 404 });
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabaseService as any).rpc('edit_employee_profile', {
      p_employee_id: found[0].id,
      p_fields: { insurance_job_title: title },
      p_by: 'شاشة البحث (مهنة التأمينات)',
      p_reason: 'تعديل يدوي',
    });
    if (error) throw new Error(error.message);
    if (!data || data.success !== true) {
      return NextResponse.json({ error: data?.error || 'فشل الحفظ' }, { status: 400 });
    }

    return NextResponse.json({ success: true, national_id: nid, insurance_job_title: title });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('POST /api/lookup/update-ins-job error:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
