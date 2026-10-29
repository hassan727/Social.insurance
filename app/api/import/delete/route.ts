import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';

/**
 * DELETE /api/import/delete
 * Body: { source_type: 'monthly_payroll' | 'monthly_insurance', period_year: number, period_month: number }
 *
 * Deletes all records and import log entries for the specified sheet type and month.
 * This is a hard delete with no recovery — the user must confirm before calling.
 */
export async function DELETE(request: Request) {
  try {
    const body = await request.json();
    const { source_type, period_year, period_month } = body as {
      source_type: string;
      period_year: number;
      period_month: number;
    };

    if (!source_type || !period_year || !period_month) {
      return NextResponse.json(
        { error: 'يجب تحديد نوع الشيت (source_type) والسنة (period_year) والشهر (period_month)' },
        { status: 400 }
      );
    }

    if (source_type !== 'monthly_payroll' && source_type !== 'monthly_insurance') {
      return NextResponse.json(
        { error: 'نوع الشيت غير مدعوم للحذف. يُسمح فقط بـ monthly_payroll أو monthly_insurance' },
        { status: 400 }
      );
    }

    const targetTable =
      source_type === 'monthly_payroll' ? 'monthly_payroll_records' : 'monthly_insurance_records';

    // 1. Delete all records from the data table
    const { error: recordsDeleteError, count: deletedCount } = await supabaseServer
      .from(targetTable as 'monthly_payroll_records')
      .delete({ count: 'exact' })
      .eq('period_year', period_year)
      .eq('period_month', period_month);

    if (recordsDeleteError) {
      throw new Error(
        `فشل حذف سجلات ${targetTable}: ${recordsDeleteError.message}`
      );
    }

    // 2. Delete import log entries for this sheet
    const { error: logDeleteError } = await supabaseServer
      .from('import_logs')
      .delete()
      .eq('source_type', source_type)
      .eq('period_year', period_year)
      .eq('period_month', period_month);

    if (logDeleteError) {
      throw new Error(`فشل حذف سجلات سجل الاستيراد: ${logDeleteError.message}`);
    }

    const monthNames: Record<number, string> = {
      1: 'يناير', 2: 'فبراير', 3: 'مارس', 4: 'أبريل', 5: 'مايو', 6: 'يونيو',
      7: 'يوليو', 8: 'أغسطس', 9: 'سبتمبر', 10: 'أكتوبر', 11: 'نوفمبر', 12: 'ديسمبر',
    };
    const sheetLabel = source_type === 'monthly_payroll' ? 'مرتبات' : 'تأمينات';

    return NextResponse.json({
      success: true,
      deletedRecords: deletedCount ?? 0,
      message: `✅ تم حذف شيت ${sheetLabel} شهر ${monthNames[period_month] || period_month} ${period_year} بنجاح. (${deletedCount ?? 0} سجل محذوف)`,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'حدث خطأ غير متوقع أثناء الحذف';
    console.error('DELETE /api/import/delete error:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
