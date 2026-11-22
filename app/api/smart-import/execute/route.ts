import { NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { importMultiSheetExcel } from '@/lib/smartImportService';

export const maxDuration = 300; // 5 minutes for large imports

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const rawAccount = (formData.get('company_account') as string | null) || 'E.G';
    const selectedSheetsStr = formData.get('selected_sheets') as string | null;

    if (!file) {
      return NextResponse.json({ error: 'الملف مطلوب' }, { status: 400 });
    }

    // Dynamic account normalization: default to E.G (Egypt Gas), normalize m.g/M.G
    const normalizedAccount = (rawAccount.trim().toLowerCase().startsWith('m') || rawAccount.includes('مودرن'))
      ? 'M.G'
      : 'E.G';
    const companyAccount = normalizedAccount;

    if (!selectedSheetsStr) {
      return NextResponse.json({ error: 'يجب اختيار ورقة واحدة على الأقل' }, { status: 400 });
    }

    const selectedSheets = JSON.parse(selectedSheetsStr) as string[];
    if (!Array.isArray(selectedSheets) || selectedSheets.length === 0) {
      return NextResponse.json({ error: 'يجب اختيار ورقة واحدة على الأقل' }, { status: 400 });
    }

    // Read Excel file
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    let workbook: XLSX.WorkBook;
    try {
      workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true, cellText: true, raw: false });
    } catch {
      return NextResponse.json({ error: 'تعذر قراءة ملف Excel' }, { status: 400 });
    }

    // Verify all selected sheets exist
    for (const sheetName of selectedSheets) {
      if (!workbook.Sheets[sheetName]) {
        return NextResponse.json(
          { error: `الورقة "${sheetName}" غير موجودة في الملف` },
          { status: 400 }
        );
      }
    }

    // Execute import
    const results = await importMultiSheetExcel(
      companyAccount,
      workbook,
      selectedSheets,
      file.name
    );

    // Calculate summary
    const summary = {
      total_sheets_imported: selectedSheets.length,
      total_new_employees: 0,
      total_updated_employees: 0,
      total_skipped_rows: 0,
      total_errors: 0,
      sheets_success: 0,
      sheets_failed: 0,
    };

    for (const result of Object.values(results)) {
      summary.total_new_employees += result.new_employees;
      summary.total_updated_employees += result.updated_employees;
      summary.total_skipped_rows += result.skipped_rows;
      summary.total_errors += result.errors.length;
      if (result.success) {
        summary.sheets_success++;
      } else {
        summary.sheets_failed++;
      }
    }

    return NextResponse.json({
      success: summary.sheets_failed === 0,
      message:
        summary.sheets_failed === 0
          ? `تم استيراد ${summary.total_sheets_imported} ورقة بنجاح: ${summary.total_new_employees} موظف جديد، ${summary.total_updated_employees} موظف محدث`
          : `تم استيراد ${summary.sheets_success} ورقة بنجاح، ${summary.sheets_failed} ورقة فشلت`,
      summary,
      detailed_results: results,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'حدث خطأ أثناء الاستيراد';
    console.error('Smart import error:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
