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
  account_id?: number | null;
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
  warnings?: string[];
  import_id: string;
  // Rows whose global identity match belongs to a DIFFERENT resolved account.
  // They are never silently re-attributed by an import: the master row stays
  // untouched and the row is listed here for review. Moving a master between
  // accounts is only ever an explicit, approved correction action.
  cross_account_conflicts?: Array<{
    row_number: number;
    national_id: string | null;
    employee_name: string | null;
    existing_account: string;
    import_account: string;
    // Master row id of the matched employee — lets the review surface offer a
    // one-click explicit transfer confirmation without re-resolving identity.
    employee_id?: string | null;
  }>;
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
    // Conservative normalization only: Arabic-Indic digits map 1:1 to ASCII.
    // No padding, no digit invention.
    str = str.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
    if (/^[+-]?\d+(\.\d+)?[eE][+-]?\d+$/.test(str)) {
      try {
        const num = Number(str);
        if (!isNaN(num)) {
          str = BigInt(Math.round(num)).toString();
        }
      } catch { /* noop */ }
    }
  }
  // Trailing ".0" float artifact from Excel numeric cells (e.g. "301...055.0").
  if (/^\d+\.0+$/.test(str)) str = str.slice(0, str.indexOf('.'));
  // Conservative: permit only digits with spaces/hyphens as documented Excel
  // grouping separators. Anything else (letters, punctuation) is INVALID —
  // the row goes to review; we never blind-strip characters into a fake ID.
  if (!/^\d[\d\s-]*$/.test(str)) return null;
  const digits = str.replace(/[\s-]/g, '');
  // Never invent digits: wrong length stays wrong; callers require exactly 14.
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
 * FROZEN — NO LIVE CALLERS (call-graph proven 2026-11-25: not imported by any
 * route, page, component, or lib module; the live batch path matches inline).
 * This matcher is GLOBAL by identity and predates the cross-account guard;
 * if it is ever wired to a route it must first enforce the same fail-closed
 * cross-account rule as importSheet. Do not reuse as-is.
 *
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
 * FROZEN — NO LIVE CALLERS (call-graph proven 2026-11-25). Contains an
 * UNGUARDED cross-account transfer (rewrites company_account on any global
 * match) predating the fail-closed guard in importSheet. Do not wire to any
 * route without adding the same cross-account guard. Kept for reference only.
 *
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

    // Merge consolidated_data. USER-APPROVED POLICY (11:04): a blank cell in
    // an import file means "this file has no data for this field" — it must
    // NEVER erase an existing value. null/undefined/'' entries are dropped
    // from the merge; meaningful zero / false / '0' values are preserved.
    // Clearing a value requires a deliberate user action, not an empty cell.
    const oldConsolidatedData = (existingEmp.consolidated_data as Record<string, unknown>) || {};
    const isBlankCell = (v: unknown) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
    const nonBlankRowData = Object.fromEntries(
      Object.entries(row_data as Record<string, unknown>).filter(([, v]) => !isBlankCell(v))
    );
    const newConsolidatedData = {
      ...oldConsolidatedData,
      ...nonBlankRowData,
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
  importLogId: string,
  accountId: number | null = null
): Promise<ImportResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const crossAccountConflicts: NonNullable<ImportResult['cross_account_conflicts']> = [];
  const seenInFile = new Map<string, Record<string, unknown>>(); // employee id -> first row_data in this file
  let newEmployees = 0;
  let updatedEmployees = 0;
  let skippedRows = 0;
  let nonEmptyRows = 0;        // rows with any identity content (trailing blank rows are benign)
  let processingFailures = 0;  // parse/write failures: block snapshot prune (fail closed)

  try {
    // 1. Get sheet definition from database (flexible matching for spaces and dots).
    // Source identity is (account, worksheet name): prefer a sheet registered
    // for THIS account; legacy global (account_id NULL) sheets are a fallback
    // and are claimed or split only with grounding, never by guessing.
    // Matching is deterministic: an exact name match always wins its tier, and
    // a tier with no exact match and more than one candidate is AMBIGUOUS —
    // the import fails closed for review instead of picking by arrival order.
    const { data: allActiveSheets } = await supabaseServer
      .from('dynamic_sheets')
      .select('*')
      .eq('is_active', true);

    const flexNorm = (v: string) => normalizeText(v);
    const flexTight = (v: string) => normalizeText(v).replace(/[\s.]/g, '');
    const matches = (allActiveSheets || []).filter((s) =>
      s.sheet_name === sheetName || flexNorm(s.sheet_name) === flexNorm(sheetName) || flexTight(s.sheet_name) === flexTight(sheetName));
    const scopedMatches = matches.filter((s) => s.account_id !== null && s.account_id !== undefined && s.account_id === accountId);
    const legacyMatches = matches.filter((s) => s.account_id === null || s.account_id === undefined);
    // A sheet scoped to a DIFFERENT account is never this import's source.
    const exactTier = <T extends { sheet_name: string }>(cands: T[]) => cands.filter((s) => s.sheet_name === sheetName);

    let sheetDef: (NonNullable<typeof allActiveSheets>)[number] | null = null;
    if (scopedMatches.length > 0) {
      const exact = exactTier(scopedMatches);
      if (exact.length === 1) {
        sheetDef = exact[0];
      } else if (exact.length === 0 && scopedMatches.length === 1) {
        sheetDef = scopedMatches[0];
      } else {
        return {
          success: false,
          total_rows: 0,
          new_employees: 0,
          updated_employees: 0,
          skipped_rows: 0,
          errors: [`ورقة "${sheetName}" لها أكثر من تعريف محتمل لهذا الحساب (${scopedMatches.map((a) => `"${a.sheet_name}"`).join('، ')}) — لم تُستورد حتى تُراجع التعريفات. لم يُختر أي تعريف تلقائيًا.`],
          import_id: importLogId,
        };
      }
    } else if (legacyMatches.length > 0) {
      const exact = exactTier(legacyMatches);
      const legacyShared = exact.length === 1 ? legacyMatches.find((m) => m.id === exact[0].id)! : (exact.length === 0 && legacyMatches.length === 1 ? legacyMatches[0] : null);
      if (!legacyShared) {
        // Ambiguous legacy definitions (e.g. "RES" vs "RES."): never claim by
        // arrival order — fail closed for manual review.
        return {
          success: false,
          total_rows: 0,
          new_employees: 0,
          updated_employees: 0,
          skipped_rows: 0,
          errors: [`ورقة "${sheetName}" تطابق أكثر من تعريف قديم مشترك (${legacyMatches.map((a) => `"${a.sheet_name}"`).join('، ')}) — لم تُستورد ولم يُطالب بأي تعريف حتى تُراجع يدويًا.`],
          import_id: importLogId,
        };
      }
      // Grounding check: who actually uses this legacy sheet?
      const { data: usageRows } = await supabaseServer
        .from('sheet_data')
        .select('employees_master!inner(account_id)')
        .eq('sheet_id', legacyShared.id)
        .limit(5000);
      const usageAccs = new Set(
        (usageRows || [])
          .map((r) => (r as unknown as { employees_master: { account_id: number | null } }).employees_master?.account_id)
          .filter((a): a is number => a !== null && a !== undefined)
      );
      if (usageAccs.size <= 1 && (usageAccs.size === 0 || accountId === null || usageAccs.has(accountId))) {
        // No data, or only this account's data: grounded to claim for this account.
        if (accountId !== null) {
          // Guarded claim: only if still unclaimed, then VERIFY the stamp
          // landed. A unique-index conflict or a lost race must never leave
          // the import attached to an unscoped shared row.
          const { error: claimErr } = await supabaseServer
            .from('dynamic_sheets')
            .update({ account_id: accountId })
            .eq('id', legacyShared.id)
            .is('account_id', null);
          let claimed = false;
          if (!claimErr) {
            const { data: verify } = await supabaseServer
              .from('dynamic_sheets')
              .select('account_id')
              .eq('id', legacyShared.id)
              .maybeSingle();
            claimed = !!verify && verify.account_id === accountId;
          }
          if (!claimed) {
            return {
              success: false,
              total_rows: 0,
              new_employees: 0,
              updated_employees: 0,
              skipped_rows: 0,
              errors: [`تعذر تثبيت تعريف ورقة "${sheetName}" لهذا الحساب (تعارض مع تعريف آخر أو مطالبة متزامنة) — لم تُستورد ولم تُربط بمصدر مشترك حتى تُراجع.`],
              import_id: importLogId,
            };
          }
        }
        sheetDef = legacyShared;
      } else {
        // Multi-account (or other-account) legacy sheet: do NOT attach this
        // import to it and do NOT split it. Create a private account-scoped
        // source and leave the shared row for review.
        sheetDef = null; // falls through to auto-register (account-scoped)
        warnings.push(`ورقة "${sheetName}" كانت مسجلة كمصدر مشترك قديم بين حسابات — اتعمل مصدر خاص بهذا الحساب والمصدر المشترك محتاج مراجعة يدوية.`);
      }
    }

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
        // Fail closed: an empty sheet is never a delete-snapshot. Prior
        // latest rows are kept; full-sheet deletion needs explicit intent.
        warnings: ['الورقة بدون صفوف بيانات فعلية — لم تُعتبر لقطة حذف؛ اللقطة السابقة محفوظة كما هي. حذف بيانات ورقة كاملة يحتاج تأكيدًا صريحًا.'],
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
    // Confirmed mixed-source model: a sheet WITH a company column routes each
    // row by its explicit cell; blank/unknown cells are fail-closed review.
    const sheetHasCompanyColumn = rawHeaders.some((h) => h === 'الشركه' || h === 'الشركة');

    // 4. Auto-map columns (use definition if available, else smart guess)
    let columnDefs: ColumnDefinition[];
    let mapping: Record<string, number>;
    let currentSheetId = sheetDef?.id;
    let incompleteMapping = false;

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

      // Auto-register this sheet for future use, SCOPED TO THIS ACCOUNT.
      // (No global upsert: a same-named sheet of another account is a
      // different source.) On the rare race where the scoped unique index
      // rejects the insert, re-read the winner.
      const { data: insertedSheet, error: insSheetErr } = await supabaseServer.from('dynamic_sheets').insert({
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
        account_id: accountId,
      }).select('id').maybeSingle();

      if (insertedSheet) {
        currentSheetId = insertedSheet.id;
      } else if (insSheetErr && accountId !== null) {
        const { data: winner } = await supabaseServer.from('dynamic_sheets')
          .select('id').eq('account_id', accountId).eq('sheet_name', sheetName).maybeSingle();
        if (winner) currentSheetId = winner.id;
      }
    }

    // Per-account source catalog (confirmed mixed-source model): the source
    // identity is (workbook sheet, ACCOUNT). Rows resolved to a different
    // account write their contribution to that account's own catalog entry,
    // never into the operator-selected account's sheet.
    const sheetIdByAccount = new Map<number | null, string>();
    if (currentSheetId) sheetIdByAccount.set(accountId, currentSheetId);
    const sheetIdForAccount = async (acct: number | null): Promise<string | undefined> => {
      const hit = sheetIdByAccount.get(acct);
      if (hit) return hit;
      if (acct === null) return currentSheetId;
      const { data: existing } = await supabaseServer.from('dynamic_sheets')
        .select('id').eq('account_id', acct).eq('sheet_name', sheetName).maybeSingle();
      if (existing?.id) {
        sheetIdByAccount.set(acct, existing.id as string);
        return existing.id as string;
      }
      const { data: inserted } = await supabaseServer.from('dynamic_sheets').insert({
        sheet_name: sheetName,
        display_name: sheetName,
        description: `ورقة "${sheetName}" - تم التسجيل التلقائي`,
        column_definitions: toJson(columnDefs),
        matching_keys: ['employee_code', 'national_id', 'employee_name'],
        primary_key_field: 'employee_code',
        is_active: true,
        is_master_source: false,
        update_strategy: 'merge',
        total_columns: columnDefs.length,
        account_id: acct,
      }).select('id').maybeSingle();
      if (inserted?.id) {
        sheetIdByAccount.set(acct, inserted.id as string);
        return inserted.id as string;
      }
      const { data: winner } = await supabaseServer.from('dynamic_sheets')
        .select('id').eq('account_id', acct).eq('sheet_name', sheetName).maybeSingle();
      if (winner?.id) {
        sheetIdByAccount.set(acct, winner.id as string);
        return winner.id as string;
      }
      return undefined;
    };

    // Unmapped-column guard: a column present in the file but absent from the
    // registered mapping is INVISIBLE to the importer. If such a column holds
    // any data, the import is partial: say so visibly and never run the
    // snapshot prune as if this were a full sync. No semantic auto-guessing —
    // extending the mapping is a deliberate user decision.
    {
      const mappedIdx = new Set(Object.values(mapping));
      const unmappedHeaders: string[] = [];
      rawHeaders.forEach((h, idx) => {
        if (h && !mappedIdx.has(idx)) unmappedHeaders.push(h);
      });
      const withData = unmappedHeaders.filter((h) => {
        const idx = rawHeaders.indexOf(h);
        return dataRows.some((row) => {
          const v = (row as unknown[])[idx];
          return v !== null && v !== undefined && String(v).trim() !== '';
        });
      });
      if (withData.length > 0) {
        incompleteMapping = true;
        warnings.push(`أعمدة غير مسجلة بها بيانات ولم تُستورد: ${withData.join('، ')} — الاستيراد جزئي لهذه الورقة، ولم تُعتبر لقطة كاملة (لم تُحذف أي صفوف قديمة). تحديث تسجيل الأعمدة يحتاج مراجعتك.`);
      }
    }

    // 5. Pre-load existing employees into memory for high-speed matching (1 single query instead of thousands)
    const { data: existingEmps } = await supabaseServer
      .from('employees_master')
      .select('id, company_account, account_id, employee_code, national_id, employee_name, insurance_number, consolidated_data, account_employee_uid');

    // Row-account resolution (shared with the bridge phase below).
    const { data: rowAccounts } = await supabaseServer
      .from('company_accounts')
      .select('id, account_code, aliases')
      .eq('is_active', true);
    const resolveRowAccount = (txt: unknown): number | null => {
      const t = String(txt || '').trim().toLowerCase();
      if (!t) return null;
      const m = (rowAccounts || []).find(
        (a) => a.account_code.toLowerCase() === t ||
          (Array.isArray(a.aliases) && a.aliases.some((al: string) => al.trim().toLowerCase() === t))
      );
      return m ? (m.id as number) : null;
    };
    // Canonical stored form per account: the dotted alias (E.G / M.G), falling
    // back to the code — same convention as the import route canonicalization.
    const accountCodeById = new Map<number, string>();
    (rowAccounts || []).forEach((a) => {
      const dotted = Array.isArray(a.aliases) ? a.aliases.find((al: string) => /^[A-Za-z]\.[A-Za-z]/.test(String(al).trim())) : null;
      accountCodeById.set(a.id as number, String(dotted || a.account_code).trim());
    });

    // Identity matching is by 14-digit national ID ONLY (user rule): no
    // insurance-number / employee-code / name fallback maps.
    const byNatIdMap = new Map<string, EmployeeLookup>();

    for (const emp of (existingEmps || []) as EmployeeLookup[]) {
      if (emp.national_id && String(emp.national_id).trim().length === 14) {
        byNatIdMap.set(String(emp.national_id).trim(), emp);
      }
    }

    // UID collision tracking (mirror of the resolve_employee_account_uid
    // trigger): a new row whose account-code+employee-code uid already
    // belongs to a DIFFERENT national ID is an identity conflict for review —
    // never an NID-fallback merge, never a silent master reassignment, and it
    // must not take its whole insert chunk down with it.
    const accountRealCodeById = new Map<number, string>();
    (rowAccounts || []).forEach((a) => accountRealCodeById.set(a.id as number, String(a.account_code).trim()));
    const existingUids = new Set<string>(
      (existingEmps || []).map((e) => String((e as { account_employee_uid?: string }).account_employee_uid || '')).filter(Boolean)
    );
    const queuedUids = new Set<string>();
    // Committed-write accounting: counters move only on successful flush.
    const empKindById = new Map<string, 'new' | 'update'>();
    const empRowNumberById = new Map<string, number>();

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

        // Skip rows without a valid 14-digit national ID. User-steered rule
        // (2026-11-25 14:43): identity matching is by NATIONAL ID ONLY — no
        // employee-code, insurance-number, or name fallback. A content row
        // without a valid NID is an identity failure: fail closed to review
        // and block the snapshot prune (never guess a person).
        const hasValidNid = !!rawNatId && rawNatId.length === 14;
        if (!hasValidNid) {
          // Inspect the RAW row, not rowData: columns not present in the
          // registered mapping never reach rowData, but their content still
          // makes this a data row whose owner we cannot identify.
          const hasAnyContent = (row as unknown[]).some(
            (v) => v !== null && v !== undefined && String(v).trim() !== ''
          );
          if (hasAnyContent) {
            errors.push(`صف ${rowNumber}: بيانات بدون رقم قومي صحيح من 14 رقمًا — لم يُستورد؛ المطابقة بالرقم القومي فقط ويحتاج مراجعة، وتعذّر اعتبار الملف لقطة كاملة`);
            processingFailures++;
          }
          skippedRows++;
          continue;
        }
        // ROW ACCOUNT (confirmed mixed-source model): an explicit
        // الشركه/الشركة cell wins over the operator-selected account. On a
        // sheet that HAS a company column, a blank or unknown cell is
        // fail-closed review — never the operator default, never guessed.
        // Registered sheets store the company cell under the mapped key
        // (company_account), not the raw header text — read both.
        const rowAccCell = String(rowData['company_account'] ?? rowData['الشركه'] ?? rowData['الشركة'] ?? '').trim();
        let rowAccountId: number | null = null;
        if (rowAccCell) {
          rowAccountId = resolveRowAccount(rowAccCell);
          if (rowAccountId === null) {
            errors.push(`صف ${rowNumber}: شركة الصف غير معروفة (${rowAccCell}) — لم يُستورد؛ يحتاج مراجعة`);
            processingFailures++;
            skippedRows++;
            continue;
          }
        } else if (sheetHasCompanyColumn) {
          errors.push(`صف ${rowNumber}: شركة الصف فارغة في ورقة مختلطة — لم يُستورد؛ يحتاج مراجعة ولا يُنسب تلقائيًا`);
          processingFailures++;
          skippedRows++;
          continue;
        }
        const effectiveAccountId: number | null = rowAccountId ?? accountId;
        const effectiveAccText = (effectiveAccountId !== null && accountCodeById.get(effectiveAccountId)) || companyAccount.trim().toLowerCase();
        nonEmptyRows++;

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

        // Fast in-memory matching — NATIONAL ID ONLY (user-steered rule
        // 2026-11-25 14:43: identity matching is by national ID, not the
        // employee/performance code). No insurance-number, employee-code, or
        // name fallback: those collide across companies and time; only a
        // 14-digit NID identifies a person. (Account scope enforced by the
        // cross-account guard below.)
        let matchedEmp: EmployeeLookup | null = null;
        if (rawNatId && rawNatId.length === 14) {
          const found = byNatIdMap.get(rawNatId);
          if (found) matchedEmp = found;
        }

        // CROSS-ACCOUNT GUARD (fail closed). The match maps above are global
        // by identity; an import for account X must never silently re-attribute
        // a master row that already belongs to a DIFFERENT resolved account.
        // Operator account selection is not proof of current employment — a
        // wrong pick would otherwise flip the person and hide them from their
        // real company. Cross-account moves happen only through an explicit,
        // approved correction batch. Same-account matches update normally, and
        // masters with NO resolved attribution (blank text + NULL account_id)
        // may still be claimed by a grounded import.
        if (matchedEmp) {
          const empAccId =
            typeof matchedEmp.account_id === 'number' ? matchedEmp.account_id : null;
          const empAccText = String(matchedEmp.company_account || '').trim().toLowerCase();
          const impAccText = effectiveAccText;
          const sameAccount =
            (empAccId !== null && effectiveAccountId !== null && empAccId === effectiveAccountId) ||
            (empAccText !== '' && empAccText === impAccText);
          const empAccountKnown = empAccId !== null || empAccText !== '';
          if (empAccountKnown && !sameAccount) {
            crossAccountConflicts.push({
              row_number: rowNumber,
              national_id: rawNatId || null,
              employee_name: rawName || null,
              existing_account: matchedEmp.company_account,
              // Resolved ROW account (explicit cell wins over the operator
              // selection), not the workbook/operator account.
              import_account: effectiveAccText,
              employee_id: matchedEmp.id,
            });
            continue;
          }
        }

        if (matchedEmp) {
          // Existing employee — counted only when its update COMMITS (flush
          // phase below), so reported counts equal persisted writes.
          const oldConsolidated = (matchedEmp.consolidated_data as Record<string, unknown>) || {};
          // USER-APPROVED POLICY (11:04): blank/null/'' cells never erase
          // existing values; meaningful zero/false survive. Missing column =
          // key absent = untouched. Clearing is a deliberate action only.
          const isBlankCell2 = (v: unknown) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
          const newConsolidated = {
            ...oldConsolidated,
            ...Object.fromEntries(Object.entries(rowData as Record<string, unknown>).filter(([, v]) => !isBlankCell2(v))),
          };
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
              // Row account wins (confirmed mixed-source model): stamp the
              // RESOLVED row account, never the operator-selected text — the
              // company_account trigger derives account_id from this text, so
              // operator text here silently restamps the master cross-account.
              company_account: effectiveAccText,
              account_id: effectiveAccountId,
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
          empKindById.set(matchedEmp.id, 'update');
          empRowNumberById.set(matchedEmp.id, rowNumber);

          {
            const prev = seenInFile.get(matchedEmp.id);
            if (prev) {
              const diffKeys = Object.keys(rowData).filter((k) => {
                const a = (rowData as Record<string, unknown>)[k];
                const b = prev[k];
                const blank = (x: unknown) => x === undefined || x === null || String(x).trim() === '';
                return !blank(a) && !blank(b) && String(a) !== String(b);
              });
              if (diffKeys.length > 0) {
                warnings.push(`صف مكرر لنفس الموظف (${rawName || rawNatId || rawCode}) في نفس الملف بقيم مختلفة في: ${diffKeys.join('، ')} — اعتُمد أحدث صف بالترتيب ويحتاج مراجعة، لم تُعتمد كقيمة موثقة`);
              }
            } else {
              seenInFile.set(matchedEmp.id, rowData as Record<string, unknown>);
            }
          }
          const matchedRowSheetId = await sheetIdForAccount(effectiveAccountId);
          if (matchedRowSheetId) {
            sheetDataToInsert.push({
              sheet_id: matchedRowSheetId,
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
          // New employee — counted only when its insert COMMITS (flush below).
          const newId = crypto.randomUUID();
          // Identity-collision gate (fail closed to review): if this row's
          // account-code+code uid already exists for a different national ID
          // (in the DB or earlier in this same batch), do NOT insert and do
          // NOT fall back to any other identifier — route to explicit review.
          {
            const accCodeForUid = (effectiveAccountId !== null && accountRealCodeById.get(effectiveAccountId)) || 'UNASSIGNED';
            const cleanCodeForUid = String(rawCode || '').replace(/[^0-9a-zA-Z]/g, '');
            const cleanNidForUid = String(rawNatId || '').replace(/[^0-9]/g, '');
            const rowUid = cleanCodeForUid
              ? `${accCodeForUid}-${cleanCodeForUid}`
              : `${accCodeForUid}-NID${cleanNidForUid}`;
            if (existingUids.has(rowUid) || queuedUids.has(rowUid)) {
              errors.push(`صف ${rowNumber}: الكود ${rawCode || '—'} مستخدم بالفعل لموظف آخر برقم قومي مختلف في نفس الحساب — لم يُستورد؛ تعارض هوية يحتاج مراجعة صريحة (لا مطابقة بالكود ولا نقل تلقائي)`);
              processingFailures++;
              skippedRows++;
              continue;
            }
            queuedUids.add(rowUid);
          }
          empKindById.set(newId, 'new');
          empRowNumberById.set(newId, rowNumber);
            const newEmpRecord: EmployeeMasterInsert = {
              id: newId,
              company_account: effectiveAccText,
              account_id: effectiveAccountId,
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
            // Same-file duplicate tracking for NEW employees too: without this,
            // a duplicate row only warns from the second import onward.
            seenInFile.set(newId, rowData as Record<string, unknown>);
            if (rawNatId && rawNatId.length === 14) byNatIdMap.set(rawNatId, lookupRecord);

            historyToInsert.push({
              employee_id: newId,
              change_type: 'initial_import',
              to_company_account: companyAccount,
              to_employee_code: rawCode,
              new_values: toJson(rowData),
              import_id: importLogId,
            });

            const newRowSheetId = await sheetIdForAccount(effectiveAccountId);
            if(newRowSheetId) {
              sheetDataToInsert.push({
                sheet_id: newRowSheetId,
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
          processingFailures++;
        }
      }

    // 6. Execute high-speed batch operations in parallel chunks
    // A) Batch Insert New Employees (chunks of 150)
    // Counters reflect COMMITTED writes only. A failed chunk falls back to
    // per-row inserts so one bad row never takes down valid unrelated rows;
    // rows that still fail become review errors, never phantom "new" counts,
    // and their dependent sheet_data/history rows are dropped below.
    const failedEmpIds = new Set<string>();
    for (let i = 0; i < employeesToInsert.length; i += 150) {
        const chunk = employeesToInsert.slice(i, i + 150);
        const { error } = await supabaseServer.from('employees_master').insert(chunk);
        if (!error) { newEmployees += chunk.length; continue; }
        for (const row of chunk) {
          const { error: rowErr } = await supabaseServer.from('employees_master').insert(row);
          if (!rowErr) { newEmployees++; continue; }
          const rn = empRowNumberById.get(row.id as string);
          errors.push(`صف ${rn ?? '?'}: تعذّر إدراج الموظف الجديد (${rowErr.message}) — لم يُستورد؛ يحتاج مراجعة`);
          processingFailures++;
          skippedRows++;
          failedEmpIds.add(row.id as string);
        }
      }

      // B) Batch Update Existing Employees (parallel chunks of 20)
      for (let i = 0; i < employeesToUpdate.length; i += 20) {
        const chunk = employeesToUpdate.slice(i, i + 20);
        await Promise.all(
          chunk.map(async (item) => {
            const { error: upErr } = await supabaseServer.from('employees_master').update(item.data).eq('id', item.id);
            if (!upErr) { updatedEmployees++; return; }
            const rn = empRowNumberById.get(item.id);
            errors.push(`صف ${rn ?? '?'}: تعذّر تحديث الموظف (${upErr.message}) — لم يُحدَّث؛ يحتاج مراجعة`);
            processingFailures++;
            skippedRows++;
            failedEmpIds.add(item.id);
          })
        );
      }

      // C) Batch Insert Sheet Data (chunks of 250)
      // One-latest-per-(sheet, employee): re-filed rows supersede the same
      // employee's previous latest row in the same catalog sheet.
      // Rows whose employee never committed must not reach sheet_data: their
      // FK failure would otherwise kill a whole chunk of valid rows. Their old
      // latest rows must NOT be superseded either (nothing replaces them).
      const sheetDataFiltered = sheetDataToInsert.filter((r) => !failedEmpIds.has(r.employee_id as string));
      const empIdsBySheet = new Map<string, Set<string>>();
      sheetDataFiltered.forEach((r) => {
        const sid = r.sheet_id;
        const eid = r.employee_id;
        if (!sid || !eid) return;
        const set = empIdsBySheet.get(sid) || new Set<string>();
        set.add(eid);
        empIdsBySheet.set(sid, set);
      });
      for (const [sid, empSet] of Array.from(empIdsBySheet.entries())) {
        const ids = Array.from(empSet);
        for (let i = 0; i < ids.length; i += 200) {
          const { error: supErr } = await supabaseServer
            .from('sheet_data')
            .update({ is_latest: false })
            .eq('sheet_id', sid)
            .eq('is_latest', true)
            .in('employee_id', ids.slice(i, i + 200));
          if (supErr) { errors.push(`Snapshot supersede error: ${supErr.message}`); processingFailures++; }
        }
      }
      const counterAdjusted = new Set<string>();
      const noteSheetDataFailure = (r: SheetDataInsert, msg: string) => {
        const rn = empRowNumberById.get(r.employee_id as string);
        errors.push(`صف ${rn ?? '?'}: تعذّر حفظ صف الورقة (${msg}) — فُقد؛ يحتاج مراجعة`);
        processingFailures++;
        // The employee write already committed and was counted; a lost
        // sheet_data row means the import for that row did NOT fully persist,
        // so move the row's count to skipped — counters stay committed-only.
        const eid = r.employee_id as string;
        if (!counterAdjusted.has(eid)) {
          counterAdjusted.add(eid);
          const kind = empKindById.get(eid);
          if (kind === 'new') newEmployees--;
          else if (kind === 'update') updatedEmployees--;
          skippedRows++;
        }
      };
      for (let i = 0; i < sheetDataFiltered.length; i += 250) {
        const chunk = sheetDataFiltered.slice(i, i + 250);
        const { error } = await supabaseServer.from('sheet_data').insert(chunk);
        if (!error) continue;
        for (const row of chunk) {
          const { error: rowErr } = await supabaseServer.from('sheet_data').insert(row);
          if (rowErr) noteSheetDataFailure(row, rowErr.message);
        }
      }

      // D) Batch Insert History (chunks of 250)
      const historyFiltered = historyToInsert.filter((h) => !failedEmpIds.has(h.employee_id as string));
      for (let i = 0; i < historyFiltered.length; i += 250) {
        const chunk = historyFiltered.slice(i, i + 250);
        const { error: histErr } = await supabaseServer.from('employee_history').insert(chunk);
        if (histErr) { errors.push(`خطأ في حفظ سجل التاريخ: ${histErr.message}`); processingFailures++; }
      }

      // E) Phase 1 Bridge Batches (Bridging the Two Worlds):
      // Row Account wins (confirmed mixed-source model): a row whose own
      // company cell resolves is stamped with THAT account; rows without a
      // company cell take the import's validated account. Blank/unknown
      // cells on company-column sheets never reach this phase (reviewed out
      // in the row loop above).
      payrollBatch.forEach((r) => {
        const rd = (r.raw_data || {}) as Record<string, unknown>;
        const rowAcc = resolveRowAccount(rd['الشركه'] ?? rd['الشركة']);
        r.account_id = rowAcc ?? accountId;
      });
      insuranceBatch.forEach((r) => {
        const rd = (r.raw_data || {}) as Record<string, unknown>;
        const rowAcc = resolveRowAccount(rd['الشركه'] ?? rd['الشركة']);
        r.account_id = rowAcc ?? accountId;
      });
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
        if (error) { errors.push(`Bridge monthly_payroll error: ${error.message}`); processingFailures++; }
      }
      for (let i = 0; i < insuranceBatch.length; i += 150) {
        const chunk = insuranceBatch.slice(i, i + 150);
        const { error } = await supabaseServer.from('monthly_insurance_records').insert(chunk);
        if (error) { errors.push(`Bridge monthly_insurance error: ${error.message}`); processingFailures++; }
      }

      // C2) Per-worksheet snapshot semantics (user-approved 2026-11-25 12:05):
      // a re-upload of THIS worksheet for THIS account is a new snapshot of
      // that source. Rows whose employee is absent from the new file stop
      // being latest (this source's contribution is recomputed away by the
      // zz_sheet_data_contribution_removed trigger); rows for employees who
      // ARE in the file keep their history, so a blank cell still never
      // erases (newest non-blank wins within the source). A worksheet that
      // is simply not part of this upload is untouched. When the account is
      // unresolved (accountId null) the flip is skipped rather than guessed.
      // FAIL CLOSED: never prune on a partial/failed/empty sync. A prune is
      // only a verified full snapshot of this (worksheet, account).
      if (currentSheetId && accountId !== null && processingFailures === 0 && nonEmptyRows > 0 && !incompleteMapping && crossAccountConflicts.length === 0) {
        // Per-source-worksheet prune across row accounts. Source identity is
        // the (OPERATOR account, worksheet name) stream, grounded in
        // import_logs.account_id (user-confirmed 2026-11-25: one workbook per
        // company, stable worksheet names, re-uploaded as-is). Each account's
        // catalog for this worksheet name flips only rows that (a) belong to
        // that account's absent employees AND (b) were written by THIS
        // stream's imports. Rows routed here from another company's workbook,
        // or with no import linkage, are never touched (fail closed).
        const { data: streamLogs } = await supabaseServer
          .from('import_logs')
          .select('id')
          .eq('account_id', accountId);
        const streamLogIds = (streamLogs || []).map((l) => l.id as string);
        const { data: nameSheets } = await supabaseServer
          .from('dynamic_sheets')
          .select('id, account_id')
          .eq('sheet_name', sheetName)
          .not('account_id', 'is', null);
        for (const cat of (nameSheets || []) as Array<{ id: string; account_id: number }>) {
          const acct = cat.account_id;
          const acctSheetId = cat.id;
          const importedEmpIds = empIdsBySheet.get(acctSheetId) || new Set<string>();
          const { data: accEmps, error: accErr } = await supabaseServer
            .from('employees_master')
            .select('id')
            .eq('account_id', acct);
          if (accErr) {
            warnings.push(`تعذر تحديد موظفي الحساب لتطبيق لقطة الورقة: ${accErr.message}`);
            continue;
          }
          const staleEmpIds = (accEmps || [])
            .map((e) => e.id as string)
            .filter((id) => !importedEmpIds.has(id));
          for (let i = 0; i < staleEmpIds.length; i += 200) {
            const chunk = staleEmpIds.slice(i, i + 200);
            let flipQ = supabaseServer
              .from('sheet_data')
              .update({ is_latest: false })
              .eq('sheet_id', acctSheetId)
              .eq('is_latest', true)
              .in('employee_id', chunk);
            // Stream scoping only when the stream has logged imports; with no
            // logs there is nothing this stream could have written.
            if (streamLogIds.length === 0) continue;
            flipQ = flipQ.in('import_id', streamLogIds);
            const { error: flipErr } = await flipQ;
            if (flipErr) errors.push(`Snapshot flip error: ${flipErr.message}`);
          }
        }
      } else if (currentSheetId && accountId === null) {
        warnings.push('تعذر تحديد الحساب بدقة — تم الاحتفاظ بلقطة الورقة السابقة دون حذف أي صفوف قديمة.');
      } else if (currentSheetId && processingFailures === 0 && nonEmptyRows > 0 && incompleteMapping) {
        // (warning already pushed above — keep this branch so no generic
        // message contradicts it)
      } else if (currentSheetId && crossAccountConflicts.length > 0) {
        // Blocked cross-account rows mean this import is NOT a verified full
        // snapshot of the sheet: never prune old rows on a partial sync.
        warnings.push(`${crossAccountConflicts.length} صف/صفوف محجوبة لتعارض الحساب — الاستيراد جزئي لهذه الورقة، ولم تُعتبر لقطة كاملة (لم تُحذف أي صفوف قديمة).`);
      } else if (currentSheetId && processingFailures > 0) {
        warnings.push(`المزامنة لم تكتمل: ${processingFailures} صف/عملية فشلت — تم الاحتفاظ بلقطة الورقة السابقة دون حذف أي صفوف قديمة، وراجع الأخطاء أعلاه.`);
      } else if (currentSheetId && nonEmptyRows === 0) {
        warnings.push('الورقة بدون صفوف بيانات فعلية — لم تُعتبر لقطة حذف؛ اللقطة السابقة محفوظة كما هي. حذف بيانات ورقة كاملة يحتاج تأكيدًا صريحًا.');
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

      if (crossAccountConflicts.length > 0) {
        warnings.push(
          `${crossAccountConflicts.length} صف/صفوف تطابق موظفين مسجلين بحساب آخر — لم يُعد إسنادهم تلقائيًا ولم تتغير بياناتهم؛ نقل الموظف بين الحسابات يتم فقط بقرار مراجعة صريح منك.`
        );
      }

      return {
        success: errors.length === 0,
        total_rows: dataRows.length,
        new_employees: newEmployees,
        updated_employees: updatedEmployees,
        skipped_rows: skippedRows,
        errors: errors,
        warnings: warnings.length ? warnings : undefined,
        import_id: importLogId,
        cross_account_conflicts: crossAccountConflicts.length ? crossAccountConflicts : undefined,
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
    fileName: string,
    accountId?: number | null
  ): Promise<Record<string, ImportResult>> {
    const results: Record<string, ImportResult> = {};

    // Create import log
    const { data: importLog, error: logError } = await supabaseServer
      .from('import_logs')
      .insert({
        source_type: 'multi_sheet_import',
        file_name: fileName,
        account_id: accountId ?? null,
        notes: `Multi-sheet import for ${companyAccount}: ${selectedSheets.join(', ')}`,
      })
      .select('id')
      .single();

    if (logError || !importLog) {
      throw new Error('Failed to create import log');
    }

    // Import each selected sheet
    for (const sheetName of selectedSheets) {
      results[sheetName] = await importSheet(companyAccount, sheetName, workbook, importLog.id, accountId ?? null);
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
