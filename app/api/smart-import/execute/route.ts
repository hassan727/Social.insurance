import { NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { importMultiSheetExcel } from '@/lib/smartImportService';
import { supabaseServer } from '@/lib/supabaseServer';

export const maxDuration = 300; // 5 minutes for large imports

// Resolve an operator-selected account against company_accounts (id, code,
// or alias). Returns null when unknown — callers reject, never default.
async function resolveAccountId(raw: string): Promise<number | null> {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const { data, error } = await supabaseServer
    .from('company_accounts')
    .select('id, account_code, aliases')
    .eq('is_active', true);
  if (error || !data) return null;
  const asNum = Number(trimmed);
  const lowered = trimmed.toLowerCase();
  const match = data.find((a) =>
    (Number.isInteger(asNum) && a.id === asNum) ||
    a.account_code.toLowerCase() === lowered ||
    (Array.isArray(a.aliases) && a.aliases.some((al: string) => al.trim().toLowerCase() === lowered))
  );
  return match ? match.id : null;
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const rawAccount = (formData.get('company_account') as string | null) || '';
    const selectedSheetsStr = formData.get('selected_sheets') as string | null;

    if (!file) {
      return NextResponse.json({ error: 'الملف مطلوب' }, { status: 400 });
    }

    // Explicit validated account context is mandatory — no Egypt Gas default,
    // no name-prefix guessing. The resolved id is threaded through the import
    // so every monthly bridge row is stamped with it.
    if (!rawAccount.trim()) {
      return NextResponse.json({ error: 'يجب اختيار الحساب (الشركة) صراحةً قبل الاستيراد — لا يوجد حساب افتراضي' }, { status: 400 });
    }
    const accountId = await resolveAccountId(rawAccount);
    if (accountId === null) {
      return NextResponse.json({ error: 'الحساب المحدد غير معروف. أضفه أولاً في الحسابات أو راجع الإدخال — لا يوجد افتراض تلقائي.' }, { status: 400 });
    }
    const { data: accountRow } = await supabaseServer
      .from('company_accounts')
      .select('account_code, aliases')
      .eq('id', accountId)
      .single();
    // Canonical stored form for company_account text: the dotted alias used
    // across existing rows (e.g. E.G / M.G), falling back to the code.
    const companyAccount =
      (accountRow?.aliases || []).find((a: string) => /^[A-Za-z]\.[A-Za-z]/.test(a.trim())) ||
      accountRow?.account_code ||
      rawAccount.trim();

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
      file.name,
      accountId
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
