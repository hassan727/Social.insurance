import { NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import {
  generateReportData,
  generateBlankTemplate,
  CompanyAccount,
  ReportType,
  QuarterSelection,
  CalculationMethod,
} from '@/lib/reportsEngine';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action') || 'data'; // 'data' | 'template'
    const account = (searchParams.get('account') || 'E.G') as CompanyAccount;
    const reportType = (searchParams.get('reportType') || 'hr_letter') as ReportType;
    const quarter = (searchParams.get('quarter') || 'Q3') as QuarterSelection;
    const method = (searchParams.get('method') || 'actual') as CalculationMethod;
    const month = searchParams.get('month') ? Number(searchParams.get('month')) : 9;

    if (action === 'template') {
      const buffer = generateBlankTemplate(reportType, account);
      const filename = `Template_${reportType}_${account}.xlsx`;

      return new NextResponse(buffer, {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
        },
      });
    }

    // Export populated data
    const result = await generateReportData(account, reportType, quarter, method, month);

    const wb = XLSX.utils.book_new();

    // Map rows using column labels as headers
    const exportData = result.rows.map((row) => {
      const mapped: Record<string, unknown> = {};
      result.columns.forEach((col) => {
        mapped[col.label] = row[col.key] !== undefined && row[col.key] !== null ? row[col.key] : '';
      });
      return mapped;
    });

    // 1. Append Grand Summary Row at the very end of Sheet 1 (صف الإجمالي المجمع للشهر)
    const summaryRowMapped: Record<string, unknown> = {};
    result.columns.forEach((col) => {
      summaryRowMapped[col.label] = result.summaryRow[col.key] !== undefined ? result.summaryRow[col.key] : '';
    });
    exportData.push(summaryRowMapped);

    const ws = XLSX.utils.json_to_sheet(exportData);
    ws['!cols'] = result.columns.map((c) => ({ wch: c.width || 18 }));

    // 2. Append Previous Month Comparison Table directly at the bottom of Sheet 1
    if (result.monthComparison) {
      const comp = result.monthComparison;
      const compRows: (string | number)[][] = [
        [], // blank spacer
        ['📊 تقرير مقارنة الفاتورة التأمينية بالشهر السابق ورصد الفروقات والتغيرات الميدانية والمالية'],
        [
          'بيان المقارنة',
          `الشهر السابق (${comp.previousMonthName})`,
          `الشهر الحالي (${comp.currentMonthName})`,
          'الفارق / التغير (+ / -)',
          'الملاحظات ودلالة التغير الفني والمالي',
        ],
        [
          'عدد العاملين المسجلين بالتأمينات',
          comp.hasPreviousData ? comp.previousEmployees : 'غير متوفر',
          comp.currentEmployees,
          comp.hasPreviousData ? (comp.diffEmployees >= 0 ? `+${comp.diffEmployees}` : `${comp.diffEmployees}`) : '—',
          comp.hasPreviousData
            ? (comp.diffEmployees >= 0 ? `زيادة صافية في العمالة (+${comp.diffEmployees} موظف)` : `انخفاض صافي في العمالة (${comp.diffEmployees} موظف)`)
            : 'لا توجد بيانات سابقة للمقارنة',
        ],
        [
          'إجمالي الأجر التأميني (ج.م)',
          comp.hasPreviousData ? comp.previousInsWage : '—',
          comp.currentInsWage,
          comp.hasPreviousData ? (comp.diffInsWage >= 0 ? `+${comp.diffInsWage.toFixed(2)}` : comp.diffInsWage.toFixed(2)) : '—',
          comp.hasPreviousData
            ? (comp.diffInsWage >= 0 ? `زيادة في كتلة الأجور (+${comp.diffInsWage.toFixed(2)})` : `انخفاض في كتلة الأجور (${comp.diffInsWage.toFixed(2)})`)
            : '—',
        ],
        [
          'حصة صاحب العمل (18.75%)',
          comp.hasPreviousData ? comp.previousEmployer1875 : '—',
          comp.currentEmployer1875,
          comp.hasPreviousData ? (comp.diffEmployer1875 >= 0 ? `+${comp.diffEmployer1875.toFixed(2)}` : comp.diffEmployer1875.toFixed(2)) : '—',
          comp.hasPreviousData
            ? (comp.diffEmployer1875 >= 0 ? `زيادة في التزام الشركة (+${comp.diffEmployer1875.toFixed(2)})` : `انخفاض في التزام الشركة (${comp.diffEmployer1875.toFixed(2)})`)
            : '—',
        ],
        [
          'حصة العامل المستقطعة (11%)',
          comp.hasPreviousData ? comp.previousWorker11 : '—',
          comp.currentWorker11,
          comp.hasPreviousData ? (comp.diffWorker11 >= 0 ? `+${comp.diffWorker11.toFixed(2)}` : comp.diffWorker11.toFixed(2)) : '—',
          comp.hasPreviousData
            ? (comp.diffWorker11 >= 0 ? `زيادة في استقطاعات العاملين (+${comp.diffWorker11.toFixed(2)})` : `انخفاض في استقطاعات العاملين (${comp.diffWorker11.toFixed(2)})`)
            : '—',
        ],
        [
          'إجمالي المطالبة التأمينية (29.75%)',
          comp.hasPreviousData ? comp.previousTotal2975 : '—',
          comp.currentTotal2975,
          comp.hasPreviousData ? (comp.diffTotal2975 >= 0 ? `+${comp.diffTotal2975.toFixed(2)}` : comp.diffTotal2975.toFixed(2)) : '—',
          comp.hasPreviousData
            ? (comp.diffTotal2975 >= 0 ? `إجمالي الفارق بالزيادة (+${comp.diffTotal2975.toFixed(2)})` : `إجمالي الفارق بالنقص (${comp.diffTotal2975.toFixed(2)})`)
            : '—',
        ],
        [
          'حركة المعينين الجدد (دخلوا التأمينات هذا الشهر)',
          '—',
          comp.newHiresCount,
          `+${comp.newHiresCount}`,
          'موظفون جدد مسجلون في كشف التأمينات لأول مرة أو بعد انقطاع',
        ],
        [
          'حركة الاستبعادات (خرجوا من التأمينات مقارنة بالشهر السابق)',
          '—',
          comp.terminatedCount,
          `-${comp.terminatedCount}`,
          'موظفون تواجدوا في الشهر السابق ولم يُسجلوا في هذا الشهر',
        ],
      ];

      XLSX.utils.sheet_add_aoa(ws, compRows, { origin: -1 });
    }

    const mainSheetName = result.reportTitle.slice(0, 31).replace(/[:\\/?*[\]]/g, ' ');
    XLSX.utils.book_append_sheet(wb, ws, mainSheetName);

    const fileBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const filename =
      reportType === 'insurance_invoice'
        ? `Insurance_Invoice_${account}_Month_${month}.xlsx`
        : `${reportType}_${account}_${quarter}.xlsx`;

    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error exporting report:', error);
    return NextResponse.json({ error: 'فشل تصدير التقرير: ' + message }, { status: 500 });
  }
}
