import { NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { autoMapColumns, SOURCE_COLUMNS, SourceType } from '@/lib/excelParser';
import { supabaseServer } from '@/lib/supabaseServer';

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const sourceType = formData.get('source_type') as SourceType | null;
    const requestedSheet = formData.get('sheet_name') as string | null;
    const yearStr = formData.get('period_year') as string | null;
    const monthStr = formData.get('period_month') as string | null;

    if (!file || !sourceType) {
      return NextResponse.json({ error: 'الملف ونوع المصدر مطلوبان' }, { status: 400 });
    }

    if (!SOURCE_COLUMNS[sourceType]) {
      return NextResponse.json({ error: 'نوع المصدر غير معروف' }, { status: 400 });
    }

    // Check file size (max 20MB)
    if (file.size > 20 * 1024 * 1024) {
      return NextResponse.json({ error: 'حجم الملف يتجاوز الحد الأقصى المسموح (20 ميجابايت)' }, { status: 400 });
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

    const targetSheetName = requestedSheet && sheetNames.includes(requestedSheet)
      ? requestedSheet
      : sheetNames[0];

    const worksheet = workbook.Sheets[targetSheetName];
    if (!worksheet) {
      return NextResponse.json({ error: `الصفحة "${targetSheetName}" غير موجودة في الملف` }, { status: 400 });
    }

    // Convert sheet to json array of objects (using raw string representation)
    const rawData = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
      header: 1,
      defval: '',
      blankrows: false,
    });

    if (rawData.length === 0) {
      return NextResponse.json({ error: 'الصفحة المحددة فارغة لا تحتوي على بيانات' }, { status: 400 });
    }

    // Find the header row (first non-empty row)
    let headerRowIndex = 0;
    while (headerRowIndex < rawData.length && (!rawData[headerRowIndex] || (rawData[headerRowIndex] as unknown[]).length === 0)) {
      headerRowIndex++;
    }

    const headers = (rawData[headerRowIndex] as unknown[]).map((h) => String(h || '').trim()).filter(Boolean);
    if (headers.length === 0) {
      return NextResponse.json({ error: 'لم يتم العثور على عناوين أعمدة صالحة في الملف' }, { status: 400 });
    }

    const dataRows = rawData.slice(headerRowIndex + 1);
    const totalRows = dataRows.length;

    // Build preview rows (up to 10 rows)
    const previewRows = dataRows.slice(0, 10).map((row) => {
      const rowObj: Record<string, string> = {};
      headers.forEach((h, idx) => {
        const val = row[idx];
        rowObj[h] = val !== null && val !== undefined ? String(val).trim() : '';
      });
      return rowObj;
    });

    // Auto map columns
    const mapping = autoMapColumns(headers, sourceType);

    // Check if previous import exists
    let existingImport = null;
    const periodYear = yearStr ? parseInt(yearStr, 10) : null;
    const periodMonth = monthStr ? parseInt(monthStr, 10) : null;

    if (sourceType === 'monthly_payroll' || sourceType === 'monthly_insurance') {
      if (periodYear && periodMonth) {
        const { data: existing } = await supabaseServer
          .from('import_logs')
          .select('id, file_name, created_at, rows_accepted')
          .eq('source_type', sourceType)
          .eq('period_year', periodYear)
          .eq('period_month', periodMonth)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (existing) {
          existingImport = existing;
        }
      }
    } else {
      // Non-monthly files
      const { data: existing } = await supabaseServer
        .from('import_logs')
        .select('id, file_name, created_at, rows_accepted')
        .eq('source_type', sourceType)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existing) {
        existingImport = existing;
      }
    }

    return NextResponse.json({
      success: true,
      sheets: sheetNames,
      selectedSheet: targetSheetName,
      headers,
      previewRows,
      totalRows,
      mapping,
      expectedColumns: SOURCE_COLUMNS[sourceType],
      existingImport,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'حدث خطأ أثناء معاينة الملف';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
