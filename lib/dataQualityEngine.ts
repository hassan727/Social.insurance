/**
 * Data Quality Engine — محرك اكتشاف التعارضات وجودة البيانات
 *
 * يفحص قاعدة البيانات الموحدة ويكتشف أي تعارضات بين المصادر المختلفة.
 * النتائج تُحفظ في جدول data_discrepancies.
 *
 * القاعدة: لا يتم حسم أي تعارض تلقائياً — كل شيء يُعرض للمراجعة البشرية.
 */

import { supabaseService } from './supabaseServer';

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type DiscrepancyType =
  | 'active_in_db_resigned_in_res'
  | 'active_no_insurance_number'
  | 'national_id_multiple_codes'
  | 'insurance_number_multiple_employees'
  | 'in_insurance_not_in_db'
  | 'in_db_not_in_insurance'
  | 'duplicate_bank_account'
  | 'multiple_job_titles'
  | 'insurance_ended_still_active'
  | 'job_title_mismatch_insurance'
  | 'salary_mismatch'
  | 'missing_national_id'
  | 'missing_phone'
  | 'missing_hire_date'
  | 'missing_insurance_number'
  | 'name_variation_same_code'
  | 'code_in_insurance_not_in_master';

export type DiscrepancySeverity = 'critical' | 'warning' | 'info';

export interface DiscrepancyRecord {
  employee_id: string | null;
  raw_employee_code?: string | null;
  raw_national_id?: string | null;
  raw_employee_name?: string | null;
  discrepancy_type: DiscrepancyType;
  severity: DiscrepancySeverity;
  source_a: string | null;
  source_b: string | null;
  field_name: string | null;
  value_a: string | null;
  value_b: string | null;
  description: string;
}

export interface QualityRunSummary {
  success: boolean;
  run_id: string;
  duration_ms: number;
  total_employees_checked: number;
  discrepancies_found: number;
  new_discrepancies: number;
  by_type: Record<DiscrepancyType | string, number>;
  by_severity: {
    critical: number;
    warning: number;
    info: number;
  };
  errors: string[];
}

export interface DiscrepancyStats {
  total_open: number;
  by_type: Array<{ discrepancy_type: string; count: number; severity: string }>;
  by_severity: { critical: number; warning: number; info: number };
  last_run_at: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// SEVERITY MAP
// ═══════════════════════════════════════════════════════════════════════════

const SEVERITY_MAP: Record<DiscrepancyType, DiscrepancySeverity> = {
  active_in_db_resigned_in_res: 'critical',
  active_no_insurance_number: 'critical',
  national_id_multiple_codes: 'critical',
  insurance_number_multiple_employees: 'critical',
  insurance_ended_still_active: 'critical',
  in_insurance_not_in_db: 'warning',
  in_db_not_in_insurance: 'warning',
  duplicate_bank_account: 'warning',
  multiple_job_titles: 'warning',
  job_title_mismatch_insurance: 'warning',
  salary_mismatch: 'warning',
  code_in_insurance_not_in_master: 'warning',
  name_variation_same_code: 'info',
  missing_national_id: 'info',
  missing_phone: 'info',
  missing_hire_date: 'info',
  missing_insurance_number: 'warning',
};

// ═══════════════════════════════════════════════════════════════════════════
// HELPER: Batch upsert discrepancies
// Each discrepancy is identified by (employee_id, discrepancy_type, field_name).
// If already open, we just update last_checked_at.
// ═══════════════════════════════════════════════════════════════════════════

async function upsertDiscrepancies(records: DiscrepancyRecord[]): Promise<number> {
  if (records.length === 0) return 0;

  let inserted = 0;
  const BATCH = 50;

  for (let i = 0; i < records.length; i += BATCH) {
    const batch = records.slice(i, i + BATCH);

    // For each record, try to find existing open discrepancy
    for (const rec of batch) {
      const matchConds: Record<string, unknown> = {
        discrepancy_type: rec.discrepancy_type,
        status: 'open',
      };
      if (rec.employee_id) matchConds.employee_id = rec.employee_id;
      if (rec.field_name) matchConds.field_name = rec.field_name;

      const { data: existing } = await supabaseService
        .from('data_discrepancies')
        .select('id')
        .match(matchConds)
        .maybeSingle();

      if (existing) {
        // Update last_checked_at only
        await supabaseService
          .from('data_discrepancies')
          .update({ last_checked_at: new Date().toISOString() })
          .eq('id', existing.id);
      } else {
        // Insert new discrepancy
        const { error } = await supabaseService.from('data_discrepancies').insert({
          employee_id: rec.employee_id,
          raw_employee_code: rec.raw_employee_code ?? null,
          raw_national_id: rec.raw_national_id ?? null,
          raw_employee_name: rec.raw_employee_name ?? null,
          discrepancy_type: rec.discrepancy_type,
          severity: rec.severity,
          source_a: rec.source_a,
          source_b: rec.source_b,
          field_name: rec.field_name,
          value_a: rec.value_a,
          value_b: rec.value_b,
          description: rec.description,
          status: 'open',
        });
        if (!error) inserted++;
      }
    }
  }

  return inserted;
}

// ═══════════════════════════════════════════════════════════════════════════
// CHECK 1: موظفون Active في Master بلا رقم تأميني
// ═══════════════════════════════════════════════════════════════════════════

async function checkActiveMissingInsurance(): Promise<DiscrepancyRecord[]> {
  const { data } = await supabaseService
    .from('employees_master')
    .select('id, employee_code, national_id, employee_name, company_account, current_status, insurance_number')
    .in('current_status', ['Active', 'نشط', 'مستمر'])
    .is('insurance_number', null);

  return (data || []).map((emp) => ({
    employee_id: emp.id,
    raw_employee_code: emp.employee_code,
    raw_national_id: emp.national_id,
    raw_employee_name: emp.employee_name,
    discrepancy_type: 'active_no_insurance_number' as DiscrepancyType,
    severity: SEVERITY_MAP.active_no_insurance_number,
    source_a: 'employees_master',
    source_b: null,
    field_name: 'insurance_number',
    value_a: null,
    value_b: null,
    description: `الموظف ${emp.employee_name} (${emp.employee_code} - ${emp.company_account}) حالته Active ولا يوجد له رقم تأميني`,
  }));
}

// ═══════════════════════════════════════════════════════════════════════════
// CHECK 2: موظفون بلا رقم قومي
// ═══════════════════════════════════════════════════════════════════════════

async function checkMissingNationalId(): Promise<DiscrepancyRecord[]> {
  const { data } = await supabaseService
    .from('employees_master')
    .select('id, employee_code, employee_name, company_account, current_status')
    .is('national_id', null)
    .in('current_status', ['Active', 'نشط', 'مستمر', 'New', 'جديد']);

  return (data || []).map((emp) => ({
    employee_id: emp.id,
    raw_employee_code: emp.employee_code,
    raw_national_id: null,
    raw_employee_name: emp.employee_name,
    discrepancy_type: 'missing_national_id' as DiscrepancyType,
    severity: SEVERITY_MAP.missing_national_id,
    source_a: 'employees_master',
    source_b: null,
    field_name: 'national_id',
    value_a: null,
    value_b: null,
    description: `الموظف ${emp.employee_name} (${emp.employee_code} - ${emp.company_account}) لا يوجد له رقم قومي`,
  }));
}

// ═══════════════════════════════════════════════════════════════════════════
// CHECK 3: موظفون بلا تليفون
// ═══════════════════════════════════════════════════════════════════════════

async function checkMissingPhone(): Promise<DiscrepancyRecord[]> {
  const { data } = await supabaseService
    .from('employees_master')
    .select('id, employee_code, employee_name, company_account, current_status')
    .is('phone_number', null)
    .in('current_status', ['Active', 'نشط', 'مستمر']);

  return (data || []).map((emp) => ({
    employee_id: emp.id,
    raw_employee_code: emp.employee_code,
    raw_national_id: null,
    raw_employee_name: emp.employee_name,
    discrepancy_type: 'missing_phone' as DiscrepancyType,
    severity: SEVERITY_MAP.missing_phone,
    source_a: 'employees_master',
    source_b: null,
    field_name: 'phone_number',
    value_a: null,
    value_b: null,
    description: `الموظف ${emp.employee_name} (${emp.employee_code}) لا يوجد له رقم هاتف`,
  }));
}

// ═══════════════════════════════════════════════════════════════════════════
// CHECK 4: موظفون بلا تاريخ استلام عمل
// ═══════════════════════════════════════════════════════════════════════════

async function checkMissingHireDate(): Promise<DiscrepancyRecord[]> {
  const { data } = await supabaseService
    .from('employees_master')
    .select('id, employee_code, employee_name, company_account, current_status')
    .is('hire_date', null)
    .in('current_status', ['Active', 'نشط', 'مستمر']);

  return (data || []).map((emp) => ({
    employee_id: emp.id,
    raw_employee_code: emp.employee_code,
    raw_national_id: null,
    raw_employee_name: emp.employee_name,
    discrepancy_type: 'missing_hire_date' as DiscrepancyType,
    severity: SEVERITY_MAP.missing_hire_date,
    source_a: 'employees_master',
    source_b: null,
    field_name: 'hire_date',
    value_a: null,
    value_b: null,
    description: `الموظف ${emp.employee_name} (${emp.employee_code}) لا يوجد له تاريخ استلام عمل`,
  }));
}

// ═══════════════════════════════════════════════════════════════════════════
// CHECK 5: رقم قومي واحد مرتبط بأكثر من كود
// ═══════════════════════════════════════════════════════════════════════════

async function checkNationalIdMultipleCodes(): Promise<DiscrepancyRecord[]> {
  // Direct query via JS grouping to find duplicated national_ids
  const { data: allEmps } = await supabaseService
    .from('employees_master')
    .select('id, employee_code, employee_name, company_account, national_id')
    .not('national_id', 'is', null);

  const byNatId = new Map<string, typeof allEmps>();
  for (const emp of allEmps || []) {
    if (!emp.national_id) continue;
    const key = emp.national_id.trim();
    if (!byNatId.has(key)) byNatId.set(key, []);
    byNatId.get(key)!.push(emp);
  }

  const discrepancies: DiscrepancyRecord[] = [];
  for (const [natId, emps] of byNatId.entries()) {
    if (!emps || emps.length < 2) continue;
    const codes = emps.map((e) => `${e.employee_code}(${e.company_account})`).join(', ');
    // Report against the first occurrence; the second is source_b
    discrepancies.push({
      employee_id: emps[0]!.id,
      raw_national_id: natId,
      raw_employee_name: emps[0]!.employee_name,
      discrepancy_type: 'national_id_multiple_codes',
      severity: SEVERITY_MAP.national_id_multiple_codes,
      source_a: 'employees_master',
      source_b: 'employees_master',
      field_name: 'national_id',
      value_a: emps[0]!.employee_code,
      value_b: emps.slice(1).map((e) => e.employee_code).join(', '),
      description: `الرقم القومي ${natId} مرتبط بأكثر من سجل: ${codes}`,
    });
  }

  return discrepancies;
}

// ═══════════════════════════════════════════════════════════════════════════
// CHECK 6: رقم تأميني واحد مرتبط بأكثر من موظف
// ═══════════════════════════════════════════════════════════════════════════

async function checkInsuranceNumberDuplicate(): Promise<DiscrepancyRecord[]> {
  const { data: allEmps } = await supabaseService
    .from('employees_master')
    .select('id, employee_code, employee_name, company_account, insurance_number')
    .not('insurance_number', 'is', null)
    .neq('insurance_number', '0')
    .neq('insurance_number', '');

  const byInsNo = new Map<string, typeof allEmps>();
  for (const emp of allEmps || []) {
    if (!emp.insurance_number) continue;
    const key = emp.insurance_number.trim();
    if (!byInsNo.has(key)) byInsNo.set(key, []);
    byInsNo.get(key)!.push(emp);
  }

  const discrepancies: DiscrepancyRecord[] = [];
  for (const [insNo, emps] of byInsNo.entries()) {
    if (!emps || emps.length < 2) continue;
    discrepancies.push({
      employee_id: emps[0]!.id,
      raw_employee_code: emps[0]!.employee_code,
      raw_employee_name: emps[0]!.employee_name,
      discrepancy_type: 'insurance_number_multiple_employees',
      severity: SEVERITY_MAP.insurance_number_multiple_employees,
      source_a: 'employees_master',
      source_b: 'employees_master',
      field_name: 'insurance_number',
      value_a: insNo,
      value_b: emps.map((e) => `${e.employee_name}(${e.employee_code})`).join(', '),
      description: `الرقم التأميني ${insNo} مرتبط بأكثر من موظف: ${emps.map((e) => e.employee_name).join(', ')}`,
    });
  }

  return discrepancies;
}

// ═══════════════════════════════════════════════════════════════════════════
// CHECK 7: Active في master ومستقيل في sheet_data (RES)
// ═══════════════════════════════════════════════════════════════════════════

async function checkActiveResignedConflict(): Promise<DiscrepancyRecord[]> {
  // Find employees marked Active in master but having resignation data in sheet_data
  // Every RES catalog entry across accounts (+ legacy shared): with
  // per-account catalogs the same worksheet name exists once per account,
  // so a single maybeSingle() would error or silently cover one account.
  // Rows are linked to employees (person-centric), so checking every
  // account's RES sheet is correct coverage.
  const { data: resSheets } = await supabaseService
    .from('dynamic_sheets')
    .select('id')
    .or('sheet_name.eq.RES,sheet_name.eq.RES.');

  if (!resSheets || resSheets.length === 0) return [];
  const resSheetIds = resSheets.map((s) => s.id as string);

  const { data: resignedRows } = await supabaseService
    .from('sheet_data')
    .select('employee_id, row_data, row_code, row_national_id, row_name')
    .in('sheet_id', resSheetIds)
    .eq('is_latest', true)
    .not('employee_id', 'is', null);

  const discrepancies: DiscrepancyRecord[] = [];

  for (const row of resignedRows || []) {
    if (!row.employee_id) continue;

    // Check if this employee is Active in master
    const { data: master } = await supabaseService
      .from('employees_master')
      .select('id, employee_code, employee_name, company_account, current_status')
      .eq('id', row.employee_id)
      .in('current_status', ['Active', 'نشط', 'مستمر'])
      .maybeSingle();

    if (master) {
      discrepancies.push({
        employee_id: master.id,
        raw_employee_code: master.employee_code,
        raw_employee_name: master.employee_name,
        discrepancy_type: 'active_in_db_resigned_in_res',
        severity: SEVERITY_MAP.active_in_db_resigned_in_res,
        source_a: 'employees_master',
        source_b: 'RES',
        field_name: 'current_status',
        value_a: master.current_status,
        value_b: 'مستقيل (موجود في RES)',
        description: `الموظف ${master.employee_name} (${master.employee_code}) حالته Active في قاعدة البيانات لكنه موجود في شيت الاستقالات RES`,
      });
    }
  }

  return discrepancies;
}

// ═══════════════════════════════════════════════════════════════════════════
// CHECK 8: اختلاف الوظيفة بين master وبيانات التأمينات
// ═══════════════════════════════════════════════════════════════════════════

async function checkJobTitleMismatch(): Promise<DiscrepancyRecord[]> {
  const { data } = await supabaseService
    .from('employees_master')
    .select('id, employee_code, employee_name, company_account, current_job_title, insurance_job_title')
    .not('current_job_title', 'is', null)
    .not('insurance_job_title', 'is', null);

  const discrepancies: DiscrepancyRecord[] = [];

  for (const emp of data || []) {
    const dbJob = normalizeText(emp.current_job_title || '');
    const insJob = normalizeText(emp.insurance_job_title || '');
    if (dbJob && insJob && dbJob !== insJob) {
      discrepancies.push({
        employee_id: emp.id,
        raw_employee_code: emp.employee_code,
        raw_employee_name: emp.employee_name,
        discrepancy_type: 'job_title_mismatch_insurance',
        severity: SEVERITY_MAP.job_title_mismatch_insurance,
        source_a: 'employees_master',
        source_b: 'Social Insurance',
        field_name: 'job_title',
        value_a: emp.current_job_title,
        value_b: emp.insurance_job_title,
        description: `الموظف ${emp.employee_name} (${emp.employee_code}): الوظيفة في قاعدة البيانات "${emp.current_job_title}" تختلف عن الوظيفة في التأمينات "${emp.insurance_job_title}"`,
      });
    }
  }

  return discrepancies;
}

// ═══════════════════════════════════════════════════════════════════════════
// CHECK 9: موظفون في incoming_insurance غير موجودين في master
// NOTE: This is expensive — run in batches
// ═══════════════════════════════════════════════════════════════════════════

async function checkInInsuranceNotInMaster(): Promise<DiscrepancyRecord[]> {
  // Get all employee codes + national_ids from incoming_insurance_records
  const { data: insRecords } = await supabaseService
    .from('incoming_insurance_records')
    .select('id, employee_code, national_id, employee_name, company_account, status')
    .in('status', ['Active', 'نشط', 'مؤمن عليه', 'مستمر'])
    .limit(500);

  const discrepancies: DiscrepancyRecord[] = [];

  for (const rec of insRecords || []) {
    // Try to find in master by national_id first, then by code
    let found = false;

    if (rec.national_id) {
      const { data } = await supabaseService
        .from('employees_master')
        .select('id')
        .eq('national_id', rec.national_id)
        .maybeSingle();
      if (data) found = true;
    }

    if (!found && rec.employee_code) {
      const { data } = await supabaseService
        .from('employees_master')
        .select('id')
        .eq('employee_code', rec.employee_code)
        .limit(1);
      if (data && data.length > 0) found = true;
    }

    if (!found) {
      discrepancies.push({
        employee_id: null,
        raw_employee_code: rec.employee_code,
        raw_national_id: rec.national_id,
        raw_employee_name: rec.employee_name,
        discrepancy_type: 'in_insurance_not_in_db',
        severity: SEVERITY_MAP.in_insurance_not_in_db,
        source_a: 'incoming_insurance_records',
        source_b: 'employees_master',
        field_name: null,
        value_a: rec.employee_code ?? rec.national_id,
        value_b: null,
        description: `الموظف ${rec.employee_name} (${rec.employee_code} - ${rec.company_account}) موجود في وارد التأمين لكن غير موجود في قاعدة البيانات الرئيسية`,
      });
    }
  }

  return discrepancies;
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER: Normalize Arabic text for comparison
// ═══════════════════════════════════════════════════════════════════════════

function normalizeText(text: string): string {
  return text
    .trim()
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN: runDataQualityCheck
// ═══════════════════════════════════════════════════════════════════════════

export async function runDataQualityCheck(options?: {
  checks?: DiscrepancyType[];
  triggered_by?: string;
}): Promise<QualityRunSummary> {
  const startTime = Date.now();
  const errors: string[] = [];
  const allDiscrepancies: DiscrepancyRecord[] = [];
  const byType: Record<string, number> = {};

  const runChecks = options?.checks ?? 'all';

  const shouldRun = (type: DiscrepancyType) =>
    runChecks === 'all' || (Array.isArray(runChecks) && runChecks.includes(type));

  // Get total employees count for summary
  const { count: totalEmployees } = await supabaseService
    .from('employees_master')
    .select('id', { count: 'exact', head: true });

  const checks: Array<{ type: DiscrepancyType; fn: () => Promise<DiscrepancyRecord[]> }> = [
    { type: 'active_no_insurance_number', fn: checkActiveMissingInsurance },
    { type: 'missing_national_id', fn: checkMissingNationalId },
    { type: 'missing_phone', fn: checkMissingPhone },
    { type: 'missing_hire_date', fn: checkMissingHireDate },
    { type: 'national_id_multiple_codes', fn: checkNationalIdMultipleCodes },
    { type: 'insurance_number_multiple_employees', fn: checkInsuranceNumberDuplicate },
    { type: 'active_in_db_resigned_in_res', fn: checkActiveResignedConflict },
    { type: 'job_title_mismatch_insurance', fn: checkJobTitleMismatch },
    { type: 'in_insurance_not_in_db', fn: checkInInsuranceNotInMaster },
  ];

  for (const check of checks) {
    if (!shouldRun(check.type)) continue;
    try {
      const results = await check.fn();
      allDiscrepancies.push(...results);
      byType[check.type] = results.length;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${check.type}: ${msg}`);
      byType[check.type] = 0;
    }
  }

  // Upsert all discovered discrepancies
  let newDiscrepancies = 0;
  try {
    newDiscrepancies = await upsertDiscrepancies(allDiscrepancies);
  } catch (err) {
    errors.push(`upsert failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  const duration_ms = Date.now() - startTime;

  const bySeverity = {
    critical: allDiscrepancies.filter((d) => d.severity === 'critical').length,
    warning: allDiscrepancies.filter((d) => d.severity === 'warning').length,
    info: allDiscrepancies.filter((d) => d.severity === 'info').length,
  };

  // Log the run
  const { data: runLog } = await supabaseService
    .from('quality_run_log')
    .insert({
      run_type: 'full',
      triggered_by: options?.triggered_by ?? 'manual',
      total_employees_checked: totalEmployees ?? 0,
      discrepancies_found: allDiscrepancies.length,
      new_discrepancies: newDiscrepancies,
      discrepancies_resolved: 0,
      duration_ms,
      error_message: errors.length > 0 ? errors.join('; ') : null,
    })
    .select('id')
    .maybeSingle();

  return {
    success: errors.length === 0,
    run_id: runLog?.id ?? '',
    duration_ms,
    total_employees_checked: totalEmployees ?? 0,
    discrepancies_found: allDiscrepancies.length,
    new_discrepancies: newDiscrepancies,
    by_type: byType,
    by_severity: bySeverity,
    errors,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// GET STATS: for the Dashboard / Data Quality page
// ═══════════════════════════════════════════════════════════════════════════

export async function getDiscrepancyStats(): Promise<DiscrepancyStats> {
  const [countResult, byTypeResult, lastRunResult] = await Promise.all([
    supabaseService
      .from('data_discrepancies')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'open'),

    supabaseService
      .from('data_discrepancies')
      .select('discrepancy_type, severity')
      .eq('status', 'open'),

    supabaseService
      .from('quality_run_log')
      .select('created_at')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  // Group by type
  const typeMap = new Map<string, { count: number; severity: string }>();
  for (const row of byTypeResult.data || []) {
    const key = row.discrepancy_type;
    const entry = typeMap.get(key) ?? { count: 0, severity: row.severity };
    entry.count += 1;
    // Keep the highest severity
    if (row.severity === 'critical') entry.severity = 'critical';
    else if (row.severity === 'warning' && entry.severity !== 'critical') entry.severity = 'warning';
    typeMap.set(key, entry);
  }

  const byType = Array.from(typeMap.entries())
    .map(([discrepancy_type, { count, severity }]) => ({ discrepancy_type, count, severity }))
    .sort((a, b) => b.count - a.count);

  const allRows = byTypeResult.data || [];
  const bySeverity = {
    critical: allRows.filter((r) => r.severity === 'critical').length,
    warning: allRows.filter((r) => r.severity === 'warning').length,
    info: allRows.filter((r) => r.severity === 'info').length,
  };

  return {
    total_open: countResult.count ?? 0,
    by_type: byType,
    by_severity: bySeverity,
    last_run_at: lastRunResult.data?.created_at ?? null,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// GET DISCREPANCIES: paginated list for the UI
// ═══════════════════════════════════════════════════════════════════════════

export async function getDiscrepancies(options?: {
  type?: DiscrepancyType;
  severity?: DiscrepancySeverity;
  status?: string;
  company_account?: string;
  limit?: number;
  offset?: number;
}) {
  let query = supabaseService
    .from('data_discrepancies')
    .select(`
      id, discrepancy_type, severity, status,
      source_a, source_b, field_name, value_a, value_b,
      description, first_detected_at, last_checked_at,
      employee_id, raw_employee_code, raw_national_id, raw_employee_name,
      employees_master ( employee_code, employee_name, company_account, current_status )
    `)
    .order('severity', { ascending: true })  // critical first
    .order('first_detected_at', { ascending: false });

  if (options?.type) query = query.eq('discrepancy_type', options.type);
  if (options?.severity) query = query.eq('severity', options.severity);
  if (options?.status) query = query.eq('status', options.status);
  else query = query.eq('status', 'open');

  if (options?.limit) query = query.limit(options.limit);
  if (options?.offset) query = query.range(options.offset, (options.offset + (options.limit ?? 50)) - 1);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}

// ═══════════════════════════════════════════════════════════════════════════
// RESOLVE: mark a discrepancy as resolved/ignored
// ═══════════════════════════════════════════════════════════════════════════

export async function resolveDiscrepancy(
  id: string,
  action: 'resolved' | 'ignored' | 'false_positive',
  notes?: string
) {
  const { error } = await supabaseService
    .from('data_discrepancies')
    .update({
      status: action,
      resolved_at: new Date().toISOString(),
      resolution_notes: notes ?? null,
    })
    .eq('id', id);

  if (error) throw new Error(error.message);
}
