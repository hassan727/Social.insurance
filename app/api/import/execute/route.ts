import { NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { SourceType } from '@/lib/excelParser';
import { supabaseServer } from '@/lib/supabaseServer';
import { invalidateReportsCache } from '@/lib/reportsEngine';
import type { Json } from '@/types/supabase';

function normalizeArabicText(text: string): string {
  if (!text) return '';
  return text
    .trim()
    .replace(/[أإآء]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[\u064B-\u065F]/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

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
      } else if (sourceType === 'incoming_insurance' || (sourceType as string) === 'official_insurance_print') {
        if ((sourceType as string) === 'official_insurance_print') {
          await supabaseServer
            .from('incoming_insurance_records')
            .delete()
            .ilike('form_type', '%برنت%');
        } else {
          await supabaseServer
            .from('incoming_insurance_records')
            .delete()
            .neq('id', '00000000-0000-0000-0000-000000000000');
        }
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

      if (sourceType === 'incoming_insurance' || (sourceType as string) === 'official_insurance_print') {
        const isOfficialPrint = (sourceType as string) === 'official_insurance_print';
        const insWage = getVal(row, 'insurance_salary') || rawRowObj['قيمة الاجر'] || rawRowObj['الاجر التأمينى'] || '';
        const insJob = getVal(row, 'insurance_job_title') || rawRowObj['المهنة'] || rawRowObj['المهنه'] || null;
        const formT = isOfficialPrint ? 'برنت تأمينات رسمي (22/09/2026)' : (getVal(row, 'form_type') || null);

        recordsToInsert.push({
          import_id: importId,
          employee_code: empCode || getVal(row, 'employee_code') || rawRowObj['رقم الاداء'] || null,
          employee_name: empName || getVal(row, 'employee_name') || rawRowObj['اسم المؤمن عليه '] || rawRowObj['اسم المؤمن عليه'] || null,
          national_id: natId || getVal(row, 'national_id') || rawRowObj['الرقم القومى 2'] || rawRowObj['الرقم القومي'] || null,
          job_title: getVal(row, 'job_title') || null,
          status: getVal(row, 'status') || rawRowObj['الحاله '] || rawRowObj['الحالة'] || null,
          company_account: getVal(row, 'company_account') || rawRowObj['الشركه '] || rawRowObj['الشركه'] || rawRowObj['الشركة'] || 'E.G',
          insurance_number: getVal(row, 'insurance_number') || rawRowObj['الرقم التأميني للمؤمن علية'] || rawRowObj['الرقم التاميني للمؤمن علية'] || null,
          insurance_status: getVal(row, 'insurance_status') || 'مؤمن عليه',
          termination_reason: getVal(row, 'termination_reason') || null,
          form_type: formT,
          insurance_job_title: insJob,
          subscription_start_date: getVal(row, 'subscription_start_date') || rawRowObj['تاريخ بداية المده'] || rawRowObj['تاريخ بداية المدة'] || null,
          subscription_end_date: getVal(row, 'subscription_end_date') || null,
          supply_method: getVal(row, 'supply_method') || (isOfficialPrint ? 'سيستم التأمينات الاجتماعية' : null),
          crm_number: getVal(row, 'crm_number') || null,
          record_date: getVal(row, 'record_date') || (isOfficialPrint ? '2026-09-22' : null),
          note: insWage ? `الأجر التأميني: ${insWage}` : (getVal(row, 'note') || null),
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
      sourceType === 'incoming_insurance' || (sourceType as string) === 'official_insurance_print'
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

    // ═══════════════════════════════════════════════════════════════════════════
    // SYNC WITH EMPLOYEES_MASTER (DYNAMIC ENTERPRISE UNIFICATION)
    // ═══════════════════════════════════════════════════════════════════════════
    try {
      const { data: existingEmps } = await supabaseServer
        .from('employees_master')
        .select('id, company_account, employee_code, national_id, employee_name, current_job_title, consolidated_data');

      interface EmpMasterLookup {
        id: string;
        company_account: string;
        employee_code: string | null;
        national_id: string | null;
        employee_name: string;
        current_job_title?: string | null;
        consolidated_data: Json;
      }

      const byCodeAccount = new Map<string, EmpMasterLookup>();
      const byCodeGlobal = new Map<string, EmpMasterLookup>();
      const byNatId = new Map<string, EmpMasterLookup>();
      const byInsNo = new Map<string, EmpMasterLookup>();
      const byNormName = new Map<string, EmpMasterLookup>();

      (existingEmps || []).forEach((emp) => {
        if (emp.employee_code) {
          const c = String(emp.employee_code).trim();
          if (!byCodeGlobal.has(c)) byCodeGlobal.set(c, emp);
          if (emp.company_account) {
            byCodeAccount.set(`${emp.company_account.trim().toLowerCase()}:${c}`, emp);
          }
        }
        if (emp.national_id && String(emp.national_id).trim().length === 14) {
          byNatId.set(String(emp.national_id).trim(), emp);
        }
        if ((emp as any).insurance_number && String((emp as any).insurance_number).trim()) {
          byInsNo.set(String((emp as any).insurance_number).trim(), emp);
        }
        if (emp.employee_name) {
          const normN = normalizeArabicText(emp.employee_name);
          if (!byNormName.has(normN)) byNormName.set(normN, emp);
          if (emp.company_account) {
            byNormName.set(`${emp.company_account.trim().toLowerCase()}:${normN}`, emp);
          }
        }
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const employeesToInsert: Array<Record<string, any>> = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const employeesToUpdate: Array<{ id: string; data: Record<string, any> }> = [];

      for (const rec of recordsToInsert) {
        const raw = (rec.raw_data as Record<string, string>) || {};
        const code = (rec.employee_code ? String(rec.employee_code).trim() : '') || raw['الكود'] || '';
        const nid = (rec.national_id ? String(rec.national_id).trim() : '') || raw['الرقم القومي'] || raw['القومي'] || '';
        const name = (rec.employee_name ? String(rec.employee_name).trim() : '') || raw['الاسم'] || '';
        const acc = (rec.company_account ? String(rec.company_account).trim() : '') || raw['الشركة'] || raw['الشركه'] || 'E.G';
        const insNum = (rec.insurance_number ? String(rec.insurance_number).trim() : '') || raw['الرقم التأميني'] || raw['الرقم التاميني'] || raw['الرقم التأميني للمؤمن علية'] || '';

        let matched: EmpMasterLookup | null = null;
        // Priority 1: National ID (14 digits)
        if (nid && nid.length === 14) {
          matched = byNatId.get(nid) || null;
        }
        // Priority 2: Insurance Number
        if (!matched && insNum && insNum.length >= 7) {
          matched = byInsNo.get(insNum) || null;
        }
        // Priority 3: Employee Code (Account specific then Global)
        if (!matched && code) {
          matched = byCodeAccount.get(`${acc.toLowerCase()}:${code}`) || byCodeGlobal.get(code) || null;
        }
        // Priority 4: Name
        if (!matched && name && name.length >= 6) {
          const normN = normalizeArabicText(name);
          matched = byNormName.get(`${acc.toLowerCase()}:${normN}`) || byNormName.get(normN) || null;
        }

        const now = new Date().toISOString();

        if (matched) {
          const oldConsolidated = (matched.consolidated_data as Record<string, unknown>) || {};
          const financialLedger = (oldConsolidated.financial_ledger as Record<string, Record<string, unknown>>) || {
            salaries_by_month: {},
            attendance_by_month: {},
            ins_wages_by_month: {},
          };

          if (sourceType === 'monthly_payroll' && periodMonth) {
            const salary = parseFloat(String(raw['الراتب'] || raw['اجمالي المستحق'] || raw['صافى التحويل'] || raw['الاجر الشامل'] || 0).replace(/[^0-9.-]/g, '')) || 0;
            const att = parseFloat(String(rec.attendance_days || raw['عدد ايام الحضور'] || 0).replace(/[^0-9.-]/g, '')) || 0;
            if (salary > 0) financialLedger.salaries_by_month[String(periodMonth)] = salary;
            if (att > 0) financialLedger.attendance_by_month[String(periodMonth)] = att;
          } else if (sourceType === 'monthly_insurance' && periodMonth) {
            const insWage = parseFloat(String(raw['الاجر التاميني'] || raw['الاجر التامينى'] || 0).replace(/[^0-9.-]/g, '')) || 0;
            if (insWage > 0) financialLedger.ins_wages_by_month[String(periodMonth)] = insWage;
          }

          const newConsolidated = {
            ...oldConsolidated,
            financial_ledger: financialLedger,
            last_source_update: sourceType,
          };

          matched.consolidated_data = newConsolidated as Json;

          if ((sourceType as string) === 'official_insurance_print') {
            const insSalaryVal = parseFloat(String(raw['قيمة الاجر'] || raw['الاجر التأمينى'] || '0').replace(/[^0-9.-]/g, '')) || null;
            const insJobVal = rec.insurance_job_title || raw['المهنة'] || null;
            const insNumVal = rec.insurance_number || raw['الرقم التأميني للمؤمن علية'] || null;
            const subDateVal = rec.subscription_start_date || raw['تاريخ بداية المده'] || null;

            // تسجيل التعارض الوظيفي مع الوظيفة الحالية الفعلية إن وجد
            if (matched.current_job_title && insJobVal) {
              const normCurrent = normalizeArabicText(matched.current_job_title);
              const normIns = normalizeArabicText(insJobVal);
              if (normCurrent !== normIns && !normCurrent.includes(normIns) && !normIns.includes(normCurrent)) {
                await supabaseServer.from('matching_conflicts').insert({
                  conflict_type: 'job_title_conflict',
                  conflict_data: {
                    employee_id: matched.id,
                    national_id: nid,
                    employee_name: name,
                    actual_job_title: matched.current_job_title,
                    insurance_job_title: insJobVal,
                    company_account: acc,
                    action_required: `تقديم طلب تعديل مهنة بالتأمينات من (${insJobVal}) إلى (${matched.current_job_title})`,
                  },
                  resolved: false,
                });
              }
            }

            employeesToUpdate.push({
              id: matched.id,
              data: {
                insurance_job_title: insJobVal || undefined,
                insurance_number: insNumVal || undefined,
                insurance_salary: insSalaryVal || undefined,
                insurance_start_date: subDateVal || undefined,
                insurance_status: 'مؤمن عليه بالبرنت',
                last_updated_at: now,
                consolidated_data: {
                  ...newConsolidated,
                  official_print_data: raw,
                  last_official_print_update: '2026-09-22',
                },
              },
            });
          } else {
            employeesToUpdate.push({
              id: matched.id,
              data: {
                consolidated_data: newConsolidated,
                last_updated_at: now,
                current_job_title: rec.job_title || undefined,
                current_department: rec.department || undefined,
                current_region: rec.region || undefined,
              },
            });
          }
        } else if (name || code || nid) {
          const newId = crypto.randomUUID();

          if ((sourceType as string) === 'official_insurance_print') {
            const insSalaryVal = parseFloat(String(raw['قيمة الاجر'] || raw['الاجر التأمينى'] || '0').replace(/[^0-9.-]/g, '')) || null;
            const insJobVal = rec.insurance_job_title || raw['المهنة'] || null;
            const insNumVal = rec.insurance_number || raw['الرقم التأميني للمؤمن علية'] || null;
            const subDateVal = rec.subscription_start_date || raw['تاريخ بداية المده'] || null;

            const newRecord = {
              id: newId,
              company_account: acc,
              employee_code: code || null,
              national_id: nid || null,
              employee_name: name || 'بدون اسم',
              current_status: 'مسجل بالتأمينات فقط',
              insurance_job_title: insJobVal,
              insurance_number: insNumVal,
              insurance_salary: insSalaryVal,
              insurance_start_date: subDateVal,
              insurance_status: 'مؤمن عليه بالبرنت',
              consolidated_data: {
                ...raw,
                official_print_data: raw,
              },
              last_import_id: importId,
            };

            employeesToInsert.push(newRecord);
            const lookupItem = newRecord as unknown as EmpMasterLookup;
            if (code) byCodeAccount.set(`${acc}:${code}`, lookupItem);
            if (nid) byNatId.set(nid, lookupItem);
            if (name) byNormName.set(`${acc}:${normalizeArabicText(name)}`, lookupItem);
            continue;
          }
          const financialLedger = {
            salaries_by_month: {} as Record<string, number>,
            attendance_by_month: {} as Record<string, number>,
            ins_wages_by_month: {} as Record<string, number>,
          };

          if (sourceType === 'monthly_payroll' && periodMonth) {
            const salary = parseFloat(String(raw['الراتب'] || raw['اجمالي المستحق'] || raw['صافى التحويل'] || raw['الاجر الشامل'] || 0).replace(/[^0-9.-]/g, '')) || 0;
            const att = parseFloat(String(rec.attendance_days || raw['عدد ايام الحضور'] || 0).replace(/[^0-9.-]/g, '')) || 0;
            if (salary > 0) financialLedger.salaries_by_month[String(periodMonth)] = salary;
            if (att > 0) financialLedger.attendance_by_month[String(periodMonth)] = att;
          } else if (sourceType === 'monthly_insurance' && periodMonth) {
            const insWage = parseFloat(String(raw['الاجر التاميني'] || raw['الاجر التامينى'] || 0).replace(/[^0-9.-]/g, '')) || 0;
            if (insWage > 0) financialLedger.ins_wages_by_month[String(periodMonth)] = insWage;
          }

          const newRecord = {
            id: newId,
            company_account: acc,
            employee_code: code || null,
            national_id: nid || null,
            employee_name: name || 'بدون اسم',
            current_status: 'Active',
            current_job_title: (rec.job_title as string) || null,
            current_department: (rec.department as string) || null,
            current_region: (rec.region as string) || null,
            consolidated_data: {
              ...raw,
              financial_ledger: financialLedger,
            },
            last_import_id: importId,
          };

          employeesToInsert.push(newRecord);
          const lookupItem = newRecord as unknown as EmpMasterLookup;
          if (code) {
            byCodeGlobal.set(code, lookupItem);
            byCodeAccount.set(`${acc.toLowerCase()}:${code}`, lookupItem);
          }
          if (nid) byNatId.set(nid, lookupItem);
          if (insNum) byInsNo.set(insNum, lookupItem);
          if (name) {
            const normN = normalizeArabicText(name);
            byNormName.set(normN, lookupItem);
            byNormName.set(`${acc.toLowerCase()}:${normN}`, lookupItem);
          }
        }
      }

      // Batch insert new employees in chunks of 150
      for (let i = 0; i < employeesToInsert.length; i += 150) {
        const chunk = employeesToInsert.slice(i, i + 150);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabaseServer.from('employees_master') as any).insert(chunk);
      }

      // Batch update existing employees in chunks of 25
      for (let i = 0; i < employeesToUpdate.length; i += 25) {
        const chunk = employeesToUpdate.slice(i, i + 25);
        await Promise.all(
          chunk.map((item) =>
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (supabaseServer.from('employees_master') as any).update(item.data).eq('id', item.id)
          )
        );
      }

      // Invalidate reports cache so all reports immediately reflect new data
      invalidateReportsCache();
    } catch (syncErr) {
      console.error('Error synchronizing import with employees_master:', syncErr);
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
