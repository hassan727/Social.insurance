import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';

export async function GET() {
  try {
    const { data: logs, error } = await supabaseServer
      .from('import_logs')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, logs });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'حدث خطأ أثناء جلب سجل العمليات';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'معرف العملية مطلوب' }, { status: 400 });
    }

    // 1. Fetch log entry metadata first to determine target table
    const { data: logEntry, error: fetchErr } = await supabaseServer
      .from('import_logs')
      .select('id, source_type, period_year, period_month, file_name')
      .eq('id', id)
      .maybeSingle();

    if (fetchErr || !logEntry) {
      return NextResponse.json({ error: 'سجل العملية غير موجود أو تم حذفه مسبقاً' }, { status: 404 });
    }

    const { source_type, period_year, period_month } = logEntry;

    // 2. Explicitly clean child table first to prevent cascade lock timeouts
    if (source_type === 'monthly_payroll') {
      if (period_year && period_month) {
        await supabaseServer
          .from('monthly_payroll_records')
          .delete()
          .eq('period_year', period_year)
          .eq('period_month', period_month);
      } else {
        await supabaseServer.from('monthly_payroll_records').delete().eq('import_id', id);
      }
    } else if (source_type === 'monthly_insurance') {
      if (period_year && period_month) {
        await supabaseServer
          .from('monthly_insurance_records')
          .delete()
          .eq('period_year', period_year)
          .eq('period_month', period_month);
      } else {
        await supabaseServer.from('monthly_insurance_records').delete().eq('import_id', id);
      }
    } else if (source_type === 'incoming_insurance') {
      await supabaseServer.from('incoming_insurance_records').delete().eq('import_id', id);
    } else if (source_type === 'res') {
      await supabaseServer.from('resignation_records').delete().eq('import_id', id);
    }

    // 3. Delete the log entry itself
    const { error: deleteLogErr } = await supabaseServer
      .from('import_logs')
      .delete()
      .eq('id', id);

    if (deleteLogErr) {
      return NextResponse.json({ error: deleteLogErr.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: `تم حذف ملف "${logEntry.file_name}" وجميع سجلاته بنجاح`,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'حدث خطأ أثناء حذف السجل';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
