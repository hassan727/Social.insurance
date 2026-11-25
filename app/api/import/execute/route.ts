import { NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { SourceType } from '@/lib/excelParser';
import { supabaseServer } from '@/lib/supabaseServer';
import { cleanNationalId } from '@/lib/smartImportService';
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

// Resolve an operator-selected account against company_accounts (id, code, or alias).
// Returns null when unknown/ambiguous — callers must reject, never default.
async function resolveAccount(raw: string): Promise<{ id: number; code: string } | null> {
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
  return match ? { id: match.id, code: match.account_code } : null;
}

async function resolveAccountId(raw: string): Promise<number | null> {
  const resolved = await resolveAccount(raw);
  return resolved ? resolved.id : null;
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
    const accountRaw = formData.get('company_account') as string | null;
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

    // Account context is mandatory for monthly imports — explicit operator
    // selection, validated server-side. No default, no filename inference.
    let accountId: number | null = null;
    if (sourceType === 'monthly_payroll' || sourceType === 'monthly_insurance') {
      if (!accountRaw || !accountRaw.trim()) {
        return NextResponse.json({ error: 'يجب اختيار الحساب (الشركة) صراحةً قبل استيراد ملف شهري' }, { status: 400 });
      }
      accountId = await resolveAccountId(accountRaw);
      if (accountId === null) {
        return NextResponse.json({ error: 'الحساب المحدد غير معروف. أضفه أولاً في الحسابات أو راجع الإدخال — لا يوجد افتراض تلقائي.' }, { status: 400 });
      }
    } else if (accountRaw && accountRaw.trim()) {
      // Non-monthly sources (incoming insurance / official print): the
      // operator-selected account is only the DEFAULT. An explicit row Account
      // cell always wins for those rows (confirmed mixed-source model).
      accountId = await resolveAccountId(accountRaw);
      if (accountId === null) {
        return NextResponse.json({ error: 'الحساب المحدد غير معروف. أضفه أولاً في الحسابات أو راجع الإدخال — لا يوجد افتراض تلقائي.' }, { status: 400 });
      }
    }

    // Check for previous import — scoped to the SAME account + period, so one
    // company's re-import never touches another company's data.
    let hasExisting = false;
    if (sourceType === 'monthly_payroll' || sourceType === 'monthly_insurance') {
      const { count } = await supabaseServer
        .from('import_logs')
        .select('*', { count: 'exact', head: true })
        .eq('source_type', sourceType)
        .eq('period_year', periodYear!)
        .eq('period_month', periodMonth!)
        .eq('account_id', accountId!);
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
          .eq('period_month', periodMonth!)
          .eq('account_id', accountId!);
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

    // ── Destructive-overwrite guard (user NID-only rule): never replace stored
    // rows with partial invalid input. Validate BEFORE any delete runs.
    const scanCell = (row: unknown[], field: string): string => {
      const h = columnMapping[field];
      if (!h) return '';
      const idx = headerIndexMap[h];
      if (idx === undefined || idx < 0 || idx >= row.length) return '';
      const v = row[idx];
      return v !== null && v !== undefined ? String(v).trim() : '';
    };
    let preScanRejected = 0;
    let preScanInvalidNid = 0;
    const overwriteNotes: string[] = [];
    for (const row of dataRows) {
      if (!row || row.length === 0 || row.every((c) => c === '' || c === null || c === undefined)) continue;
      const nidVal = cleanNationalId(scanCell(row, 'national_id')) || '';
      const hasIdentifier = !!(scanCell(row, 'employee_code') || scanCell(row, 'employee_name') || nidVal);
      if (!hasIdentifier) preScanRejected++;
      else if (nidVal.length !== 14) preScanInvalidNid++;
    }
    if (confirmOverwrite && hasExisting && (preScanRejected > 0 || preScanInvalidNid > 0)) {
      return NextResponse.json({
        error: `الملف يحتوي على ${preScanInvalidNid} صف بدون رقم قومي صحيح من 14 رقمًا و ${preScanRejected} صف بدون أي معرّف. لا يمكن استبدال البيانات الحالية بملف غير مكتمل — صحّح الملف أولاً (المطابقة بالرقم القومي فقط)؛ لم تُحذف أي بيانات.`,
        blockedOverwrite: true,
        invalidNidRows: preScanInvalidNid,
        rejectedRows: preScanRejected,
      }, { status: 422 });
    }

    // Handle overwrite cleanup if confirmed
    if (confirmOverwrite && hasExisting) {
      if (sourceType === 'monthly_payroll') {
        await supabaseServer
          .from('monthly_payroll_records')
          .delete()
          .eq('period_year', periodYear!)
          .eq('period_month', periodMonth!)
          .eq('account_id', accountId!);
        await supabaseServer
          .from('import_logs')
          .delete()
          .eq('source_type', sourceType)
          .eq('period_year', periodYear!)
          .eq('period_month', periodMonth!)
          .eq('account_id', accountId!);
      } else if (sourceType === 'monthly_insurance') {
        await supabaseServer
          .from('monthly_insurance_records')
          .delete()
          .eq('period_year', periodYear!)
          .eq('period_month', periodMonth!)
          .eq('account_id', accountId!);
        await supabaseServer
          .from('import_logs')
          .delete()
          .eq('source_type', sourceType)
          .eq('period_year', periodYear!)
          .eq('period_month', periodMonth!)
          .eq('account_id', accountId!);
      } else if (sourceType === 'incoming_insurance' || (sourceType as string) === 'official_insurance_print') {
        // Row-company partition (confirmed mixed-source model): an overwrite
        // of a mixed source may only replace records whose company resolves
        // to an account present in the NEW file. Other accounts' rows and
        // unattributed (NULL/unknown-company) rows are preserved. Old import
        // logs are kept so their ON DELETE CASCADE cannot wipe records
        // outside the partition.
        const isPrintOverwrite = (sourceType as string) === 'official_insurance_print';
        const accCache = new Map<string, number | null>();
        const resolveCached = async (txt: string): Promise<number | null> => {
          const key = txt.trim().toLowerCase();
          if (!key) return null;
          if (accCache.has(key)) return accCache.get(key) ?? null;
          const ra = await resolveAccount(txt);
          accCache.set(key, ra ? ra.id : null);
          return ra ? ra.id : null;
        };
        const newFileAccounts = new Set<number>();
        for (const row of dataRows) {
          if (!row || row.length === 0 || row.every((c) => c === '' || c === null || c === undefined)) continue;
          const accIdx = headers.findIndex((h) => h === 'الشركة' || h === 'الشركه');
          const cell = accIdx >= 0 && row[accIdx] !== null && row[accIdx] !== undefined ? String(row[accIdx]).trim() : '';
          const rid = cell ? await resolveCached(cell) : accountId;
          if (rid !== null) newFileAccounts.add(rid);
        }
        const deletableIds: string[] = [];
        let preservedCount = 0;
        let fromIdx = 0;
        for (;;) {
          const { data: page } = await supabaseServer
            .from('incoming_insurance_records')
            .select('id, company_account, form_type')
            .range(fromIdx, fromIdx + 999);
          if (!page || page.length === 0) break;
          for (const rec of page as Array<{ id: string; company_account: string | null; form_type: string | null }>) {
            const formMatch = isPrintOverwrite
              ? String(rec.form_type || '').includes('برنت')
              : !String(rec.form_type || '').includes('برنت');
            if (!formMatch) continue;
            const recAccId = rec.company_account ? await resolveCached(String(rec.company_account)) : null;
            if (recAccId !== null && newFileAccounts.has(recAccId)) deletableIds.push(rec.id);
            else preservedCount++;
          }
          if (page.length < 1000) break;
          fromIdx += 1000;
        }
        for (let i = 0; i < deletableIds.length; i += 500) {
          await supabaseServer.from('incoming_insurance_records').delete().in('id', deletableIds.slice(i, i + 500));
        }
        if (preservedCount > 0) {
          overwriteNotes.push(`تم الاحتفاظ بـ ${preservedCount} سجل يخص حسابات أخرى أو غير منسوب — لم يمسّه الاستبدال`);
        }
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
        account_id: accountId,
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
    let rowsNeedingReview = 0;
    const rejectedReasons: string[] = [...overwriteNotes];
    // Row-account resolution (confirmed mixed-source model): an explicit
    // الشركه/الشركة cell on incoming-insurance / official-print rows wins over
    // the operator-selected account; a blank or unknown cell on a sheet that
    // HAS a company column is fail-closed review, never the operator default.
    const recRowAccount = new Map<object, number | null>();
    const unresolvedCompanyRecs = new Set<object>();
    const hasCompanyColumn = (sourceType === 'incoming_insurance' || (sourceType as string) === 'official_insurance_print')
      && (headers.includes('الشركة') || headers.includes('الشركه'));

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
      // Identity is the 14-digit national ID ONLY (user rule). Conservative
      // cleaning: Arabic-Indic digits translated, documented Excel forms
      // permitted; malformed tokens become null (review), never blind-stripped.
      const natId = cleanNationalId(getVal(row, 'national_id') || rawRowObj['الرقم القومى 2'] || rawRowObj['الرقم القومي']) || '';

      // Rule: Do not invent missing IDs, but row must have at least one valid identifier (code, national_id, or name)
      if (!empCode && !empName && !natId) {
        rowsRejected++;
        if (rejectedReasons.length < 5) {
          rejectedReasons.push(`الصف ${r + 2}: لا يحتوي على أي معرّف (كود أو رقم قومي أو اسم).`);
        }
        continue;
      }
      if (natId.length !== 14) rowsNeedingReview++;

      if (sourceType === 'incoming_insurance' || (sourceType as string) === 'official_insurance_print') {
        const isOfficialPrint = (sourceType as string) === 'official_insurance_print';
        const insWage = getVal(row, 'insurance_salary') || rawRowObj['قيمة الاجر'] || rawRowObj['الاجر التأمينى'] || '';
        const insJob = getVal(row, 'insurance_job_title') || rawRowObj['المهنة'] || rawRowObj['المهنه'] || null;
        const formT = isOfficialPrint ? 'برنت تأمينات رسمي (22/09/2026)' : (getVal(row, 'form_type') || null);

        // Row company: explicit cell wins; blank/unknown on a company-column
        // sheet -> review (never the operator default, never NULL-stamped).
        let rowAccountId: number | null = accountId;
        let rowAccountCode: string | null = null;
        let rowCompanyUnresolved = false;
        const rawAccCell = (rawRowObj['الشركة'] || rawRowObj['الشركه'] || '').trim();
        if (rawAccCell) {
          const ra = await resolveAccount(rawAccCell);
          if (ra) {
            rowAccountId = ra.id;
            rowAccountCode = ra.code;
          } else {
            rowCompanyUnresolved = true;
          }
        } else if (hasCompanyColumn) {
          rowCompanyUnresolved = true;
        }
        if (rowCompanyUnresolved) {
          rowAccountId = null;
          rowsNeedingReview++;
          await supabaseServer.from('matching_conflicts').insert({
            conflict_type: 'unknown_row_company',
            conflict_data: {
              source_type: sourceType,
              employee_name: empName || null,
              employee_code: empCode || null,
              national_id: natId || null,
              row_company_raw: rawAccCell || null,
              action_required: 'شركة الصف غير محددة أو غير معروفة في مصدر مختلط — لم تُنسب لأي حساب؛ تحتاج مراجعة',
            },
            resolved: false,
          });
        }

        const incomingRec = {
          import_id: importId,
          employee_code: empCode || getVal(row, 'employee_code') || rawRowObj['رقم الاداء'] || null,
          employee_name: empName || getVal(row, 'employee_name') || rawRowObj['اسم المؤمن عليه '] || rawRowObj['اسم المؤمن عليه'] || null,
          national_id: natId || cleanNationalId(rawRowObj['الرقم القومى 2'] || rawRowObj['الرقم القومي']) || null,
          job_title: getVal(row, 'job_title') || null,
          status: getVal(row, 'status') || rawRowObj['الحاله '] || rawRowObj['الحالة'] || null,
          // Resolved canonical row account (explicit cell wins); null when
          // unresolved (review) or when the sheet has no company column.
          company_account: rowAccountCode,
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
        };
        recordsToInsert.push(incomingRec);
        recRowAccount.set(incomingRec, rowAccountId);
        if (rowCompanyUnresolved) unresolvedCompanyRecs.add(incomingRec);
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
          account_id: accountId!,
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
          account_id: accountId!,
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
        .select('id, company_account, account_id, employee_code, national_id, employee_name, current_job_title, consolidated_data');

      interface EmpMasterLookup {
        id: string;
        company_account: string;
        account_id: number | null;
        employee_code: string | null;
        national_id: string | null;
        employee_name: string;
        current_job_title?: string | null;
        consolidated_data: Json;
      }

      // Identity matching is by 14-digit national ID ONLY (user rule): no
      // insurance-number / employee-code / name fallback maps.
      const byNatId = new Map<string, EmpMasterLookup>();
      const byNatIdAccount = new Map<string, EmpMasterLookup>();
      // Code map for CONTRADICTION DETECTION ONLY (never matching): the same
      // account+code under a different NID is a conflict, not a merge target.
      const byCodeAccountDetect = new Map<string, EmpMasterLookup>();

      (existingEmps || []).forEach((emp) => {
        if (emp.national_id && String(emp.national_id).trim().length === 14) {
          const n = String(emp.national_id).trim();
          byNatId.set(n, emp);
          if (emp.account_id !== null && emp.account_id !== undefined) {
            byNatIdAccount.set(`${emp.account_id}:${n}`, emp);
          }
        }
        if (emp.employee_code && String(emp.employee_code).trim()) {
          const c = String(emp.employee_code).trim();
          if (emp.account_id !== null && emp.account_id !== undefined) {
            byCodeAccountDetect.set(`${emp.account_id}:${c}`, emp);
          }
          if (emp.company_account) {
            byCodeAccountDetect.set(`txt:${emp.company_account.trim().toLowerCase()}:${c}`, emp);
          }
        }
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const employeesToInsert: Array<Record<string, any>> = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const employeesToUpdate: Array<{ id: string; data: Record<string, any> }> = [];

      for (const rec of recordsToInsert) {
        // Rows whose company could not be resolved on a mixed source already
        // carry a review conflict; they never touch employees_master.
        if (unresolvedCompanyRecs.has(rec)) continue;
        // Row Account (explicit cell) wins; otherwise the operator default.
        const rowAccountId: number | null = recRowAccount.has(rec) ? (recRowAccount.get(rec) ?? null) : accountId;
        const raw = (rec.raw_data as Record<string, string>) || {};
        const code = (rec.employee_code ? String(rec.employee_code).trim() : '') || raw['الكود'] || '';
        const nid = (rec.national_id ? String(rec.national_id).trim() : '') || raw['الرقم القومي'] || raw['القومي'] || '';
        const name = (rec.employee_name ? String(rec.employee_name).trim() : '') || raw['الاسم'] || '';
        const acc = (rec.company_account ? String(rec.company_account).trim() : '') || raw['الشركة'] || raw['الشركه'] || '';

        const validNid = !!nid && nid.length === 14;
        let matched: EmpMasterLookup | null = null;
        // NATIONAL ID ONLY (user rule): no insurance-number, employee-code, or
        // name fallback. Same code with a different NID must NEVER merge.
        if (validNid) {
          matched = byNatIdAccount.get(`${rowAccountId}:${nid}`) || null;
          if (!matched) {
            const anyAcc = byNatId.get(nid) || null;
            if (anyAcc) {
              if (anyAcc.account_id === null || anyAcc.account_id === undefined) {
                // Legacy master with no account stamp: claimable by this account.
                matched = anyAcc;
              } else {
                // Same NID in a DIFFERENT account: never merge across accounts —
                // review, per the same fail-closed guard as the smart import.
                await supabaseServer.from('matching_conflicts').insert({
                  conflict_type: 'cross_account_national_id',
                  conflict_data: {
                    source_type: sourceType,
                    employee_id: anyAcc.id,
                    national_id: nid,
                    employee_name: name,
                    master_company_account: anyAcc.company_account,
                    import_company_account: acc,
                    action_required: 'نفس الرقم القومي موجود في حساب آخر — لم تُدمج البيانات؛ يحتاج مراجعة',
                  },
                  resolved: false,
                });
                continue;
              }
            }
          }
        }

        const now = new Date().toISOString();

        if (matched) {
          const oldConsolidated = (matched.consolidated_data as Record<string, unknown>) || {};
          const financialLedger = (oldConsolidated.financial_ledger as Record<string, Record<string, unknown>>) || {
            salaries_by_month: {},
            attendance_by_month: {},
            ins_wages_by_month: {},
          };

          // Blank cell = no data (skipped); an EXPLICIT 0 is meaningful and recorded.
          const cellNum = (v: unknown): number | null => { if (v === undefined || v === null || String(v).trim() === '') return null; const n = parseFloat(String(v).replace(/[^0-9.-]/g, '')); return isNaN(n) ? null : n; };
          if (sourceType === 'monthly_payroll' && periodMonth) {
            const salary = cellNum(raw['الراتب'] ?? raw['اجمالي المستحق'] ?? raw['صافى التحويل'] ?? raw['الاجر الشامل']);
            const att = cellNum(rec.attendance_days ?? raw['عدد ايام الحضور']);
            if (salary !== null) financialLedger.salaries_by_month[String(periodMonth)] = salary;
            if (att !== null) financialLedger.attendance_by_month[String(periodMonth)] = att;
          } else if (sourceType === 'monthly_insurance' && periodMonth) {
            const insWage = cellNum(raw['الاجر التاميني'] ?? raw['الاجر التامينى']);
            if (insWage !== null) financialLedger.ins_wages_by_month[String(periodMonth)] = insWage;
          }

          const newConsolidated = {
            ...oldConsolidated,
            financial_ledger: financialLedger,
            last_source_update: sourceType,
          };

          matched.consolidated_data = newConsolidated as Json;

          if ((sourceType as string) === 'official_insurance_print') {
            const insSalaryRaw = (raw['قيمة الاجر'] ?? raw['الاجر التأمينى']); const insSalaryParsed = insSalaryRaw === undefined || insSalaryRaw === null || String(insSalaryRaw).trim() === '' ? NaN : parseFloat(String(insSalaryRaw).replace(/[^0-9.-]/g, '')); const insSalaryVal = isNaN(insSalaryParsed) ? null : insSalaryParsed; // explicit 0 preserved; only blank/unparseable -> null
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
          if (!validNid) {
            // NID-only identity (user rule): without a valid 14-digit national
            // ID a row can neither match nor create a master record (a master
            // without an NID could never be matched later and would duplicate
            // the person when the NID arrives). Route to review instead.
            await supabaseServer.from('matching_conflicts').insert({
              conflict_type: 'invalid_national_id',
              conflict_data: {
                source_type: sourceType,
                employee_name: name || null,
                employee_code: code || null,
                national_id_raw: nid || null,
                company_account: acc,
                action_required: 'لا يمكن إنشاء أو مطابقة سجل بدون رقم قومي صحيح من 14 رقمًا — يحتاج مراجعة',
              },
              resolved: false,
            });
            continue;
          }
          if (code) {
            const codeHolder =
              byCodeAccountDetect.get(`${rowAccountId}:${code}`) ||
              byCodeAccountDetect.get(`txt:${acc.toLowerCase()}:${code}`) ||
              null;
            if (codeHolder && codeHolder.national_id && String(codeHolder.national_id).trim() !== nid) {
              // Same account+code but a DIFFERENT national ID: identity
              // contradiction (schema also forbids two masters on the same
              // account code). Never merge, never overwrite — review.
              await supabaseServer.from('matching_conflicts').insert({
                conflict_type: 'code_nid_conflict',
                conflict_data: {
                  source_type: sourceType,
                  employee_id: codeHolder.id,
                  employee_code: code,
                  existing_national_id: codeHolder.national_id,
                  incoming_national_id: nid,
                  employee_name: name,
                  company_account: acc,
                  action_required: 'نفس كود الموظف في نفس الحساب مسجل برقم قومي مختلف — لم يُدمج ولم يُنشأ سجل؛ يحتاج مراجعة',
                },
                resolved: false,
              });
              continue;
            }
          }
          const newId = crypto.randomUUID();

          if ((sourceType as string) === 'official_insurance_print') {
            const insSalaryRaw = (raw['قيمة الاجر'] ?? raw['الاجر التأمينى']); const insSalaryParsed = insSalaryRaw === undefined || insSalaryRaw === null || String(insSalaryRaw).trim() === '' ? NaN : parseFloat(String(insSalaryRaw).replace(/[^0-9.-]/g, '')); const insSalaryVal = isNaN(insSalaryParsed) ? null : insSalaryParsed; // explicit 0 preserved; only blank/unparseable -> null
            const insJobVal = rec.insurance_job_title || raw['المهنة'] || null;
            const insNumVal = rec.insurance_number || raw['الرقم التأميني للمؤمن علية'] || null;
            const subDateVal = rec.subscription_start_date || raw['تاريخ بداية المده'] || null;

            const newRecord = {
              id: newId,
              company_account: acc,
              account_id: rowAccountId,
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
            if (nid) {
              byNatId.set(nid, lookupItem);
              if (rowAccountId !== null) byNatIdAccount.set(`${rowAccountId}:${nid}`, lookupItem);
            }
            if (code && rowAccountId !== null) byCodeAccountDetect.set(`${rowAccountId}:${code}`, lookupItem);
            continue;
          }
          const financialLedger = {
            salaries_by_month: {} as Record<string, number>,
            attendance_by_month: {} as Record<string, number>,
            ins_wages_by_month: {} as Record<string, number>,
          };

          // Blank cell = no data (skipped); an EXPLICIT 0 is meaningful and recorded.
          const cellNum = (v: unknown): number | null => { if (v === undefined || v === null || String(v).trim() === '') return null; const n = parseFloat(String(v).replace(/[^0-9.-]/g, '')); return isNaN(n) ? null : n; };
          if (sourceType === 'monthly_payroll' && periodMonth) {
            const salary = cellNum(raw['الراتب'] ?? raw['اجمالي المستحق'] ?? raw['صافى التحويل'] ?? raw['الاجر الشامل']);
            const att = cellNum(rec.attendance_days ?? raw['عدد ايام الحضور']);
            if (salary !== null) financialLedger.salaries_by_month[String(periodMonth)] = salary;
            if (att !== null) financialLedger.attendance_by_month[String(periodMonth)] = att;
          } else if (sourceType === 'monthly_insurance' && periodMonth) {
            const insWage = cellNum(raw['الاجر التاميني'] ?? raw['الاجر التامينى']);
            if (insWage !== null) financialLedger.ins_wages_by_month[String(periodMonth)] = insWage;
          }

          const newRecord = {
            id: newId,
            company_account: acc,
            account_id: rowAccountId,
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
          if (nid) {
            byNatId.set(nid, lookupItem);
            if (rowAccountId !== null) byNatIdAccount.set(`${rowAccountId}:${nid}`, lookupItem);
          }
          if (code && rowAccountId !== null) byCodeAccountDetect.set(`${rowAccountId}:${code}`, lookupItem);
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
    const reviewNote = rowsNeedingReview > 0 ? `${rowsNeedingReview} صف بدون رقم قومي صحيح يحتاج مراجعة (المطابقة بالرقم القومي فقط)` : '';
    await supabaseServer
      .from('import_logs')
      .update({
        rows_accepted: rowsAccepted,
        rows_rejected: rowsRejected,
        notes: [rejectedReasons.length > 0 ? rejectedReasons.join(' | ') : 'تم الاستيراد بنجاح دون أخطاء', reviewNote].filter(Boolean).join(' | '),
      })
      .eq('id', importId);

    return NextResponse.json({
      success: true,
      importId,
      totalRowsRead,
      rowsAccepted,
      rowsRejected,
      rowsNeedingReview,
      rejectedReasons,
      message: `تم استيراد ${rowsAccepted} سجل بنجاح. ${rowsRejected > 0 ? `(تم رفض ${rowsRejected} سجل غير صالح)` : ''}${rowsNeedingReview > 0 ? ` (${rowsNeedingReview} سجل بدون رقم قومي صحيح يحتاج مراجعة)` : ''}`,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'حدث خطأ غير متوقع أثناء استيراد البيانات';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
