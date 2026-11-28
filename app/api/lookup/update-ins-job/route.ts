import { NextRequest, NextResponse } from 'next/server';
import { supabaseService } from '@/lib/supabaseServer';

/**
 * POST /api/lookup/update-ins-job
 * Hassan's manual edit of the employee's INSURANCE profession (مهنة التأمينات),
 * saved directly on employees_master.insurance_job_title. Payroll profession,
 * sheets and the search log are never touched. A future official insurance
 * print import keeps its existing behavior and may overwrite this value
 * (Hassan's decision, 2026-11-28).
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

    const { data, error } = await supabaseService
      .from('employees_master')
      .update({ insurance_job_title: title, last_updated_at: new Date().toISOString() } as any)
      .eq('national_id', nid)
      .select('id');

    if (error) throw new Error(error.message);
    if (!data || data.length === 0) {
      return NextResponse.json({ error: 'الموظف مش موجود في الماستر' }, { status: 404 });
    }

    return NextResponse.json({ success: true, national_id: nid, insurance_job_title: title });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('POST /api/lookup/update-ins-job error:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
