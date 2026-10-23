import { NextResponse } from 'next/server';
import { getEmployeeFullDetails } from '@/lib/lookupService';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const nationalId = searchParams.get('national_id');
    const employeeCode = searchParams.get('employee_code');
    const employeeName = searchParams.get('employee_name');
    const yearStr = searchParams.get('selected_year');
    const monthStr = searchParams.get('selected_month');

    if (!nationalId && !employeeCode && !employeeName) {
      return NextResponse.json({ error: 'يجب تقديم معرّف واحد على الأقل للموظف' }, { status: 400 });
    }

    const selectedYear = yearStr ? parseInt(yearStr, 10) : undefined;
    const selectedMonth = monthStr ? parseInt(monthStr, 10) : undefined;

    const details = await getEmployeeFullDetails({
      national_id: nationalId,
      employee_code: employeeCode,
      employee_name: employeeName,
      selected_year: selectedYear,
      selected_month: selectedMonth,
    });

    return NextResponse.json({ success: true, details });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'حدث خطأ أثناء جلب تفاصيل الموظف';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
