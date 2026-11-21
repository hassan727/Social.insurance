/**
 * Data Cleaner Service
 * Automatically detects and fixes corrupted employee data
 */

import { supabaseServer } from './supabaseServer';

interface DataQualityIssue {
  employee_id: string;
  issue_type: 'name_is_number' | 'national_id_is_text' | 'phone_is_address' | 'code_invalid';
  field: string;
  current_value: string;
  suggested_fix?: string;
  confidence: number;
}

/**
 * Detect data quality issues in employees_master
 */
export async function detectDataQualityIssues(): Promise<DataQualityIssue[]> {
  const { data: employees, error } = await supabaseServer
    .from('employees_master')
    .select('id, employee_code, national_id, employee_name, phone_number, current_job_title, hire_date')
    .limit(1000);

  if (error || !employees) {
    console.error('Failed to fetch employees for quality check:', error);
    return [];
  }

  const issues: DataQualityIssue[] = [];

  for (const emp of employees) {
    // Check 1: employee_name should NOT be a pure number
    if (emp.employee_name && /^\d+$/.test(emp.employee_name.trim())) {
      issues.push({
        employee_id: emp.id,
        issue_type: 'name_is_number',
        field: 'employee_name',
        current_value: emp.employee_name,
        confidence: 0.95,
      });
    }

    // Check 2: national_id should be 14 digits, NOT text
    if (emp.national_id && !/^\d{14}$/.test(emp.national_id.trim())) {
      // If it contains Arabic letters, it's clearly wrong
      if (/[ا-ي]/.test(emp.national_id)) {
        issues.push({
          employee_id: emp.id,
          issue_type: 'national_id_is_text',
          field: 'national_id',
          current_value: emp.national_id,
          confidence: 1.0,
        });
      }
    }

    // Check 3: phone_number should be digits, NOT address text
    if (emp.phone_number && /[ا-ي]/.test(emp.phone_number)) {
      issues.push({
        employee_id: emp.id,
        issue_type: 'phone_is_address',
        field: 'phone_number',
        current_value: emp.phone_number,
        confidence: 0.9,
      });
    }

    // Check 4: current_job_title should NOT be 14-digit number
    if (emp.current_job_title && /^\d{14}$/.test(emp.current_job_title.trim())) {
      issues.push({
        employee_id: emp.id,
        issue_type: 'national_id_is_text',
        field: 'current_job_title',
        current_value: emp.current_job_title,
        suggested_fix: 'Likely swapped with national_id',
        confidence: 0.95,
      });
    }
  }

  return issues;
}

/**
 * Attempt to auto-fix corrupted data by analyzing patterns
 */
export async function attemptAutoFix(employeeId: string): Promise<boolean> {
  const { data: emp, error } = await supabaseServer
    .from('employees_master')
    .select('*')
    .eq('id', employeeId)
    .single();

  if (error || !emp) return false;

  const fixes: Record<string, string | null> = {};

  // Pattern 1: If name is number and national_id is text, they're swapped
  if (/^\d+$/.test(emp.employee_name || '') && /[ا-ي]/.test(emp.national_id || '')) {
    fixes.employee_name = emp.national_id;
    fixes.national_id = emp.employee_name;
  }

  // Pattern 2: If job_title is 14-digit and national_id is text, swap them
  if (/^\d{14}$/.test(emp.current_job_title || '') && /[ا-ي]/.test(emp.national_id || '')) {
    const temp = emp.current_job_title;
    fixes.current_job_title = emp.national_id;
    fixes.national_id = temp;
  }

  // Pattern 3: If phone contains address text and hire_date is NOT a date, check for swap
  if (/[ا-ي]/.test(emp.phone_number || '') && emp.hire_date && /[ا-ي]/.test(emp.hire_date)) {
    // They're likely swapped with address/department
    fixes.address = emp.phone_number;
    fixes.phone_number = null;
  }

  if (Object.keys(fixes).length === 0) return false;

  // Apply fixes
  const { error: updateError } = await supabaseServer
    .from('employees_master')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic subset of fields from corruption detection
    .update(fixes as any)
    .eq('id', employeeId);

  return !updateError;
}

/**
 * Get statistics about data quality
 */
export async function getDataQualityStats() {
  const issues = await detectDataQualityIssues();
  
  const stats = {
    total_employees_scanned: 1000,
    total_issues: issues.length,
    by_type: {
      name_is_number: issues.filter(i => i.issue_type === 'name_is_number').length,
      national_id_is_text: issues.filter(i => i.issue_type === 'national_id_is_text').length,
      phone_is_address: issues.filter(i => i.issue_type === 'phone_is_address').length,
      code_invalid: issues.filter(i => i.issue_type === 'code_invalid').length,
    },
    high_confidence_issues: issues.filter(i => i.confidence >= 0.9).length,
  };

  return { stats, issues: issues.slice(0, 50) };
}

/**
 * Mark employees with quality issues for manual review
 */
export async function flagCorruptedEmployees(): Promise<number> {
  const issues = await detectDataQualityIssues();
  const employeeIds = [...new Set(issues.map(i => i.employee_id))];

  if (employeeIds.length === 0) return 0;

  const { error } = await supabaseServer
    .from('employees_master')
    .update({ has_duplicate_risk: true }) // Re-use this flag for now
    .in('id', employeeIds);

  return error ? 0 : employeeIds.length;
}
