import { NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { supabaseServer } from '@/lib/supabaseServer';
import { resolveAccountId } from '@/lib/accountResolver';

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const companyAccount = formData.get('company_account') as string | null;

    if (!file) {
      return NextResponse.json({ error: 'الملف مطلوب' }, { status: 400 });
    }

    // Same accounts source as execute: explicit selection, validated against
    // company_accounts — no hardcoded allowlist, no default.
    if (!companyAccount || !(await resolveAccountId(companyAccount))) {
      return NextResponse.json({ error: 'يجب اختيار حساب شركة صالح صراحةً قبل المعاينة — لا يوجد حساب افتراضي' }, { status: 400 });
    }

    // Check file size (max 50MB for multi-sheet files)
    if (file.size > 50 * 1024 * 1024) {
      return NextResponse.json({ error: 'حجم الملف يتجاوز الحد الأقصى المسموح (50 ميجابايت)' }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    let workbook: XLSX.WorkBook;
    try {
      workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true, cellText: true, raw: false });
    } catch {
      return NextResponse.json({ error: 'تعذر قراءة ملف Excel. تأكد من سلامة وصيغة الملف.' }, { status: 400 });
    }

    const sheetNames = workbook.SheetNames;
    if (!sheetNames || sheetNames.length === 0) {
      return NextResponse.json({ error: 'الملف لا يحتوي على أي صفحات عمل (Sheets)' }, { status: 400 });
    }

    // Get registered sheets from database
    const { data: registeredSheets, error: sheetsError } = await supabaseServer
      .from('dynamic_sheets')
      .select('sheet_name, display_name, description, is_active, column_definitions, matching_keys')
      .eq('is_active', true);

    if (sheetsError) {
      throw new Error(`فشل جلب تعريفات الورقات: ${sheetsError.message}`);
    }

    // Match ALL Excel sheets (registered or not)
    const allExcelSheets = sheetNames.map((excelSheet) => {
      const registered = registeredSheets?.find((rs) => rs.sheet_name === excelSheet);
      return {
        excel_name: excelSheet,
        is_registered: !!registered,
        display_name: registered?.display_name || excelSheet,
        description: registered?.description || `ورقة "${excelSheet}" - سيتم استيراد جميع الأعمدة الموجودة`,
        column_definitions: registered?.column_definitions || [],
        matching_keys: registered?.matching_keys || ['employee_code', 'national_id', 'employee_name'], // Default matching
        row_count: 0,
      };
    });

    // ALL sheets are available for import
    const availableSheets = allExcelSheets;

    // Get row counts for each sheet (optimized)
    for (const sheet of availableSheets) {
      const worksheet = workbook.Sheets[sheet.excel_name];
      if (worksheet) {
        // Fast row count using sheet range
        const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
        sheet.row_count = Math.max(0, range.e.r - 1); // -1 for header row
      }
    }

    // Get preview data for first registered sheet
    let previewSheet = null;
    if (availableSheets.length > 0) {
      const firstSheet = availableSheets[0];
      const worksheet = workbook.Sheets[firstSheet.excel_name];
      if (worksheet) {
        const rawData = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
          header: 1,
          defval: '',
          blankrows: false,
        });

        // Find header row
        let headerRowIndex = 0;
        while (
          headerRowIndex < rawData.length &&
          (!rawData[headerRowIndex] || (rawData[headerRowIndex] as unknown[]).length === 0)
        ) {
          headerRowIndex++;
        }

        const headers = (rawData[headerRowIndex] as unknown[])
          .map((h) => String(h || '').trim())
          .filter(Boolean);

        const dataRows = rawData.slice(headerRowIndex + 1, headerRowIndex + 6); // First 5 rows

        const previewRows = dataRows.map((row) => {
          const rowObj: Record<string, string> = {};
          headers.forEach((h, idx) => {
            const val = (row as unknown[])[idx];
            rowObj[h] = val !== null && val !== undefined ? String(val).trim() : '';
          });
          return rowObj;
        });

        previewSheet = {
          sheet_name: firstSheet.excel_name,
          display_name: firstSheet.display_name,
          headers,
          preview_rows: previewRows,
        };
      }
    }

    return NextResponse.json({
      success: true,
      file_name: file.name,
      company_account: companyAccount,
      total_sheets: sheetNames.length,
      registered_sheets_count: availableSheets.filter(s => s.is_registered).length,
      unregistered_sheets_count: availableSheets.filter(s => !s.is_registered).length,
      available_sheets: availableSheets,
      preview_sheet: previewSheet,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'حدث خطأ أثناء معاينة الملف';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
