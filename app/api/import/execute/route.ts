import { NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { SourceType } from '@/lib/excelParser';
import { supabaseServer } from '@/lib/supabaseServer';

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const sourceType = formData.get('source_type') as SourceType | null;
    const sheetName = formData.get('sheet_name') as string | null;
    const mappingJson = formData.get('column_mapping') as string | null;
    const yearStr = formData.get('period_year') as string | null;
    const monthStr = formData.get('period_month') as string | null;
    const confirmOverwrite = formData.get('confirm_overwrite') === 'true';

    if (!file || !sourceType || !mappingJson) {
      return NextResponse.json({ error: 'البيانات المرسلة غير مكتملة' }, { status: 400 });
    }

    let columnMapping: Record<string, string> = {};
    try {
      columnMapping = JSON.parse(mappingJson);
    } catch {
      return NextResponse.json({ error: 'صيغة خريطة الأعمدة غير صالحة' }, { status: 400 });
    }

    const periodYear = yearStr ? parseInt(yearStr, 10) : null;
    const periodMonth = monthStr ? parseInt(monthStr, 10) : null;

    if ((sourceType === 'monthly_payroll' || sourceType === 'monthly_insurance') && (!periodYear || !periodMonth)) {
      return NextResponse.json({ error: 'يجب تحديد السنة والشهر لملفات المرتبات والتأمينات الشهرية' }, { status: 400 });
    }

    // Check for previous import
    let hasExisting = false;
    if (sourceType === 'monthly_payroll' || sourceType === 'monthly_insurance') {
      const { count } = await supabaseServer
        .from('import_logs')
        .select('*', { count: 'exact', head: true })
        .eq('source_type', sourceType)
        .eq('period_year', periodYear!)
        .eq('period_month', periodMonth!);
      hasExisting = (count || 0) > 0;
    } else {
      const { count } = await supabaseServer
        .from('import_logs')
        .select('*', { count: 'exact', head: true })
        .eq('source_type', sourceType);
      hasExisting = (count || 0) > 0;
    }

    if (hasExisting && !confirmOverwrite) {
      let existingQuery = supabaseServer
        .from('import_logs')
        .select('id, file_name, created_at, rows_accepted')
        .eq('source_type', sourceType);

      if (sourceType === 'monthly_payroll' || sourceType === 'monthly_insurance') {
        existingQuery = existingQuery
          .eq('period_year', periodYear!)
          .eq('period_month', periodMonth!);
      }

      const { data: existingLog } = await existingQuery
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      return NextResponse.json({
        error: 'توجد بيانات مستوردة مسبقاً لهذه الفترة/المصدر. يتطلب استبدالها تأكيدك الصريح لمنع تكرار السجلات.',
        requiresConfirmation: true,
        existingImport: existingLog || null,
      }, { status: 409 });
    }

    // Read Excel
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true, cellText: true, raw: false });

    const targetSheetName = sheetName && workbook.SheetNames.includes(sheetName)
      ? sheetName
      : workbook.SheetNames[0];

    const worksheet = workbook.Sheets[targetSheetName];
    if (!worksheet) {
      return NextResponse.json({ error: 'الصفحة المحددة غير موجودة' }, { status: 400 });
    }

    const rawData = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
      header: 1,
      defval: '',
      blankrows: false,
    });

    if (rawData.length === 0) {
      return NextResponse.json({ error: 'الملف لا يحتوي على بيانات' }, { status: 400 });
    }

    let headerRowIndex = 0;
    while (headerRowIndex < rawData.length && (!rawData[headerRowIndex] || (rawData[headerRowIndex] as unknown[]).length === 0)) {
      headerRowIndex++;
    }

    const headers = (rawData[headerRowIndex] as unknown[]).map((h) => String(h || '').trim());
    const headerIndexMap: Record<string, number> = {};
    headers.forEach((h, idx) => {
      headerIndexMap[h] = idx;
    });

    const dataRows = rawData.slice(headerRowIndex + 1);
    const totalRowsRead = dataRows.length;

    // Handle overwrite cleanup if confirmed
    if (confirmOverwrite && hasExisting) {
      if (sourceType === 'monthly_payroll') {
        await supabaseServer
          .from('monthly_payroll_records')
          .delete()
          .eq('period_year', periodYear!)
          .eq('period_month', periodMonth!);
        await supabaseServer
          .from('import_logs')
          .delete()
          .eq('source_type', sourceType)
          .eq('period_year', periodYear!)
          .eq('period_month', periodMonth!);
      } else if (sourceType === 'monthly_insurance') {
        await supabaseServer
          .from('monthly_insurance_records')
          .delete()
          .eq('period_year', periodYear!)
          .eq('period_month', periodMonth!);
        await supabaseServer
          .from('import_logs')
          .delete()
          .eq('source_type', sourceType)
          .eq('period_year', periodYear!)
          .eq('period_month', periodMonth!);
      } else if (sourceType === 'incoming_insurance') {
        await supabaseServer
          .from('incoming_insurance_records')
          .delete()
          .neq('id', '00000000-0000-0000-0000-000000000000');
        await supabaseServer
          .from('import_logs')
          .delete()
          .eq('source_type', sourceType);
      } else if (sourceType === 'res') {
        await supabaseServer
          .from('resignation_records')
          .delete()
          .neq('id', '00000000-0000-0000-0000-000000000000');
        await supabaseServer
          .from('import_logs')
          .delete()
          .eq('source_type', sourceType);
      }
    }

    // Create import log record first
    const { data: logEntry, error: logError } = await supabaseServer
      .from('import_logs')
      .insert({
        source_type: sourceType,
        file_name: file.name,
        sheet_name: targetSheetName,
        period_year: periodYear,
        period_month: periodMonth,
        total_rows_read: totalRowsRead,
        column_mapping: columnMapping,
      })
      .select('id')
      .single();

    if (logError || !logEntry) {
      return NextResponse.json({ error: 'فشل إنشاء سجل عملية الاستيراد: ' + (logError?.message || '') }, { status: 500 });
    }

    const importId = logEntry.id;
    let rowsAccepted = 0;
    let rowsRejected = 0;
    const rejectedReasons: string[] = [];

    // Helper to get mapped value
    const getVal = (row: unknown[], key: string): string => {
      const colHeader = columnMapping[key];
      if (!colHeader) return '';
      const idx = headerIndexMap[colHeader];
      if (idx === undefined || idx < 0 || idx >= row.length) return '';
      const val = row[idx];
      return val !== null && val !== undefined ? String(val).trim() : '';
    };

    // Prepare records
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const recordsToInsert: any[] = [];

    for (let r = 0; r < dataRows.length; r++) {
      const row = dataRows[r];
      if (!row || row.length === 0 || row.every((c) => c === '' || c === null || c === undefined)) {
        continue; // skip blank row silently
      }

      const rawRowObj: Record<string, string> = {};
      headers.forEach((h, idx) => {
        rawRowObj[h] = row[idx] !== null && row[idx] !== undefined ? String(row[idx]).trim() : '';
      });

      const empCode = getVal(row, 'employee_code');
      const empName = getVal(row, 'employee_name');
      const natId = getVal(row, 'national_id');

      // Rule: Do not invent missing IDs, but row must have at least one valid identifier (code, national_id, or name)
      if (!empCode && !empName && !natId) {
        rowsRejected++;
        if (rejectedReasons.length < 5) {
          rejectedReasons.push(`الصف ${r + 2}: لا يحتوي على أي معرّف (كود أو رقم قومي أو اسم).`);
        }
        continue;
      }

      if (sourceType === 'incoming_insurance') {
        recordsToInsert.push({
          import_id: importId,
          employee_code: empCode || null,
          employee_name: empName || null,
          national_id: natId || null,
          job_title: getVal(row, 'job_title') || null,
          status: getVal(row, 'status') || null,
          company_account: getVal(row, 'company_account') || null,
          insurance_number: getVal(row, 'insurance_number') || null,
          insurance_status: getVal(row, 'insurance_status') || null,
          termination_reason: getVal(row, 'termination_reason') || null,
          form_type: getVal(row, 'form_type') || null,
          insurance_job_title: getVal(row, 'insurance_job_title') || null,
          subscription_start_date: getVal(row, 'subscription_start_date') || null,
          subscription_end_date: getVal(row, 'subscription_end_date') || null,
          supply_method: getVal(row, 'supply_method') || null,
          crm_number: getVal(row, 'crm_number') || null,
          record_date: getVal(row, 'record_date') || null,
          note: getVal(row, 'note') || null,
          raw_data: rawRowObj,
        });
      } else if (sourceType === 'res') {
        recordsToInsert.push({
          import_id: importId,
          employee_code: empCode || null,
          employee_name: empName || null,
          national_id: natId || null,
          resignation_date: getVal(row, 'resignation_date') || null,
          last_working_day: getVal(row, 'last_working_day') || null,
          resignation_type: getVal(row, 'resignation_type') || null,
          insurance_supply_type: getVal(row, 'insurance_supply_type') || null,
          supply_date: getVal(row, 'supply_date') || null,
          raw_data: rawRowObj,
        });
      } else if (sourceType === 'monthly_payroll') {
        recordsToInsert.push({
          import_id: importId,
          period_year: periodYear!,
          period_month: periodMonth!,
          employee_code: empCode || null,
          national_id: natId || null,
          employee_name: empName || null,
          attendance_days: getVal(row, 'attendance_days') || null,
          job_title: getVal(row, 'job_title') || null,
          region: getVal(row, 'region') || null,
          department: getVal(row, 'department') || null,
          sap_code: getVal(row, 'sap_code') || null,
          review_status: getVal(row, 'review_status') || null,
          note: getVal(row, 'note') || null,
          raw_data: rawRowObj,
        });
      } else if (sourceType === 'monthly_insurance') {
        recordsToInsert.push({
          import_id: importId,
          period_year: periodYear!,
          period_month: periodMonth!,
          employee_code: empCode || null,
          employee_name: empName || null,
          national_id: natId || null,
          insurance_number: getVal(row, 'insurance_number') || null,
          job_title: getVal(row, 'job_title') || null,
          region: getVal(row, 'region') || null,
          department: getVal(row, 'department') || null,
          sap_code: getVal(row, 'sap_code') || null,
          raw_data: rawRowObj,
        });
      }

      rowsAccepted++;
    }

    // Insert in batches of 400
    const BATCH_SIZE = 400;
    const targetTable =
      sourceType === 'incoming_insurance'
        ? 'incoming_insurance_records'
        : sourceType === 'res'
        ? 'resignation_records'
        : sourceType === 'monthly_payroll'
        ? 'monthly_payroll_records'
        : 'monthly_insurance_records';

    for (let i = 0; i < recordsToInsert.length; i += BATCH_SIZE) {
      const chunk = recordsToInsert.slice(i, i + BATCH_SIZE);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: insertErr } = await (supabaseServer.from(targetTable as any) as any).insert(chunk);
      if (insertErr) {
        throw new Error(`خطأ أثناء إدخال الدفعة (${i + 1} إلى ${i + chunk.length}): ${insertErr.message}`);
      }
    }

    // Update import_logs with final metrics
    await supabaseServer
      .from('import_logs')
      .update({
        rows_accepted: rowsAccepted,
        rows_rejected: rowsRejected,
        notes: rejectedReasons.length > 0 ? rejectedReasons.join(' | ') : 'تم الاستيراد بنجاح دون أخطاء',
      })
      .eq('id', importId);

    return NextResponse.json({
      success: true,
      importId,
      totalRowsRead,
      rowsAccepted,
      rowsRejected,
      rejectedReasons,
      message: `تم استيراد ${rowsAccepted} سجل بنجاح. ${rowsRejected > 0 ? `(تم رفض ${rowsRejected} سجل غير صالح)` : ''}`,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'حدث خطأ غير متوقع أثناء استيراد البيانات';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
