/**
 * Smart Import Service
 * Purpose: Intelligently import multi-sheet Excel files with automatic matching and update logic
 */

import { supabaseServer } from './supabaseServer';
import * as XLSX from 'xlsx';
import { invalidateReportsCache } from './reportsEngine';
import type { Json, Database } from '@/types/supabase';

// Type aliases for clarity
type IncomingInsertRow = Database['public']['Tables']['incoming_insurance_records']['Insert'];
type ResignationInsertRow = Database['public']['Tables']['resignation_records']['Insert'];
type PayrollInsertRow = Database['public']['Tables']['monthly_payroll_records']['Insert'];
type InsuranceInsertRow = Database['public']['Tables']['monthly_insurance_records']['Insert'];
type EmployeeMasterInsert = Database['public']['Tables']['employees_master']['Insert'];
type EmployeeHistoryInsert = Database['public']['Tables']['employee_history']['Insert'];
type SheetDataInsert = Database['public']['Tables']['sheet_data']['Insert'];

// Lightweight type for in-memory employee lookup (from partial .select())
interface EmployeeLookup {
  id: string;
  company_account: string;
  employee_code: string | null;
  national_id: string | null;
  employee_name: string;
  consolidated_data: Json;
  [key: string]: unknown; // allow extra fields from new inserts
}

/** Safely cast any JS value to Supabase Json (all rowData is serializable) */
function toJson(value: unknown): Json {
  return value as Json;
}

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface SheetDefinition {
  id: string;
  sheet_name: string;
  display_name: string;
  column_definitions: ColumnDefinition[];
  matching_keys: string[];
  primary_key_field: string | null;
  update_strategy: 'merge' | 'replace' | 'append';
}

export interface ColumnDefinition {
  key: string;
  label: string;
  type: string;
  aliases: string[];
}

export interface ImportedRow {
  row_data: Record<string, unknown>;
  row_number: number;
  row_code: string | null;
  row_national_id: string | null;
  row_name: string | null;
}

export interface MatchResult {
  matched: boolean;
  employee_id: string | null;
  match_type: 'code' | 'national_id' | 'insurance_number' | 'name' | 'new';
  confidence: number;
}

export interface ImportResult {
  success: boolean;
  total_rows: number;
  new_employees: number;
  updated_employees: number;
  skipped_rows: number;
  errors: string[];
  import_id: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS & DATA CLEANERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Clean and normalize National ID, handling scientific notation (e.g. 2.9603E+13)
 */
export function cleanNationalId(val: unknown): string | null {
  if (val === null || val === undefined || val === '') return null;
  let str = '';
  if (typeof val === 'number') {
    str = BigInt(Math.round(val)).toString();
  } else {
    str = String(val).trim();
    if (/^[+-]?\d+(\.\d+)?[eE][+-]?\d+$/.test(str)) {
      try {
        const num = Number(str);
        if (!isNaN(num)) {
          str = BigInt(Math.round(num)).toString();
        }
      } catch { /* noop */ }
    }
  }
  const digits = str.replace(/\D/g, '').trim();
  return digits.length >= 7 ? digits : null;
}

/**
 * Clean employee code, preventing scientific notation and stripping unwanted symbols
 */
export function cleanCode(val: unknown): string | null {
  if (val === null || val === undefined || val === '') return null;
  let str = '';
  if (typeof val === 'number') {
    str = Math.round(val).toString();
  } else {
    str = String(val).trim();
    if (/^[+-]?\d+(\.\d+)?[eE][+-]?\d+$/.test(str)) {
      try {
        const num = Number(str);
        if (!isNaN(num)) {
          str = Math.round(num).toString();
        }
      } catch { /* noop */ }
    }
  }
  const cleaned = str.replace(/[^\w-]/g, '').trim();
  return cleaned || null;
}

/**
 * Clean Egyptian phone number, handling scientific notation and leading zero
 */
export function cleanPhoneNumber(val: unknown): string | null {
  if (val === null || val === undefined || val === '') return null;
  let str = '';
  if (typeof val === 'number') {
    str = BigInt(Math.round(val)).toString();
  } else {
    str = String(val).trim();
    if (/^[+-]?\d+(\.\d+)?[eE][+-]?\d+$/.test(str)) {
      try {
        const num = Number(str);
        if (!isNaN(num)) {
          str = BigInt(Math.round(num)).toString();
        }
      } catch { /* noop */ }
    }
  }
  const digits = str.replace(/\D/g, '').trim();
  if (!digits) return null;
  if (digits.length === 10 && /^(10|11|12|15)/.test(digits)) {
    return '0' + digits;
  }
  return digits;
}

/**
 * Normalize text for comparison (remove diacritics, extra spaces, etc.)
 */
function normalizeText(text: string): string {
  return text
    .trim()
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/**
 * Auto-map Excel columns to expected fields with exact column indices
 */
function autoMapColumns(
  rawHeaders: string[],
  columnDefinitions: ColumnDefinition[],
  sheetName?: string
): Record<string, number> {
  const mapping: Record<string, number> = {};
  const serialAliases = ['#', 'م', 'مسلسل', 'seq', 'بلب', 'م.', 'serial'];

  // Special heuristic for Medical:
  // In Medical, column 0 has no header but contains employee_code (e.g. 31003), and column 1 is الاسم
  if (sheetName && (normalizeText(sheetName).includes('medical') || normalizeText(sheetName).includes('كشف'))) {
    if (!rawHeaders[0] || serialAliases.map(normalizeText).includes(normalizeText(rawHeaders[0]))) {
      const col1Norm = normalizeText(rawHeaders[1] || '');
      if (col1Norm.includes('اسم') || col1Norm.includes('قوم')) {
        mapping['employee_code'] = 0;
      }
    }
  }

  for (let idx = 0; idx < rawHeaders.length; idx++) {
    const rawH = rawHeaders[idx];
    if (!rawH) continue;
    const normH = normalizeText(rawH);

    for (const colDef of columnDefinitions) {
      if (mapping[colDef.key] !== undefined) continue;

      // Never map serial columns to employee_code
      if (colDef.key === 'employee_code' && serialAliases.map(normalizeText).includes(normH)) {
        continue;
      }

      const normalizedAliases = colDef.aliases.map((a) => normalizeText(a));
      if (normalizedAliases.includes(normH) || normalizeText(colDef.label) === normH) {
        mapping[colDef.key] = idx;
        break;
      }
    }
  }

  return mapping;
}

/**
 * Format cell value based on type and column key
 */
function formatCellValue(value: unknown, type: string, key?: string): unknown {
  if (value === null || value === undefined || value === '') return null;

  if (key === 'national_id' || key?.includes('قومي') || key?.includes('قومى')) {
    return cleanNationalId(value);
  }
  if (key === 'employee_code' || key?.includes('كود')) {
    return cleanCode(value);
  }
  if (key === 'phone_number' || key?.includes('هاتف') || key?.includes('تليفون')) {
    return cleanPhoneNumber(value);
  }

  switch (type) {
    case 'text': {
      if (typeof value === 'number') {
        if (Number.isInteger(value) && Math.abs(value) > 1e9) {
          return BigInt(Math.round(value)).toString();
        }
      }
      const str = String(value).trim();
      if (/^[+-]?\d+(\.\d+)?[eE][+-]?\d+$/.test(str)) {
        try {
          const num = Number(str);
          if (!isNaN(num)) {
            return BigInt(Math.round(num)).toString();
          }
        } catch { /* noop */ }
      }
      return str;
    }
    case 'number':
      return typeof value === 'number' ? value : parseFloat(String(value));
    case 'currency': {
      const numStr = String(value).replace(/[£$,\s\u062C.\u0645]/g, '');
      return parseFloat(numStr) || null;
    }
    case 'date':
      if (value instanceof Date) {
        return value.toISOString().split('T')[0];
      }
      return String(value);
    default:
      return value;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MATCHING ENGINE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Find matching employee in employees_master table
 */
export async function findMatchingEmployee(
  companyAccount: string,
  rowData: ImportedRow
): Promise<MatchResult> {
  const { row_code, row_national_id, row_name } = rowData;
  const innerData = (rowData.row_data || {}) as Record<string, unknown>;
  const rawInsuranceNumber = (innerData.insurance_number as string) ||
    (innerData['الرقم التاميني'] as string) ||
    (innerData['الرقم التأميني'] as string) ||
    (innerData['الرقم التامينى'] as string) ||
    (innerData['الرقم التأمينى'] as string) || null;
  const cleanInsNo = rawInsuranceNumber ? String(rawInsuranceNumber).trim() : null;

  // Priority 1: Match by national_id (Global Sovereign Unique ID - 14 digits)
  if (row_national_id && row_national_id.length === 14) {
    const { data: byNationalId } = await supabaseServer
      .from('employees_master')
      .select('id, company_account, employee_code')
      .eq('national_id', row_national_id)
      .maybeSingle();

    if (byNationalId) {
      return {
        matched: true,
        employee_id: byNationalId.id,
        match_type: 'national_id',
        confidence: 100,
      };
    }
  }

  // Priority 2: Match by insurance_number (State insurance unique ID)
  if (cleanInsNo && cleanInsNo.length >= 7) {
    const { data: byIns } = await supabaseServer
      .from('employees_master')
      .select('id, company_account, employee_code')
      .eq('insurance_number', cleanInsNo)
      .limit(2);

    if (byIns && byIns.length === 1) {
      return {
        matched: true,
        employee_id: byIns[0].id,
        match_type: 'insurance_number',
        confidence: 95,
      };
    }
  }

  // Priority 3: Match by employee_code (Universal Employee Code across accounts)
  if (row_code) {
    const { data: byCodeList } = await supabaseServer
      .from('employees_master')
      .select('id, company_account, employee_code, employee_name')
      .eq('employee_code', row_code)
      .limit(5);

    if (byCodeList && byCodeList.length === 1) {
      return {
        matched: true,
        employee_id: byCodeList[0].id,
        match_type: 'code',
        confidence: 92,
      };
    } else if (byCodeList && byCodeList.length > 1) {
      const sameAcc = byCodeList.find(e => e.company_account.toLowerCase() === companyAccount.toLowerCase());
      if (sameAcc) {
        return {
          matched: true,
          employee_id: sameAcc.id,
          match_type: 'code',
          confidence: 90,
        };
      }
    }
  }

  // Priority 4: Match by normalized name
  if (row_name) {
    const normalizedInputName = normalizeText(row_name);
    const { data: byName } = await supabaseServer
      .from('employees_master')
      .select('id, employee_name')
      .ilike('employee_name', `%${normalizedInputName.slice(0, 6)}%`)
      .limit(20);

    if (byName) {
      for (const emp of byName) {
        const normalizedDbName = normalizeText(emp.employee_name);
        if (normalizedDbName === normalizedInputName) {
          return {
            matched: true,
            employee_id: emp.id,
            match_type: 'name',
            confidence: 70,
          };
        }
      }
    }
  }

  // No match found - this is a new employee
  return {
    matched: false,
    employee_id: null,
    match_type: 'new',
    confidence: 0,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// UPDATE / INSERT LOGIC
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create or update employee in employees_master
 */
export async function upsertEmployee(
  companyAccount: string,
  rowData: ImportedRow,
  matchResult: MatchResult,
  importId: string
): Promise<{ success: boolean; employee_id: string; action: 'created' | 'updated' }> {
  const { row_data, row_code, row_national_id, row_name } = rowData;

  if (matchResult.matched && matchResult.employee_id) {
    // UPDATE existing employee
    const { data: existingEmp } = await supabaseServer
      .from('employees_master')
      .select('*')
      .eq('id', matchResult.employee_id)
      .single();

    if (!existingEmp) {
      throw new Error(`Employee ${matchResult.employee_id} not found`);
    }

    // Merge consolidated_data
    const oldConsolidatedData = (existingEmp.consolidated_data as Record<string, unknown>) || {};
    const newConsolidatedData = {
      ...oldConsolidatedData,
      ...row_data,
    };

    // Track changed fields
    const changedFields: string[] = [];
    const oldValues: Record<string, unknown> = {};
    const newValues: Record<string, unknown> = {};

    // Check for account transfer
    if (existingEmp.company_account !== companyAccount) {
      changedFields.push('company_account');
      oldValues.company_account = existingEmp.company_account;
      newValues.company_account = companyAccount;
    }

    // Check for code change
    if (row_code && existingEmp.employee_code !== row_code) {
      changedFields.push('employee_code');
      oldValues.employee_code = existingEmp.employee_code;
      newValues.employee_code = row_code;
    }

    // Update employee
    const { error: updateError } = await supabaseServer
      .from('employees_master')
      .update({
        company_account: companyAccount,
        employee_code: row_code || existingEmp.employee_code,
        national_id: row_national_id || existingEmp.national_id,
        employee_name: row_name || existingEmp.employee_name,
        consolidated_data: toJson(newConsolidatedData),
        last_updated_at: new Date().toISOString(),
        last_import_id: importId,
      })
      .eq('id', matchResult.employee_id);

    if (updateError) throw updateError;

    // Log changes to employee_history
    if (changedFields.length > 0) {
      await supabaseServer.from('employee_history').insert({
        employee_id: matchResult.employee_id,
        change_type: changedFields.includes('company_account') ? 'account_transfer' : 'data_update',
        from_company_account: oldValues.company_account as string | undefined,
        to_company_account: newValues.company_account as string | undefined,
        from_employee_code: oldValues.employee_code as string | undefined,
        to_employee_code: newValues.employee_code as string | undefined,
        changed_fields: changedFields,
        old_values: toJson(oldValues),
        new_values: toJson(newValues),
        import_id: importId,
      });
    }

    return {
      success: true,
      employee_id: matchResult.employee_id,
      action: 'updated',
    };
  } else {
    // INSERT new employee
    const { data: newEmp, error: insertError } = await supabaseServer
      .from('employees_master')
      .insert({
        company_account: companyAccount,
        employee_code: row_code,
        national_id: row_national_id,
        employee_name: row_name || 'بدون اسم',
        current_status: (row_data.status as string) || (row_data.الحاله as string) || 'Active',
        current_job_title: (row_data.job_title as string) || (row_data.الوظيفه as string) || null,
        current_region: (row_data.region as string) || (row_data.المنطقه as string) || null,
        current_department: (row_data.department as string) || (row_data.الاداره as string) || null,
        consolidated_data: toJson(row_data),
        last_import_id: importId,
      })
      .select('id')
      .single();

    if (insertError) throw insertError;

    // Log to history
    await supabaseServer.from('employee_history').insert({
      employee_id: newEmp.id,
      change_type: 'initial_import',
      to_company_account: companyAccount,
      to_employee_code: row_code,
      new_values: toJson(row_data),
      import_id: importId,
    });

    return {
      success: true,
      employee_id: newEmp.id,
      action: 'created',
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN IMPORT FUNCTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Import a single sheet from Excel file
 */
export async function importSheet(
  companyAccount: string,
  sheetName: string,
  workbook: XLSX.WorkBook,
  importLogId: string
): Promise<ImportResult> {
  const errors: string[] = [];
  let newEmployees = 0;
  let updatedEmployees = 0;
  let skippedRows = 0;

  try {
    // 1. Get sheet definition from database (flexible matching for spaces and dots)
    const { data: allActiveSheets } = await supabaseServer
      .from('dynamic_sheets')
      .select('*')
      .eq('is_active', true);

    const sheetDef = allActiveSheets?.find(
      (s) =>
        s.sheet_name === sheetName ||
        normalizeText(s.sheet_name) === normalizeText(sheetName) ||
        normalizeText(s.sheet_name).replace(/[\s.]/g, '') === normalizeText(sheetName).replace(/[\s.]/g, '')
    ) || null;

    // 2. Read sheet from workbook
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) {
      return {
        success: false,
        total_rows: 0,
        new_employees: 0,
        updated_employees: 0,
        skipped_rows: 0,
        errors: [`Sheet "${sheetName}" not found in Excel file`],
        import_id: importLogId,
      };
    }

    // 3. Parse sheet data
    const rawData = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
      header: 1,
      defval: '',
      blankrows: false,
    });

    if (rawData.length === 0) {
      return {
        success: true,
        total_rows: 0,
        new_employees: 0,
        updated_employees: 0,
        skipped_rows: 0,
        errors: [`Sheet "${sheetName}" is empty`],
        import_id: importLogId,
      };
    }

    // Smart header row finder: scan first 15 rows to find the row with the most column headers
    let headerRowIndex = 0;
    let maxHeaderScore = 0;
    const headerKeywords = [
      'كود', 'code', 'اسم', 'name', 'قومي', 'قومى', 'national', 'وظيفة', 'job',
      'تاريخ', 'date', 'تأمين', 'مرتب', 'salary', 'إدارة', 'ادارة', 'منطقة', 'منطقه', 'حالة', 'حاله'
    ];

    for (let r = 0; r < Math.min(15, rawData.length); r++) {
      const row = (rawData[r] as unknown[] || []).map((c) => String(c || '').trim().toLowerCase());
      const nonEmptyCells = row.filter(Boolean);
      const matchedKeywords = nonEmptyCells.filter((cell) =>
        headerKeywords.some((kw) => cell.includes(kw))
      ).length;

      // Score based on keyword matches and column count
      const score = matchedKeywords * 3 + nonEmptyCells.length;
      if (score > maxHeaderScore && nonEmptyCells.length >= 2) {
        maxHeaderScore = score;
        headerRowIndex = r;
      }
    }

    const rawHeaders = (rawData[headerRowIndex] as unknown[] || []).map((h) => String(h || '').trim());
    const dataRows = rawData.slice(headerRowIndex + 1);

    // 4. Auto-map columns (use definition if available, else smart guess)
    let columnDefs: ColumnDefinition[];
    let mapping: Record<string, number>;
    let currentSheetId = sheetDef?.id;

    if (sheetDef && sheetDef.column_definitions) {
      // Use registered column definitions
      columnDefs = sheetDef.column_definitions as unknown as ColumnDefinition[];
      mapping = autoMapColumns(rawHeaders, columnDefs, sheetName);
    } else {
      // Auto-detect columns for unregistered sheets
      const nonBlankHeaders = rawHeaders.filter(Boolean);
      columnDefs = nonBlankHeaders.map((header) => ({
        key: header,
        label: header,
        type: 'text',
        aliases: [header],
      }));
      mapping = {};
      rawHeaders.forEach((h, idx) => {
        if (h) mapping[h] = idx;
      });

      // Auto-register this sheet for future use
      const { data: upsertedSheet } = await supabaseServer.from('dynamic_sheets').upsert({
        sheet_name: sheetName,
        display_name: sheetName,
        description: `ورقة "${sheetName}" - تم التسجيل التلقائي`,
        column_definitions: toJson(columnDefs),
        matching_keys: ['employee_code', 'national_id', 'employee_name'],
        primary_key_field: 'employee_code',
        is_active: true,
        is_master_source: false,
        update_strategy: 'merge',
        total_columns: nonBlankHeaders.length,
      }, {
        onConflict: 'sheet_name',
      }).select('id').maybeSingle();

      if (upsertedSheet) {
        currentSheetId = upsertedSheet.id;
      }
    }

    // 5. Pre-load existing employees into memory for high-speed matching (1 single query instead of thousands)
    const { data: existingEmps } = await supabaseServer
      .from('employees_master')
      .select('id, company_account, employee_code, national_id, employee_name, insurance_number, consolidated_data');

    const byNatIdMap = new Map<string, EmployeeLookup>();
    const byInsNoMap = new Map<string, EmployeeLookup>();
    const byCodeMap = new Map<string, EmployeeLookup>();
    const byCodeAccountMap = new Map<string, EmployeeLookup>();
    const byNormNameMap = new Map<string, EmployeeLookup>();

    for (const emp of (existingEmps || []) as EmployeeLookup[]) {
      if (emp.national_id && String(emp.national_id).trim().length === 14) {
        byNatIdMap.set(String(emp.national_id).trim(), emp);
      }
      if (emp.insurance_number && String(emp.insurance_number).trim()) {
        byInsNoMap.set(String(emp.insurance_number).trim(), emp);
      }
      if (emp.employee_code && String(emp.employee_code).trim()) {
        const c = String(emp.employee_code).trim();
        // Global code map (first one wins for universal lookup)
        if (!byCodeMap.has(c)) {
          byCodeMap.set(c, emp);
        }
        if (emp.company_account) {
          byCodeAccountMap.set(`${emp.company_account.toLowerCase()}:${c}`, emp);
        }
      }
      if (emp.employee_name) {
        const normN = normalizeText(emp.employee_name);
        if (!byNormNameMap.has(normN)) {
          byNormNameMap.set(normN, emp);
        }
      }
    }

    const normSheet = normalizeText(sheetName).replace(/[\s.]/g, '');
    const isIncomingSheet = normSheet.includes('وارد') || normSheet.includes('ارقاموارد') || normSheet === 'socialinsurance';
    const isResignationSheet = normSheet.includes('res') || normSheet.includes('استقال');
    const isMonthlyWorkSheet = normSheet.includes('شغلتامينات') || normSheet.includes('مرتبات') || normSheet.includes('رواتب') || normSheet.includes('payroll') || normSheet.includes('اجور');

    const incomingBatch: IncomingInsertRow[] = [];
    const resignationBatch: ResignationInsertRow[] = [];
    const payrollBatch: PayrollInsertRow[] = [];
    const insuranceBatch: InsuranceInsertRow[] = [];

    const employeesToInsert: EmployeeMasterInsert[] = [];
    const employeesToUpdate: { id: string; data: Partial<EmployeeMasterInsert> }[] = [];
    const historyToInsert: EmployeeHistoryInsert[] = [];
    const sheetDataToInsert: SheetDataInsert[] = [];

    // Process each row in memory (ultra-fast: ~15ms for 3,000 rows)
    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i] as unknown[];
      const rowNumber = headerRowIndex + i + 2; // Excel row number

      try {
        // Build row data object using direct indices
        const rowData: Record<string, unknown> = {};
        for (const colDef of columnDefs) {
          const colIndex = mapping[colDef.key];
          if (colIndex !== undefined && colIndex >= 0 && colIndex < row.length) {
            const rawValue = row[colIndex];
            rowData[colDef.key] = formatCellValue(rawValue, colDef.type, colDef.key);
          }
        }

        // Auto-Shift Detection & Correction Heuristic:
        if (
          rowData.national_id &&
          /[\u0600-\u06FF]/.test(String(rowData.national_id)) &&
          rowData.job_title &&
          /^[23]\d{13}$/.test(String(rowData.job_title).trim())
        ) {
          const shiftedCode = String(rowData.employee_name || '').trim();
          const shiftedName = String(rowData.national_id || '').trim();
          const shiftedNationalId = String(rowData.job_title || '').trim();
          const shiftedJobTitle = String(rowData.region || '').trim();
          const shiftedRegion = String(rowData.department || '').trim();
          const shiftedDepartment = String(rowData.hire_date || '').trim();

          rowData.employee_code = shiftedCode;
          rowData.employee_name = shiftedName;
          rowData.national_id = shiftedNationalId;
          rowData.job_title = shiftedJobTitle;
          rowData.region = shiftedRegion;
          rowData.department = shiftedDepartment;
        }

        const rawCode = cleanCode(
          rowData.employee_code ||
          rowData['الكود'] ||
          rowData['كود'] ||
          rowData['كود الموظف'] ||
          rowData['رقم الموظف']
        );

        const rawNatId = cleanNationalId(
          rowData.national_id ||
          rowData['الرقم القومي'] ||
          rowData['الرقم القومى'] ||
          rowData['رقم قومي'] ||
          rowData['رقم قومى'] ||
          rowData['بطاقة']
        );

        const rawName = (
          rowData.employee_name ||
          rowData['الاسم'] ||
          rowData['اسم الموظف'] ||
          rowData['اسم']
        ) ? String(
          rowData.employee_name ||
          rowData['الاسم'] ||
          rowData['اسم الموظف'] ||
          rowData['اسم']
        ).trim() : null;

        // Skip completely empty rows
        if (!rawCode && !rawNatId && !rawName) {
          skippedRows++;
          continue;
        }

        // ── Phase 1 Bridge Collection (Unifying the Two Worlds) ──
        if (isIncomingSheet) {
          incomingBatch.push({
            import_id: importLogId,
            employee_code: rawCode,
            employee_name: rawName,
            national_id: rawNatId,
            job_title: (rowData.job_title as string) || (rowData['الوظيفه'] as string) || (rowData['الوظيفة'] as string) || null,
            status: (rowData.status as string) || (rowData['الحاله'] as string) || (rowData['الحالة'] as string) || 'Active',
            company_account: (rowData.company_account as string) || (rowData['الشركه'] as string) || (rowData['الشركة'] as string) || companyAccount,
            insurance_number: (rowData.insurance_number as string) || (rowData['الرقم التاميني'] as string) || (rowData['الرقم التأميني'] as string) || (rowData['الرقم التامينى'] as string) || (rowData['الرقم التأمينى'] as string) || null,
            insurance_status: (rowData.insurance_status as string) || (rowData['الحاله التامينية'] as string) || (rowData['الحالة التأمينية'] as string) || (rowData['الحاله التامينيه'] as string) || (rowData['الحالة التأمينية'] as string) || null,
            termination_reason: (rowData.termination_reason as string) || (rowData['سبب الانتهاء'] as string) || null,
            form_type: (rowData.form_type as string) || (rowData['نوع الاستماره'] as string) || (rowData['نوع الاستمارة'] as string) || null,
            insurance_job_title: (rowData.insurance_job_title as string) || (rowData['الوظيفه في التامينات'] as string) || null,
            subscription_start_date: (rowData.subscription_start_date as string) || (rowData['تاريخ بدايه الاشتراك'] as string) || null,
            subscription_end_date: (rowData.subscription_end_date as string) || (rowData['تاريخ نهاية الاشتراك'] as string) || null,
            supply_method: (rowData.supply_method as string) || (rowData['طريقه التوريد'] as string) || null,
            crm_number: (rowData.crm_number as string) || (rowData['رقم ال CRM'] as string) || null,
            record_date: (rowData.record_date as string) || (rowData['التاريخ'] as string) || null,
            note: (rowData.note as string) || (rowData['NOTE'] as string) || null,
            raw_data: toJson(rowData),
          });
        } else if (isResignationSheet) {
          resignationBatch.push({
            import_id: importLogId,
            employee_code: rawCode,
            employee_name: rawName,
            national_id: rawNatId,
            resignation_date: (rowData.resignation_date as string) || (rowData['تاريخ الاستقاله'] as string) || (rowData['تاريخ الاستقالة'] as string) || null,
            last_working_day: (rowData.last_working_day as string) || (rowData['اخر يوم عمل'] as string) || (rowData['آخر يوم عمل'] as string) || null,
            resignation_type: (rowData.resignation_type as string) || (rowData['نوع الاستقاله'] as string) || (rowData['نوع الاستقالة'] as string) || null,
            insurance_supply_type: (rowData.insurance_supply_type as string) || (rowData['نوع توريد تامينات'] as string) || null,
            supply_date: (rowData.supply_date as string) || (rowData['تاريخ التوريد'] as string) || null,
            raw_data: toJson(rowData),
          });
        } else if (isMonthlyWorkSheet) {
          const totalWage = rowData['الاجر الشامل'] ?? rowData['الاجر الشامل '] ?? rowData['الراتب'] ?? rowData['اجمالي المستحق'];
          const insWage = rowData['الاجر التامينى'] ?? rowData['الاجر التاميني'] ?? rowData['الاجر التأميني'];
          const insNum = rowData.insurance_number || rowData['الرقم التاميني'] || rowData['الرقم التأميني'];

          // Dynamically scan for all 12 months in this sheet
          const monthEntries: Array<{ m: number; days: unknown; wage?: unknown }> = [];
          for (let m = 1; m <= 12; m++) {
            const days = rowData[`شهر ${m}`] ?? rowData[`شهر${m}`] ?? rowData[`M${m}`] ?? rowData[`شهر_${m}`];
            const specificWage = rowData[`راتب شهر ${m}`] ?? rowData[`مرتب شهر ${m}`] ?? rowData[`راتب_${m}`];
            if (days !== null && days !== undefined && String(days).trim() !== '' && String(days).trim() !== '0') {
              monthEntries.push({ m, days, wage: specificWage || totalWage });
            }
          }

          for (const item of monthEntries) {
            payrollBatch.push({
              import_id: importLogId,
              period_year: 2026,
              period_month: item.m,
              employee_code: rawCode,
              national_id: rawNatId,
              employee_name: rawName,
              attendance_days: String(item.days).trim(),
              job_title: (rowData.job_title as string) || (rowData['الوظيفه'] as string) || (rowData['الوظيفة'] as string) || null,
              raw_data: toJson({ ...rowData, wage: item.wage || totalWage, month: item.m }),
            });
            if (insNum || insWage) {
              insuranceBatch.push({
                import_id: importLogId,
                period_year: 2026,
                period_month: item.m,
                employee_code: rawCode,
                employee_name: rawName,
                national_id: rawNatId,
                insurance_number: insNum ? String(insNum).trim() : null,
                job_title: (rowData.insurance_job_title as string) || (rowData['الوظيفه في التامينات'] as string) || null,
                raw_data: toJson({ ...rowData, ins_wage: insWage, month: item.m }),
              });
            }
          }
        }

        // Extract insurance number early for matching Priority 2
        const rawInsNumber = cleanCode(
          rowData.insurance_number ||
          rowData['الرقم التاميني'] ||
          rowData['الرقم التأميني'] ||
          rowData['الرقم التامينى'] ||
          rowData['الرقم التأمينى']
        );

        // Fast in-memory hierarchical matching
        let matchedEmp: EmployeeLookup | null = null;

        // Priority 1: Match by national_id (Sovereign Global Unique ID - 14 digits)
        if (rawNatId && rawNatId.length === 14) {
          const found = byNatIdMap.get(rawNatId);
          if (found) matchedEmp = found;
        }

        // Priority 2: Match by insurance_number (Unique State Insurance ID)
        if (!matchedEmp && rawInsNumber && rawInsNumber.length >= 7) {
          const found = byInsNoMap.get(rawInsNumber);
          if (found) matchedEmp = found;
        }

        // Priority 3: Match by employee_code (Universal Employee Code across accounts)
        if (!matchedEmp && rawCode) {
          const foundByAccount = byCodeAccountMap.get(`${companyAccount.toLowerCase()}:${rawCode}`);
          if (foundByAccount) {
            matchedEmp = foundByAccount;
          } else {
            const foundGlobal = byCodeMap.get(rawCode);
            if (foundGlobal) matchedEmp = foundGlobal;
          }
        }

        // Priority 4: Match by normalized name
        if (!matchedEmp && rawName) {
          const normN = normalizeText(rawName);
          const found = byNormNameMap.get(normN);
          if (found) matchedEmp = found;
        }

        if (matchedEmp) {
          // Existing employee
          updatedEmployees++;
          const oldConsolidated = (matchedEmp.consolidated_data as Record<string, unknown>) || {};
          const newConsolidated = { ...oldConsolidated, ...rowData };
          matchedEmp.consolidated_data = toJson(newConsolidated);

          // Extract all enriched fields for a complete employees_master update
          const rawInsuranceNumber = (rowData.insurance_number as string) || (rowData['\u0627\u0644\u0631\u0642\u0645 \u0627\u0644\u062a\u0627\u0645\u064a\u0646\u064a'] as string) || (rowData['\u0627\u0644\u0631\u0642\u0645 \u0627\u0644\u062a\u0627\u0645\u064a\u0646\u0649'] as string) || null;
          const rawInsuranceStatus = (rowData.insurance_status as string) || (rowData['\u0627\u0644\u062d\u0627\u0644\u0647 \u0627\u0644\u062a\u0627\u0645\u064a\u0646\u064a\u0647'] as string) || null;
          const rawInsuranceJobTitle = (rowData.insurance_job_title as string) || (rowData['\u0627\u0644\u0648\u0638\u064a\u0641\u0647 \u0641\u064a \u0627\u0644\u062a\u0627\u0645\u064a\u0646\u0627\u062a'] as string) || null;
          const rawInsuranceSalaryRaw = (rowData.insurance_salary as string) || (rowData['\u0627\u0644\u0627\u062c\u0631 \u0627\u0644\u062a\u0627\u0645\u064a\u0646\u0649'] as string) || null;
          const rawInsuranceSalary = rawInsuranceSalaryRaw ? parseFloat(String(rawInsuranceSalaryRaw).replace(/[^0-9.]/g, '')) || null : null;
          const rawInsuranceStartDate = (rowData.subscription_start_date as string) || (rowData['\u062a\u0627\u0631\u064a\u062e \u0628\u062f\u0627\u064a\u0647 \u0627\u0644\u0627\u0634\u062a\u0631\u0627\u0643'] as string) || null;
          const rawJobTitle = (rowData.job_title as string) || (rowData['\u0627\u0644\u0648\u0638\u064a\u0641\u0647'] as string) || (rowData['\u0627\u0644\u0648\u0638\u064a\u0641\u0629'] as string) || null;
          const rawRegion = (rowData.region as string) || (rowData['\u0627\u0644\u0645\u0646\u0637\u0642\u0647'] as string) || null;
          const rawDept = (rowData.department as string) || (rowData['\u0627\u0644\u0627\u062f\u0627\u0631\u0647'] as string) || null;
          const rawHireDate = (rowData.hire_date as string) || (rowData['\u062a\u0627\u0631\u064a\u062e \u0627\u0633\u062a\u0644\u0627\u0645 \u0627\u0644\u0639\u0645\u0644'] as string) || null;
          const rawPhone = (rowData.phone_number as string) || (rowData['\u0631\u0642\u0645 \u0627\u0644\u0647\u0627\u062a\u0641'] as string) || null;
          const rawAddress = (rowData.address as string) || (rowData['\u0627\u0644\u0639\u0646\u0648\u0627\u0646'] as string) || null;
          const rawEmpStatus = (rowData.status as string) || (rowData['\u0627\u0644\u062d\u0627\u0644\u0647'] as string) || null;

          employeesToUpdate.push({
            id: matchedEmp.id,
            data: {
              company_account: companyAccount,
              employee_code: rawCode || matchedEmp.employee_code,
              national_id: rawNatId || matchedEmp.national_id,
              employee_name: rawName || matchedEmp.employee_name,
              // Insurance fields — only overwrite when new data is non-empty
              ...(rawInsuranceNumber ? { insurance_number: rawInsuranceNumber } : {}),
              ...(rawInsuranceStatus ? { insurance_status: rawInsuranceStatus } : {}),
              ...(rawInsuranceJobTitle ? { insurance_job_title: rawInsuranceJobTitle } : {}),
              ...(rawInsuranceSalary ? { insurance_salary: rawInsuranceSalary } : {}),
              ...(rawInsuranceStartDate ? { insurance_start_date: rawInsuranceStartDate } : {}),
              // Employment fields — only overwrite when new data is non-empty
              ...(rawJobTitle ? { current_job_title: rawJobTitle } : {}),
              ...(rawRegion ? { current_region: rawRegion } : {}),
              ...(rawDept ? { current_department: rawDept } : {}),
              ...(rawHireDate ? { hire_date: rawHireDate } : {}),
              ...(rawPhone ? { phone_number: rawPhone } : {}),
              ...(rawAddress ? { address: rawAddress } : {}),
              ...(rawEmpStatus ? { current_status: rawEmpStatus } : {}),
              consolidated_data: toJson(newConsolidated),
              last_updated_at: new Date().toISOString(),
              last_import_id: importLogId,
            },
          });

          if (currentSheetId) {
            sheetDataToInsert.push({
              sheet_id: currentSheetId,
              employee_id: matchedEmp.id,
              row_data: toJson(rowData),
              row_code: rawCode,
              row_national_id: rawNatId,
              row_name: rawName,
              import_id: importLogId,
              row_number: rowNumber,
              is_latest: true,
            });
          }
        } else {
          // New employee
          newEmployees++;
          const newId = crypto.randomUUID();
            const newEmpRecord: EmployeeMasterInsert = {
              id: newId,
              company_account: companyAccount,
              employee_code: rawCode,
              national_id: rawNatId,
              employee_name: rawName || 'بدون اسم',
              current_status: (rowData.status as string) || (rowData['الحاله'] as string) || 'Active',
              current_job_title: (rowData.job_title as string) || (rowData['الوظيفه'] as string) || null,
              current_region: (rowData.region as string) || (rowData['المنطقه'] as string) || null,
              current_department: (rowData.department as string) || (rowData['الاداره'] as string) || null,
              insurance_number: (rowData.insurance_number as string) || (rowData['الرقم التاميني'] as string) || (rowData['الرقم التأميني'] as string) || (rowData['الرقم التامينى'] as string) || (rowData['الرقم التأمينى'] as string) || null,
              insurance_status: (rowData.insurance_status as string) || (rowData['الحاله التامينيه'] as string) || (rowData['الحالة التأمينية'] as string) || null,
              insurance_job_title: (rowData.insurance_job_title as string) || (rowData['الوظيفه في التامينات'] as string) || null,
              insurance_salary: (rowData.insurance_salary as number) || (rowData['الاجر التامينى'] ? parseFloat(String(rowData['الاجر التامينى']).replace(/[^0-9.]/g, '')) : null),
              insurance_start_date: (rowData.subscription_start_date as string) || (rowData['تاريخ بدايه الاشتراك'] as string) || null,
              hire_date: (rowData.hire_date as string) || (rowData['تاريخ استلام العمل'] as string) || null,
              phone_number: (rowData.phone_number as string) || (rowData['رقم الهاتف'] as string) || null,
              address: (rowData.address as string) || (rowData['العنوان'] as string) || null,
              consolidated_data: toJson(rowData),
              last_import_id: importLogId,
            };

            employeesToInsert.push(newEmpRecord);

            // Update memory index maps so subsequent rows in this file match immediately
            const lookupRecord = newEmpRecord as unknown as EmployeeLookup;
            if (rawNatId && rawNatId.length === 14) byNatIdMap.set(rawNatId, lookupRecord);
            if (newEmpRecord.insurance_number) byInsNoMap.set(String(newEmpRecord.insurance_number).trim(), lookupRecord);
            if (rawCode) {
              const c = String(rawCode).trim();
              if (!byCodeMap.has(c)) byCodeMap.set(c, lookupRecord);
              byCodeAccountMap.set(`${companyAccount.toLowerCase()}:${c}`, lookupRecord);
            }
            if (rawName) byNormNameMap.set(normalizeText(rawName), lookupRecord);

            historyToInsert.push({
              employee_id: newId,
              change_type: 'initial_import',
              to_company_account: companyAccount,
              to_employee_code: rawCode,
              new_values: toJson(rowData),
              import_id: importLogId,
            });

            if(currentSheetId) {
              sheetDataToInsert.push({
                sheet_id: currentSheetId,
                employee_id: newId,
                row_data: toJson(rowData),
                row_code: rawCode,
                row_national_id: rawNatId,
                row_name: rawName,
                import_id: importLogId,
                row_number: rowNumber,
                is_latest: true,
              });
            }
          }
        } catch (rowError) {
          const errorMsg = `Row ${rowNumber}: ${rowError instanceof Error ? rowError.message : 'Unknown error'}`;
          errors.push(errorMsg);
          skippedRows++;
        }
      }

    // 6. Execute high-speed batch operations in parallel chunks
    // A) Batch Insert New Employees (chunks of 150)
    for (let i = 0; i < employeesToInsert.length; i += 150) {
        const chunk = employeesToInsert.slice(i, i + 150);
        const { error } = await supabaseServer.from('employees_master').insert(chunk);
        if (error) errors.push(`Bulk insert error: ${error.message}`);
      }

      // B) Batch Update Existing Employees (parallel chunks of 20)
      for (let i = 0; i < employeesToUpdate.length; i += 20) {
        const chunk = employeesToUpdate.slice(i, i + 20);
        await Promise.all(
          chunk.map((item) =>
            supabaseServer.from('employees_master').update(item.data).eq('id', item.id)
          )
        );
      }

      // C) Batch Insert Sheet Data (chunks of 250)
      for (let i = 0; i < sheetDataToInsert.length; i += 250) {
        const chunk = sheetDataToInsert.slice(i, i + 250);
        const { error } = await supabaseServer.from('sheet_data').insert(chunk);
        if (error) errors.push(`Bulk sheet_data error: ${error.message}`);
      }

      // D) Batch Insert History (chunks of 250)
      for (let i = 0; i < historyToInsert.length; i += 250) {
        const chunk = historyToInsert.slice(i, i + 250);
        await supabaseServer.from('employee_history').insert(chunk);
      }

      // E) Phase 1 Bridge Batches (Bridging the Two Worlds):
      // Stamp account identity on monthly bridge rows with the same evidence
      // rule as the migration (exact national_id -> employees_master).
      // Unresolved rows keep account_id = null and land in quarantine.
      const bridgeNids = [...new Set([...payrollBatch, ...insuranceBatch].map((r) => r.national_id).filter(Boolean))] as string[];
      const accountByNid = new Map<string, number | null>();
      for (let i = 0; i < bridgeNids.length; i += 500) {
        const { data: masters } = await supabaseServer
          .from('employees_master')
          .select('national_id, account_id')
          .in('national_id', bridgeNids.slice(i, i + 500));
        (masters || []).forEach((m) => accountByNid.set(m.national_id as string, (m.account_id as number | null) ?? null));
      }
      payrollBatch.forEach((r) => { r.account_id = (r.national_id && accountByNid.get(r.national_id)) || null; });
      insuranceBatch.forEach((r) => { r.account_id = (r.national_id && accountByNid.get(r.national_id)) || null; });
      for (let i = 0; i < incomingBatch.length; i += 150) {
        const chunk = incomingBatch.slice(i, i + 150);
        // Upsert: update existing record if same employee in same company_account
        const { error } = await supabaseServer
          .from('incoming_insurance_records')
          .upsert(chunk, {
            onConflict: 'employee_code,company_account',
            ignoreDuplicates: false,
          });
        if (error) {
          // Fallback: plain insert if upsert fails (e.g. constraint not set up yet)
          const { error: insertErr } = await supabaseServer.from('incoming_insurance_records').insert(chunk);
          if (insertErr) console.error('Bridge incoming_insurance error:', insertErr.message);
        }
      }
      for (let i = 0; i < resignationBatch.length; i += 150) {
        const chunk = resignationBatch.slice(i, i + 150);
        const { error } = await supabaseServer.from('resignation_records').insert(chunk);
        if (error) console.error('Bridge resignation_records error:', error.message);
      }
      for (let i = 0; i < payrollBatch.length; i += 150) {
        const chunk = payrollBatch.slice(i, i + 150);
        const { error } = await supabaseServer.from('monthly_payroll_records').insert(chunk);
        if (error) console.error('Bridge monthly_payroll error:', error.message);
      }
      for (let i = 0; i < insuranceBatch.length; i += 150) {
        const chunk = insuranceBatch.slice(i, i + 150);
        const { error } = await supabaseServer.from('monthly_insurance_records').insert(chunk);
        if (error) console.error('Bridge monthly_insurance error:', error.message);
      }

      // 9. Update sheet statistics
      if (currentSheetId) {
        await supabaseServer
          .from('dynamic_sheets')
          .update({
            last_import_date: new Date().toISOString(),
            total_records_imported: (sheetDef?.total_records_imported || 0) + dataRows.length,
          })
          .eq('id', currentSheetId);
      }

      return {
        success: errors.length === 0,
        total_rows: dataRows.length,
        new_employees: newEmployees,
        updated_employees: updatedEmployees,
        skipped_rows: skippedRows,
        errors: errors,
        import_id: importLogId,
      };
    } catch (error) {
      return {
        success: false,
        total_rows: 0,
        new_employees: 0,
        updated_employees: 0,
        skipped_rows: 0,
        errors: [error instanceof Error ? error.message : 'Unknown error'],
        import_id: importLogId,
      };
    }
  }

/**
 * Import multiple sheets from Excel file
 */
export async function importMultiSheetExcel(
    companyAccount: string,
    workbook: XLSX.WorkBook,
    selectedSheets: string[],
    fileName: string
  ): Promise<Record<string, ImportResult>> {
    const results: Record<string, ImportResult> = {};

    // Create import log
    const { data: importLog, error: logError } = await supabaseServer
      .from('import_logs')
      .insert({
        source_type: 'multi_sheet_import',
        file_name: fileName,
        notes: `Multi-sheet import for ${companyAccount}: ${selectedSheets.join(', ')}`,
      })
      .select('id')
      .single();

    if (logError || !importLog) {
      throw new Error('Failed to create import log');
    }

    // Import each selected sheet
    for (const sheetName of selectedSheets) {
      results[sheetName] = await importSheet(companyAccount, sheetName, workbook, importLog.id);
    }

    // Update import log with summary
    const totalNew = Object.values(results).reduce((sum, r) => sum + r.new_employees, 0);
    const totalUpdated = Object.values(results).reduce((sum, r) => sum + r.updated_employees, 0);
    const totalSkipped = Object.values(results).reduce((sum, r) => sum + r.skipped_rows, 0);

    await supabaseServer
      .from('import_logs')
      .update({
        rows_accepted: totalNew + totalUpdated,
        rows_rejected: totalSkipped,
        notes: `Imported ${selectedSheets.length} sheets: ${totalNew} new, ${totalUpdated} updated, ${totalSkipped} skipped`,
      })
      .eq('id', importLog.id);

    // Invalidate reports cache immediately so reports reflect new data in real-time
    try {
      invalidateReportsCache();
    } catch {
      // ignore
    }

    // Run conflict detection after import (non-blocking — fires and forgets)
    // The Postgres function detect_all_field_conflicts() scans all employees
    // and inserts into field_conflicts for any field-level mismatch.
    (supabaseServer.rpc('detect_all_field_conflicts') as unknown as Promise<unknown>).then(() => {
      console.log('[smartImport] Conflict detection complete after import');
    }).catch((e: unknown) => {
      console.warn('[smartImport] Conflict detection failed (non-critical):', e);
    });

    return results;
  }
