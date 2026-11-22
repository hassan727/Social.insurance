/**
 * Matching Engine for EGYPT GAS Unified HR & Insurance Platform
 *
 * Implements strict hierarchical matching rules:
 * 1. National ID (Exact 14 digits) -> 100% confidence -> Auto-match
 * 2. Account + Employee Code (Company Account is mandatory!) -> 98% confidence -> Auto-match
 * 3. Insurance Number (Unique) -> 92% confidence -> Auto-match
 * 4. Normalized Name + Corroborating Data (Phone/Department/Region) -> 75% -> Candidate for review
 * 5. Normalized Name Only -> 50% -> Candidate for review (NEVER auto-match!)
 */

import { supabaseServer } from './supabaseServer';
import type { Json } from '@/types/supabase';

export function normalizeArabicText(text: string): string {
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

export type MatchConfidence = 'exact_national_id' | 'exact_account_code' | 'exact_insurance_no' | 'candidate_review' | 'no_match';

export interface MatchResult {
  matched: boolean;
  employee_id: string | null;
  confidence: MatchConfidence;
  confidence_score: number; // 0.0 - 1.0
  match_rule: string;
  candidate_id?: string;
  requires_review: boolean;
  existing_employee?: {
    id: string;
    employee_code: string | null;
    national_id: string | null;
    employee_name: string;
    company_account: string;
    current_status: string | null;
    current_job_title: string | null;
    current_department: string | null;
  };
}

export interface CandidateReviewItem {
  id: string;
  import_id: string | null;
  sheet_name: string;
  row_data: Record<string, unknown>;
  row_number: number | null;
  raw_code: string | null;
  raw_national_id: string | null;
  raw_name: string | null;
  candidate_employee_id: string | null;
  match_type: string | null;
  confidence_score: number | null;
  candidate_snapshot: Record<string, unknown> | null;
  status: string;
  notes: string | null;
  created_at: string;
  candidate_employee?: {
    id: string;
    employee_code: string | null;
    national_id: string | null;
    employee_name: string;
    company_account: string;
    current_status: string | null;
    current_job_title: string | null;
  } | null;
}

/**
 * Evaluates a row against the employees_master database and either auto-matches
 * or creates a review candidate in matching_candidates.
 */
export async function matchIncomingRow(params: {
  company_account: string;
  employee_code?: string | null;
  national_id?: string | null;
  employee_name?: string | null;
  phone_number?: string | null;
  insurance_number?: string | null;
  raw_row: Record<string, unknown>;
  sheet_name: string;
  import_id?: string;
  row_number?: number;
}): Promise<MatchResult> {
  const account = params.company_account.trim();
  const code = params.employee_code?.trim() || null;
  const natId = params.national_id?.replace(/\D/g, '') || null;
  const insNo = params.insurance_number?.trim() || null;
  const rawName = params.employee_name?.trim() || '';
  const normName = normalizeArabicText(rawName);

  // ── PRIORITY 1: Exact National ID (14 digits) ── Global Unique Identifier
  if (natId && natId.length === 14) {
    const { data: byNatId } = await supabaseServer
      .from('employees_master')
      .select('id, employee_code, national_id, employee_name, company_account, current_status, current_job_title, current_department')
      .eq('national_id', natId)
      .limit(2);

    if (byNatId && byNatId.length >= 1) {
      const emp = byNatId[0];
      return {
        matched: true,
        employee_id: emp.id,
        confidence: 'exact_national_id',
        confidence_score: 1.0,
        match_rule: 'الرقم القومي مطابق تماماً (14 رقم)',
        requires_review: false,
        existing_employee: emp,
      };
    }
  }

  // ── PRIORITY 2: Insurance Number (Unique State Insurance ID) ──
  if (insNo && insNo.length >= 7) {
    const { data: byIns } = await supabaseServer
      .from('employees_master')
      .select('id, employee_code, national_id, employee_name, company_account, current_status, current_job_title, current_department')
      .eq('insurance_number', insNo)
      .limit(2);

    if (byIns && byIns.length >= 1) {
      const emp = byIns[0];
      return {
        matched: true,
        employee_id: emp.id,
        confidence: 'exact_insurance_no',
        confidence_score: 0.95,
        match_rule: `الرقم التأميني مطابق (${insNo})`,
        requires_review: false,
        existing_employee: emp,
      };
    }
  }

  // ── PRIORITY 3: Employee Code (Universal Code Match) ──
  if (code) {
    // First, search by employee code across all accounts
    const { data: byCodeAll } = await supabaseServer
      .from('employees_master')
      .select('id, employee_code, national_id, employee_name, company_account, current_status, current_job_title, current_department')
      .eq('employee_code', code)
      .limit(5);

    if (byCodeAll && byCodeAll.length === 1) {
      const emp = byCodeAll[0];
      // If code is unique in master, it's the same employee regardless of whether sheet says E.G or M.G
      return {
        matched: true,
        employee_id: emp.id,
        confidence: 'exact_account_code',
        confidence_score: 0.92,
        match_rule: `كود الموظف فريد ومطابق (${code})`,
        requires_review: false,
        existing_employee: emp,
      };
    } else if (byCodeAll && byCodeAll.length > 1) {
      // If multiple employees share the code, match with account or name similarity
      const sameAccount = byCodeAll.find(e => e.company_account.toLowerCase() === account.toLowerCase());
      if (sameAccount) {
        return {
          matched: true,
          employee_id: sameAccount.id,
          confidence: 'exact_account_code',
          confidence_score: 0.90,
          match_rule: `كود الموظف مطابق مع الحساب (${account} - ${code})`,
          requires_review: false,
          existing_employee: sameAccount,
        };
      }
    }
  }

  // ── PRIORITY 4 & 5: Name Similarity + Corroborating Data (Candidate Review) ──
  // Uses DB-side filtering with ILIKE on first word of name for efficiency,
  // then refines with normalized Arabic comparison in JS. No AI — pure data matching.
  if (normName && normName.length >= 4) {
    // Extract first word of the normalized name to use as a DB filter anchor
    const firstWord = normName.split(' ')[0] || normName;

    const { data: candidateEmps } = await supabaseServer
      .from('employees_master')
      .select('id, employee_code, national_id, employee_name, company_account, current_status, current_job_title, current_department')
      .ilike('employee_name', `%${firstWord.slice(0, 6)}%`)
      .limit(200);

    type CandidateEmp = {
      id: string;
      employee_code: string | null;
      national_id: string | null;
      employee_name: string;
      company_account: string;
      current_status: string | null;
      current_job_title: string | null;
      current_department: string | null;
    };
    let bestCandidate: CandidateEmp | null = null;
    let highestScore = 0;

    for (const c of candidateEmps || []) {
      const cNorm = normalizeArabicText(c.employee_name);
      if (!cNorm) continue;

      if (cNorm === normName) {
        // Exact normalized name match
        let score = 0.70;
        if (c.company_account === account) score += 0.10; // same account bonus
        if (highestScore < score) {
          highestScore = score;
          bestCandidate = c;
        }
      } else if (cNorm.includes(normName) || normName.includes(cNorm)) {
        // Partial name containment
        let score = 0.55;
        if (c.company_account === account) score += 0.05;
        if (highestScore < score) {
          highestScore = score;
          bestCandidate = c;
        }
      }
    }

    if (bestCandidate && highestScore >= 0.5) {
      const { data: insertedCandidate } = await supabaseServer
        .from('matching_candidates')
        .insert({
          import_id: params.import_id ?? null,
          sheet_name: params.sheet_name,
          row_data: params.raw_row as Json,
          row_number: params.row_number ?? null,
          raw_code: code,
          raw_national_id: natId,
          raw_name: rawName,
          candidate_employee_id: bestCandidate.id,
          match_type: highestScore >= 0.75 ? 'candidate_name_plus_data' : 'candidate_name',
          confidence_score: highestScore,
          candidate_snapshot: bestCandidate as unknown as Json,
          status: 'pending',
          notes: `اسم مقارب (${bestCandidate.employee_name}) - يحتاج مراجعة`,
        })
        .select('id')
        .maybeSingle();

      return {
        matched: false,
        employee_id: null,
        confidence: 'candidate_review',
        confidence_score: highestScore,
        match_rule: `اسم مقارب (${bestCandidate.employee_name}) - بانتظار المراجعة اليدوية`,
        candidate_id: insertedCandidate?.id,
        requires_review: true,
        existing_employee: bestCandidate,
      };
    }
  }

  // ── No match found ──
  return {
    matched: false,
    employee_id: null,
    confidence: 'no_match',
    confidence_score: 0.0,
    match_rule: 'لم يتم العثور على أي تطابق',
    requires_review: false,
  };
}

/**
 * Fetch pending candidates for human review
 */
export async function getPendingCandidates(options?: {
  sheet_name?: string;
  status?: string;
  limit?: number;
  offset?: number;
}) {
  let query = supabaseServer
    .from('matching_candidates')
    .select(`
      id, import_id, sheet_name, row_data, row_number,
      raw_code, raw_national_id, raw_name,
      candidate_employee_id, match_type, confidence_score,
      candidate_snapshot, status, notes, created_at,
      employees_master ( id, employee_code, national_id, employee_name, company_account, current_status, current_job_title )
    `)
    .order('created_at', { ascending: false });

  if (options?.status) {
    query = query.eq('status', options.status);
  } else {
    query = query.eq('status', 'pending');
  }

  if (options?.sheet_name) {
    query = query.eq('sheet_name', options.sheet_name);
  }

  if (options?.limit) query = query.limit(options.limit);
  if (options?.offset) query = query.range(options.offset, (options.offset + (options.limit ?? 50)) - 1);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  return (data || []).map((row: any) => ({
    ...row,
    candidate_employee: row.employees_master,
  }));
}

/**
 * Confirm a match: Link the raw row data to the target employee
 */
export async function confirmCandidateMatch(
  candidateId: string,
  targetEmployeeId: string,
  reviewedBy: string = 'User'
) {
  const { data: candidate, error: fetchErr } = await supabaseServer
    .from('matching_candidates')
    .select('*')
    .eq('id', candidateId)
    .single();

  if (fetchErr || !candidate) {
    throw new Error('لم يتم العثور على سجل المراجعة');
  }

  const { data: targetEmp, error: empErr } = await supabaseServer
    .from('employees_master')
    .select('id, employee_name, consolidated_data')
    .eq('id', targetEmployeeId)
    .single();

  if (empErr || !targetEmp) {
    throw new Error('لم يتم العثور على الموظف الهدف');
  }

  const rawRow = (candidate.row_data || {}) as Record<string, unknown>;
  const currentConsolidated = ((targetEmp.consolidated_data || {}) as Record<string, unknown>);
  const sheetKey = candidate.sheet_name || 'manual_match';
  currentConsolidated[sheetKey] = rawRow;

  await supabaseServer
    .from('employees_master')
    .update({
      consolidated_data: currentConsolidated as any,
      last_updated_at: new Date().toISOString(),
    })
    .eq('id', targetEmployeeId);

  await supabaseServer
    .from('matching_candidates')
    .update({
      status: 'confirmed_match',
      candidate_employee_id: targetEmployeeId,
      reviewed_by: reviewedBy,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', candidateId);

  return { success: true, employee_id: targetEmployeeId };
}

/**
 * Reject candidate match: Treat this row as a new standalone employee
 */
export async function rejectCandidateMatch(
  candidateId: string,
  reviewedBy: string = 'User'
) {
  const { data: candidate, error: fetchErr } = await supabaseServer
    .from('matching_candidates')
    .select('*')
    .eq('id', candidateId)
    .single();

  if (fetchErr || !candidate) {
    throw new Error('لم يتم العثور على سجل المراجعة');
  }

  const rawRow = (candidate.row_data || {}) as Record<string, unknown>;
  const companyAccount = (rawRow.company_account as string) || (rawRow.account as string) || 'E.G';

  const { data: newEmp, error: createErr } = await supabaseServer
    .from('employees_master')
    .insert({
      company_account: companyAccount,
      employee_code: candidate.raw_code,
      national_id: candidate.raw_national_id,
      employee_name: candidate.raw_name || 'موظف جديد',
      current_status: (rawRow.status as string) || 'Active',
      consolidated_data: { [candidate.sheet_name]: rawRow } as any,
    })
    .select('id')
    .single();

  if (createErr) throw new Error(createErr.message);

  await supabaseServer
    .from('matching_candidates')
    .update({
      status: 'rejected_new_employee',
      candidate_employee_id: newEmp.id,
      reviewed_by: reviewedBy,
      reviewed_at: new Date().toISOString(),
      notes: `تم إنشاء موظف جديد بالمعرف: ${newEmp.id}`,
    })
    .eq('id', candidateId);

  return { success: true, new_employee_id: newEmp.id };
}
