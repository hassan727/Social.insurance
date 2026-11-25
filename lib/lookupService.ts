import { supabaseServer } from '@/lib/supabaseServer';
import { resolveAccountRecord } from '@/lib/accountResolver';

export interface S1CalculationInfo {
  calculatedDate: string | null;
  formula: string;
  sourceMonth: number | null;
  sourceYear: number | null;
  daysInMonth: number | null;
  attendanceDays: number | null;
  recordedDate?: string | null;
  status: 'calculated' | 'insufficient_data' | 'manual_review';
  message: string;
}

export interface S6CalculationInfo {
  calculatedDate: string | null;
  formula: string;
  sourceMonth: number | null;
  sourceYear: number | null;
  daysInMonth: number | null;
  workDays: number | null;
  recordedDate?: string | null;
  resignationType?: string | null;
  status: 'active' | 'calculated' | 'recorded' | 'insufficient_data';
  message: string;
}

export function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

export function computeS1Date(
  year: number | null | undefined,
  month: number | null | undefined,
  rawAttendance: unknown,
  recordedDate?: string | null
): S1CalculationInfo {
  if (!year || !month) {
    return {
      calculatedDate: null,
      formula: '',
      sourceMonth: null,
      sourceYear: null,
      daysInMonth: null,
      attendanceDays: null,
      recordedDate: recordedDate || null,
      status: 'insufficient_data',
      message: recordedDate ? `مسجل بالدفاتر: ${recordedDate}` : 'لا توجد بيانات شهرية لحساب بداية الاشتراك (يحتاج مراجعة يدوية)',
    };
  }

  const daysInMonth = getDaysInMonth(year, month);
  let att: number | null = null;
  if (typeof rawAttendance === 'number') {
    att = rawAttendance;
  } else if (rawAttendance !== null && rawAttendance !== undefined && String(rawAttendance).trim() !== '') {
    const cleaned = parseFloat(String(rawAttendance).replace(/[^\d.]/g, ''));
    if (!isNaN(cleaned)) att = cleaned;
  }

  if (att === null || att <= 0) {
    return {
      calculatedDate: null,
      formula: '',
      sourceMonth: month,
      sourceYear: year,
      daysInMonth,
      attendanceDays: 0,
      recordedDate: recordedDate || null,
      status: 'insufficient_data',
      message: recordedDate ? `مسجل بالدفاتر: ${recordedDate}` : `حضور شهر ${month}/${year} غير مسجل أو 0 (يحتاج مراجعة يدوية)`,
    };
  }

  if (att > daysInMonth) {
    return {
      calculatedDate: null,
      formula: `${daysInMonth} - ${att} + 1`,
      sourceMonth: month,
      sourceYear: year,
      daysInMonth,
      attendanceDays: att,
      recordedDate: recordedDate || null,
      status: 'manual_review',
      message: `أيام الحضور (${att}) تتجاوز أيام الشهر (${daysInMonth}) — يحتاج مراجعة يدوية`,
    };
  }

  const day = Math.round((daysInMonth - att) + 1);
  const dayStr = String(day).padStart(2, '0');
  const monthStr = String(month).padStart(2, '0');
  const calculatedDate = `${dayStr}/${monthStr}/${year}`;
  const formula = `${daysInMonth} - ${att} + 1 = ${day} (${calculatedDate})`;

  return {
    calculatedDate,
    formula,
    sourceMonth: month,
    sourceYear: year,
    daysInMonth,
    attendanceDays: att,
    recordedDate: recordedDate || null,
    status: 'calculated',
    message: `محسوب من حضور شهر ${month}/${year} (${att} يوم عمل من أصل ${daysInMonth} يوم)`,
  };
}

export function computeS6Date(
  year: number | null | undefined,
  month: number | null | undefined,
  rawAttendance: unknown,
  isActive: boolean,
  hasResignation: boolean,
  recordedEndDate?: string | null,
  resignationType?: string | null
): S6CalculationInfo {
  // If active and no resignation record, S6 does not apply
  if (isActive && !hasResignation) {
    return {
      calculatedDate: null,
      formula: '',
      sourceMonth: month || null,
      sourceYear: year || null,
      daysInMonth: (year && month) ? getDaysInMonth(year, month) : null,
      workDays: null,
      recordedDate: null,
      resignationType: null,
      status: 'active',
      message: 'الموظف مستمر بالخدمة (Active) — لا تنطبق استمارة س6 حالياً',
    };
  }

  // If there is an explicit recorded resignation date / last working day
  if (recordedEndDate) {
    return {
      calculatedDate: recordedEndDate,
      formula: 'تاريخ مسجل بملف الاستقالات (RES)',
      sourceMonth: month || null,
      sourceYear: year || null,
      daysInMonth: (year && month) ? getDaysInMonth(year, month) : null,
      workDays: null,
      recordedDate: recordedEndDate,
      resignationType: resignationType || null,
      status: 'recorded',
      message: `مسجل بملف الاستقالات: ${recordedEndDate} ${resignationType ? `(${resignationType})` : ''}`.trim(),
    };
  }

  if (!year || !month) {
    return {
      calculatedDate: null,
      formula: '',
      sourceMonth: null,
      sourceYear: null,
      daysInMonth: null,
      workDays: null,
      recordedDate: null,
      resignationType: resignationType || null,
      status: 'insufficient_data',
      message: 'لا توجد بيانات لآخر شهر عمل (يحتاج مراجعة يدوية)',
    };
  }

  const daysInMonth = getDaysInMonth(year, month);
  let att: number | null = null;
  if (typeof rawAttendance === 'number') {
    att = rawAttendance;
  } else if (rawAttendance !== null && rawAttendance !== undefined && String(rawAttendance).trim() !== '') {
    const cleaned = parseFloat(String(rawAttendance).replace(/[^\d.]/g, ''));
    if (!isNaN(cleaned)) att = cleaned;
  }

  if (att === null || att <= 0) {
    return {
      calculatedDate: null,
      formula: '',
      sourceMonth: month,
      sourceYear: year,
      daysInMonth,
      workDays: 0,
      recordedDate: null,
      resignationType: resignationType || null,
      status: 'insufficient_data',
      message: `أيام العمل في آخر شهر (${month}/${year}) غير مسجلة (يحتاج مراجعة يدوية)`,
    };
  }

  const day = Math.min(Math.round(att), daysInMonth);
  const dayStr = String(day).padStart(2, '0');
  const monthStr = String(month).padStart(2, '0');
  const calculatedDate = `${dayStr}/${monthStr}/${year}`;
  const formula = `تاريخ نهاية العمل = ${day} (${calculatedDate}) وفق فرضية بدء العمل من أول الشهر`;

  return {
    calculatedDate,
    formula,
    sourceMonth: month,
    sourceYear: year,
    daysInMonth,
    workDays: att,
    recordedDate: null,
    resignationType: resignationType || null,
    status: 'calculated',
    message: `محسوب من آخر شهر عمل ${month}/${year} (${att} يوم عمل)`,
  };
}

export interface SearchCandidate {
  id: string;
  national_id: string | null;
  employee_code: string | null;
  employee_name: string | null;
  source: string;
  source_label: string;
  company_account?: string | null;
  account_display?: {
    status: 'resolved' | 'conflict' | 'single' | 'unknown';
    code: string | null;
    masterCode: string | null;
    waradCode: string | null;
  };
  first_both_month?: string | null;
  first_both_year?: number | null;
  first_both_m?: number | null;
  attendance_days?: string | null;
  insurance_status?: string | null;
  insurance_number?: string | null;
  job_title?: string | null;
  insurance_job_title?: string | null;
  phone_number?: string | null;
  subscription_start_date?: string | null;
  subscription_end_date?: string | null;
  hire_date?: string | null;
  status?: string | null;
  has_resignation?: boolean;
  resignation_summary?: string;
  sources?: string[];
  joint_periods?: string[];
  target_month_status?: {
    year: number;
    month: number;
    inPayroll: boolean;
    inInsurance: boolean;
    inBoth: boolean;
    attendance_days?: string | null;
    statusLabel: string;
  } | null;
  s1_info?: S1CalculationInfo;
  s6_info?: S6CalculationInfo;
}

type PersonDraft = {
  id: string;
  national_id: string | null;
  employee_code: string | null;
  employee_name: string | null;
  company_account: string | null;
  status: string | null;
  insurance_status: string | null;
  insurance_number?: string | null;
  job_title?: string | null;
  insurance_job_title?: string | null;
  subscription_start_date?: string | null;
  subscription_end_date?: string | null;
  hire_date?: string | null;
  phone_number?: string | null;
  masterAccountRaw?: string | null;
  waradAccountRaw?: string | null;
  sources: Set<string>;
};

function getPersonKey(r: { national_id?: string | null; employee_code?: string | null; employee_name?: string | null }) {
  if (r.national_id && r.national_id.trim()) return `nat_${r.national_id.trim()}`;
  if (r.employee_code && r.employee_code.trim()) return `code_${r.employee_code.trim()}`;
  if (r.employee_name && r.employee_name.trim()) return `name_${r.employee_name.trim()}`;
  return null;
}

function mergeIntoPersonMap(
  personMap: Map<string, PersonDraft>,
  records: Array<{
    id: string;
    national_id?: string | null;
    employee_code?: string | null;
    employee_name?: string | null;
    company_account?: string | null;
    status?: string | null;
    current_status?: string | null;
    insurance_status?: string | null;
    insurance_number?: string | null;
    job_title?: string | null;
    current_job_title?: string | null;
    insurance_job_title?: string | null;
    subscription_start_date?: string | null;
    insurance_start_date?: string | null;
    subscription_end_date?: string | null;
    hire_date?: string | null;
    phone_number?: string | null;
  }>,
  source: string
) {
  for (const raw of records) {
    const r = {
      id: raw.id,
      national_id: raw.national_id ? String(raw.national_id).trim() : null,
      employee_code: raw.employee_code ? String(raw.employee_code).trim() : null,
      employee_name: raw.employee_name ? String(raw.employee_name).trim() : null,
      company_account: raw.company_account ? String(raw.company_account).trim() : null,
      status: (raw.current_status || raw.status) ? String(raw.current_status || raw.status).trim() : null,
      insurance_status: raw.insurance_status ? String(raw.insurance_status).trim() : null,
      insurance_number: raw.insurance_number ? String(raw.insurance_number).trim() : null,
      job_title: (raw.current_job_title || raw.job_title) ? String(raw.current_job_title || raw.job_title).trim() : null,
      insurance_job_title: raw.insurance_job_title ? String(raw.insurance_job_title).trim() : null,
      subscription_start_date: (raw.insurance_start_date || raw.subscription_start_date) ? String(raw.insurance_start_date || raw.subscription_start_date).trim() : null,
      subscription_end_date: raw.subscription_end_date ? String(raw.subscription_end_date).trim() : null,
      hire_date: raw.hire_date ? String(raw.hire_date).trim() : null,
      phone_number: raw.phone_number ? String(raw.phone_number).trim() : null,
    };

    const key = getPersonKey(r);
    if (!key) continue;

    const existing = personMap.get(key);
    if (!existing) {
      personMap.set(key, {
        id: r.id,
        national_id: r.national_id,
        employee_code: r.employee_code,
        employee_name: r.employee_name,
        company_account: r.company_account,
        masterAccountRaw: source === 'سجل الموظفين Master' ? r.company_account : null,
        waradAccountRaw: source === 'وارد التأمين' ? r.company_account : null,
        status: r.status,
        insurance_status: r.insurance_status,
        insurance_number: r.insurance_number,
        job_title: r.job_title,
        insurance_job_title: r.insurance_job_title,
        subscription_start_date: r.subscription_start_date,
        subscription_end_date: r.subscription_end_date,
        hire_date: r.hire_date,
        phone_number: r.phone_number,
        sources: new Set([source]),
      });
    } else {
      existing.sources.add(source);
      if (!existing.national_id && r.national_id) existing.national_id = r.national_id;
      if (!existing.employee_code && r.employee_code) existing.employee_code = r.employee_code;
      if ((!existing.employee_name || existing.employee_name === 'بدون اسم') && r.employee_name) {
        existing.employee_name = r.employee_name;
      }
      if (!existing.company_account && r.company_account) existing.company_account = r.company_account;
      if (source === 'سجل الموظفين Master' && !existing.masterAccountRaw && r.company_account) existing.masterAccountRaw = r.company_account;
      if (source === 'وارد التأمين' && !existing.waradAccountRaw && r.company_account) existing.waradAccountRaw = r.company_account;
      if (!existing.status && r.status) existing.status = r.status;
      if (!existing.insurance_status && r.insurance_status) existing.insurance_status = r.insurance_status;
      if (!existing.insurance_number && r.insurance_number) existing.insurance_number = r.insurance_number;
      if (!existing.job_title && r.job_title) existing.job_title = r.job_title;
      if (!existing.insurance_job_title && r.insurance_job_title) existing.insurance_job_title = r.insurance_job_title;
      if (!existing.subscription_start_date && r.subscription_start_date) existing.subscription_start_date = r.subscription_start_date;
      if (!existing.subscription_end_date && r.subscription_end_date) existing.subscription_end_date = r.subscription_end_date;
      if (!existing.hire_date && r.hire_date) existing.hire_date = r.hire_date;
      if (!existing.phone_number && r.phone_number) existing.phone_number = r.phone_number;
    }
  }
}

/**
 * Enriches candidate drafts with full monthly attendance, S1/S6 readiness, and resignation data
 */
async function enrichPersonDrafts(
  distinctPeople: PersonDraft[],
  targetYear?: number,
  targetMonth?: number
): Promise<SearchCandidate[]> {
  return Promise.all(
    distinctPeople.map(async (p) => {
      // Build conditions for matching this person
      const orConds: string[] = [];
      const cleanDraftNid = p.national_id ? p.national_id.replace(/\D/g, '') : '';
      if (cleanDraftNid.length === 14) {
        // STRICT ISOLATION: When a 14-digit National ID is present, NEVER cross-match on employee_code with OR!
        orConds.push(`national_id.eq.${cleanDraftNid}`);
      } else {
        if (p.national_id) orConds.push(`national_id.eq.${p.national_id}`);
        if (p.employee_code) orConds.push(`employee_code.eq.${p.employee_code}`);
      }

      let companyAccount = p.company_account;
      let insuranceStatus = p.insurance_status;
      let status = p.status;
      let hasResignation = false;
      let resignationSummary = 'لا توجد استقالة (مستمر)';
      let firstBothMonth: string | null = null;
      let firstBothYear: number | null = null;
      let firstBothM: number | null = null;
      let attendanceDays: string | null = null;
      const jointPeriods: string[] = [];
      let targetMonthStatus: {
        year: number;
        month: number;
        inPayroll: boolean;
        inInsurance: boolean;
        inBoth: boolean;
        attendance_days: string | null;
        statusLabel: string;
      } | null = null;
      let accountDisplay: SearchCandidate['account_display'] = undefined;

      if (orConds.length > 0) {
        const orClause = orConds.join(',');

        const [incomingRes, payData, miData, resData, masterData] = await Promise.all([
          // Fetch from incoming_insurance (ordered latest first)
          supabaseServer
            .from('incoming_insurance_records')
            .select('company_account, status, insurance_status, employee_name, insurance_number, job_title, insurance_job_title, subscription_start_date, subscription_end_date, termination_reason')
            .or(orClause)
            .order('created_at', { ascending: false })
            .limit(5),

          // Fetch all payroll records ordered ascending
          supabaseServer
            .from('monthly_payroll_records')
            .select('period_year, period_month, attendance_days')
            .or(orClause)
            .order('period_year', { ascending: true })
            .order('period_month', { ascending: true }),

          // Fetch all monthly insurance records ordered ascending
          supabaseServer
            .from('monthly_insurance_records')
            .select('period_year, period_month')
            .or(orClause)
            .order('period_year', { ascending: true })
            .order('period_month', { ascending: true }),

          // Fetch resignation records
          supabaseServer
            .from('resignation_records')
            .select('resignation_date, resignation_type, last_working_day')
            .or(orClause)
            .limit(1)
            .maybeSingle(),

          // Fetch from employees_master
          supabaseServer
            .from('employees_master')
            .select('company_account, current_status, insurance_status, employee_name, insurance_number, current_job_title, insurance_job_title, insurance_start_date, hire_date, phone_number')
            .or(orClause)
            .limit(1)
            .maybeSingle(),
        ]);

        const incomingRows = incomingRes.data || [];
        const incomingData = {
          data: incomingRows.find(r => r.insurance_number && String(r.insurance_number).trim() !== '0' && r.insurance_status) ||
                incomingRows.find(r => r.insurance_number && String(r.insurance_number).trim() !== '0') ||
                incomingRows.find(r => r.insurance_status) ||
                incomingRows[0] || null
        };

        if (incomingData.data) {
          if (!companyAccount && incomingData.data.company_account) companyAccount = incomingData.data.company_account;
          if (!insuranceStatus && incomingData.data.insurance_status) insuranceStatus = incomingData.data.insurance_status;
          if (!status && incomingData.data.status) status = incomingData.data.status;
          if ((!p.employee_name || p.employee_name === 'بدون اسم') && incomingData.data.employee_name) {
            p.employee_name = incomingData.data.employee_name;
          }
          if (!p.insurance_number && incomingData.data.insurance_number) p.insurance_number = incomingData.data.insurance_number;
          if (!p.job_title && incomingData.data.job_title) p.job_title = incomingData.data.job_title;
          if (!p.insurance_job_title && incomingData.data.insurance_job_title) p.insurance_job_title = incomingData.data.insurance_job_title;
          if (!p.subscription_start_date && incomingData.data.subscription_start_date) p.subscription_start_date = incomingData.data.subscription_start_date;
          if (!p.subscription_end_date && incomingData.data.subscription_end_date) p.subscription_end_date = incomingData.data.subscription_end_date;
        }

        // Dynamic fallback from employees_master if fields missing in incoming_insurance
        if (masterData.data) {
          if (!companyAccount && masterData.data.company_account) companyAccount = masterData.data.company_account;
          if (!insuranceStatus && masterData.data.insurance_status) insuranceStatus = masterData.data.insurance_status;
          if (!status && masterData.data.current_status) status = masterData.data.current_status;
          if ((!p.employee_name || p.employee_name === 'بدون اسم') && masterData.data.employee_name) {
            p.employee_name = masterData.data.employee_name;
          }
          if (!p.insurance_number && masterData.data.insurance_number) p.insurance_number = masterData.data.insurance_number;
          if (!p.job_title && masterData.data.current_job_title) p.job_title = masterData.data.current_job_title;
          if (!p.insurance_job_title && masterData.data.insurance_job_title) p.insurance_job_title = masterData.data.insurance_job_title;
          if (!p.subscription_start_date && masterData.data.insurance_start_date) p.subscription_start_date = masterData.data.insurance_start_date;
          if (!p.hire_date && masterData.data.hire_date) p.hire_date = masterData.data.hire_date;
          if (!p.phone_number && masterData.data.phone_number) p.phone_number = masterData.data.phone_number;
        }

        // ── Account display (fail-closed): resolve BOTH sources against
        // company_accounts. A master-vs-warad contradiction must never render
        // as one definitive company, and monthly claims built from unscoped
        // rows are withheld while the account is unresolved.
        const masterRaw = p.masterAccountRaw || (masterData.data?.company_account as string) || null;
        const waradRaw = p.waradAccountRaw || (incomingData.data?.company_account as string) || null;
        const [masterAcc, waradAcc] = await Promise.all([
          masterRaw ? resolveAccountRecord(masterRaw) : Promise.resolve(null),
          waradRaw ? resolveAccountRecord(waradRaw) : Promise.resolve(null),
        ]);
        const isConflict = Boolean(masterAcc && waradAcc && masterAcc.id !== waradAcc.id);
        const resolvedAcc = masterAcc && waradAcc && masterAcc.id === waradAcc.id ? masterAcc : (masterAcc || waradAcc);
        accountDisplay = isConflict
          ? { status: 'conflict' as const, code: null, masterCode: masterAcc?.account_code ?? null, waradCode: waradAcc?.account_code ?? null }
          : resolvedAcc
            ? { status: (masterAcc && waradAcc ? 'resolved' : 'single') as 'resolved' | 'single', code: resolvedAcc.account_code, masterCode: masterAcc?.account_code ?? null, waradCode: waradAcc?.account_code ?? null }
            : { status: 'unknown' as const, code: null, masterCode: null, waradCode: null };
        if (isConflict) {
          companyAccount = null;
        } else if (resolvedAcc) {
          companyAccount = resolvedAcc.account_code;
        }

        const payrolls = payData.data || [];
        const insurances = miData.data || [];
        const resRec = resData.data;

        // Check resignation
        if (resRec) {
          hasResignation = true;
          const rDate = resRec.resignation_date ? `بتاريخ ${resRec.resignation_date}` : '';
          const rType = resRec.resignation_type ? `(${resRec.resignation_type})` : '';
          resignationSummary = `مستقيل ${rDate} ${rType}`.trim();
        }

        // Calculate all joint appearance periods (both payroll and insurance together)
        for (const pr of payrolls) {
          const matchedMi = insurances.find(
            (mi) => mi.period_year === pr.period_year && mi.period_month === pr.period_month
          );
          if (matchedMi) {
            const pKey = `${pr.period_year}-${pr.period_month}`;
            if (!jointPeriods.includes(pKey)) {
              jointPeriods.push(pKey);
            }
            if (!firstBothMonth) {
              firstBothMonth = `${matchedMi.period_month} / ${matchedMi.period_year}`;
              firstBothYear = matchedMi.period_year;
              firstBothM = matchedMi.period_month;
              attendanceDays = pr.attendance_days ? String(pr.attendance_days).trim() : '0';
            }
          }
        }

        // If no joint appearance, check if they appeared in payroll alone
        if (!firstBothMonth) {
          if (payrolls.length > 0) {
            firstBothMonth = 'مرتبات فقط (لم يظهر في التأمينات معاً)';
            attendanceDays = payrolls[0].attendance_days ? String(payrolls[0].attendance_days).trim() : '0';
          } else if (insurances.length > 0) {
            firstBothMonth = 'تأمينات فقط (لم يظهر في المرتبات معاً)';
            attendanceDays = '—';
          } else {
            firstBothMonth = 'لم يظهر في الملفات الشهرية بعد';
            attendanceDays = '—';
          }
        }

        // Calculate status specifically for target requested month if given
        if (targetYear && targetMonth) {
          const matchPay = payrolls.find(
            (p) => p.period_year === targetYear && p.period_month === targetMonth
          );
          const matchIns = insurances.find(
            (m) => m.period_year === targetYear && m.period_month === targetMonth
          );
          const inP = Boolean(matchPay);
          const inI = Boolean(matchIns);
          let label = 'غير مسجل في هذا الشهر';
          if (inP && inI) {
            label = 'موجود في المرتبات والتأمينات معاً';
          } else if (inP) {
            label = 'موجود في المرتبات فقط';
          } else if (inI) {
            label = 'موجود في التأمينات فقط';
          }

          targetMonthStatus = {
            year: targetYear,
            month: targetMonth,
            inPayroll: inP,
            inInsurance: inI,
            inBoth: inP && inI,
            attendance_days: matchPay?.attendance_days ? String(matchPay.attendance_days).trim() : null,
            statusLabel: label,
          };
        }

        // ── S1 Calculation (بداية الاشتراك) ──
        const s1Year = firstBothYear || payrolls[0]?.period_year || (insurances[0]?.period_year as number) || null;
        const s1Month = firstBothM || payrolls[0]?.period_month || (insurances[0]?.period_month as number) || null;
        const s1Att = (firstBothYear && firstBothM)
          ? (payrolls.find(pr => pr.period_year === firstBothYear && pr.period_month === firstBothM)?.attendance_days || attendanceDays)
          : (payrolls[0]?.attendance_days || attendanceDays);
        const recordedS1 = (incomingData?.data?.subscription_start_date as string) || (p.subscription_start_date as string) || null;
        const s1_info = computeS1Date(s1Year, s1Month, s1Att, recordedS1);

        // ── S6 Calculation (نهاية الاشتراك) ──
        const lastPay = payrolls.length > 0 ? payrolls[payrolls.length - 1] : null;
        const lastIns = insurances.length > 0 ? insurances[insurances.length - 1] : null;
        const s6Year = (lastPay?.period_year as number) || (lastIns?.period_year as number) || null;
        const s6Month = (lastPay?.period_month as number) || (lastIns?.period_month as number) || null;
        const s6Att = lastPay?.attendance_days;
        const isEmpActive = !hasResignation && !/استق|منته|resign/i.test(status || '');
        const recordedEndDate = (resRec?.last_working_day as string) || (resRec?.resignation_date as string) || (incomingData?.data?.subscription_end_date as string) || (p.subscription_end_date as string) || null;
        const resType = (resRec?.resignation_type as string) || (incomingData?.data?.termination_reason as string) || null;
        const s6_info = computeS6Date(s6Year, s6Month, s6Att, isEmpActive, hasResignation, recordedEndDate, resType);

        // Fail-closed on unresolved account conflict: withhold every
        // monthly-derived claim (they are computed from rows that are NOT
        // account-scoped at this level) and never present absence of monthly
        // evidence as affirmative employment/termination.
        const withhold = accountDisplay?.status === 'conflict';
        const withheldS6: S6CalculationInfo = {
          calculatedDate: null, formula: '—', sourceMonth: null, sourceYear: null,
          daysInMonth: null, workDays: null, recordedDate: recordedEndDate, resignationType: resType,
          status: 'insufficient_data',
          message: 'لا يمكن احتساب س6 — حساب الموظف غير محسوم (تعارض بين الدليل ووارد التأمين) — يحتاج مراجعة',
        };

        return {
          id: p.id,
          national_id: p.national_id,
          employee_code: p.employee_code,
          employee_name: p.employee_name || 'بدون اسم',
          company_account: withhold ? '—' : (companyAccount || '—'),
          account_display: accountDisplay,
          first_both_month: withhold ? 'محجوب — حساب غير محسوم' : (firstBothMonth || 'غير متوفر'),
          first_both_year: withhold ? null : firstBothYear,
          first_both_m: withhold ? null : firstBothM,
          attendance_days: withhold ? '—' : (attendanceDays || '—'),
          insurance_status: insuranceStatus || 'غير مسجل',
          insurance_number: p.insurance_number || (incomingData?.data?.insurance_number as string) || null,
          job_title: p.job_title || (incomingData?.data?.job_title as string) || null,
          insurance_job_title: p.insurance_job_title || (incomingData?.data?.insurance_job_title as string) || null,
          subscription_start_date: p.subscription_start_date || (incomingData?.data?.subscription_start_date as string) || null,
          subscription_end_date: p.subscription_end_date || (incomingData?.data?.subscription_end_date as string) || null,
          hire_date: p.hire_date || null,
          phone_number: p.phone_number || null,
          status: status || '—',
          has_resignation: hasResignation,
          resignation_summary: resignationSummary,
          source: 'consolidated',
          source_label: Array.from(p.sources).join(' • '),
          sources: Array.from(p.sources),
          joint_periods: withhold ? [] : jointPeriods,
          target_month_status: withhold ? null : targetMonthStatus,
          s1_info: withhold ? undefined : s1_info,
          s6_info: withhold ? withheldS6 : s6_info,
        };
      }

      return {
        id: p.id,
        national_id: p.national_id,
        employee_code: p.employee_code,
        employee_name: p.employee_name || 'بدون اسم',
        company_account: companyAccount || '—',
        account_display: accountDisplay,
        first_both_month: firstBothMonth || 'غير متوفر',
        first_both_year: firstBothYear,
        first_both_m: firstBothM,
        attendance_days: attendanceDays || '—',
        insurance_status: insuranceStatus || 'غير مسجل',
        insurance_number: p.insurance_number || null,
        job_title: p.job_title || null,
        insurance_job_title: p.insurance_job_title || null,
        subscription_start_date: p.subscription_start_date || null,
        subscription_end_date: p.subscription_end_date || null,
        hire_date: p.hire_date || null,
        phone_number: p.phone_number || null,
        status: status || '—',
        has_resignation: hasResignation,
        resignation_summary: resignationSummary,
        source: 'consolidated',
        source_label: Array.from(p.sources).join(' • '),
        sources: Array.from(p.sources),
        joint_periods: jointPeriods,
        target_month_status: targetMonthStatus,
      };
    })
  );
}

/**
 * Intelligent, Hierarchical, Zero-AI Employee Search
 * Handles:
 *  1. Batch Search: Pasting multiple IDs/Codes separated by commas or newlines (1 to 100 items) -> returns all of them!
 *  2. Exact 14-digit National ID: Strictly exact match (`eq`) -> returns strictly that 1 employee!
 *  3. Exact Employee Code or Insurance Number -> returns exact matching employee(s)!
 *  4. Prefix search for active typing (starts-with only, never middle wildcard!)
 *  5. Text / Name search (ranked by prefix match first)
 */
/**
 * Search employees across all datasets — STRICTLY BY NATIONAL ID (14 digits) ONLY.
 * Searching by employee code, insurance number, or names is intentionally disabled
 * to prevent duplicate mass entries and keep the search history log accurate and uncluttered.
 *
 * Supported formats:
 *  1. Exactly 14 digits National ID (single query)
 *  2. Multiple 14-digit National IDs separated by commas or newlines (batch query)
 */
export async function searchEmployees(
  query: string,
  targetYear?: number,
  targetMonth?: number
): Promise<SearchCandidate[]> {
  const rawQ = (query || '').trim();
  if (!rawQ) return [];

  // 1. Detect if input contains multiple lines or commas (Batch Search by 14-digit National IDs)
  const tokens = rawQ
    .split(/[\r\n,]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);

  // ── BATCH SEARCH MODE (e.g. 2 to 100 National IDs pasted at once) ─
  if (tokens.length > 1) {
    const personMap = new Map<string, PersonDraft>();
    const batchNatIds: string[] = [];

    for (const tok of tokens) {
      const d = tok.replace(/\D/g, '');
      if (d.length === 14) batchNatIds.push(d);
    }

    if (batchNatIds.length > 0) {
      const [mRes, iRes, pRes, miRes, rRes] = await Promise.all([
        supabaseServer.from('employees_master').select('*').in('national_id', batchNatIds),
        supabaseServer.from('incoming_insurance_records').select('*').in('national_id', batchNatIds),
        supabaseServer.from('monthly_payroll_records').select('*').in('national_id', batchNatIds),
        supabaseServer.from('monthly_insurance_records').select('*').in('national_id', batchNatIds),
        supabaseServer.from('resignation_records').select('*').in('national_id', batchNatIds),
      ]);
      mergeIntoPersonMap(personMap, mRes.data || [], 'سجل الموظفين Master');
      mergeIntoPersonMap(personMap, iRes.data || [], 'وارد التأمين');
      mergeIntoPersonMap(personMap, pRes.data || [], 'المرتبات');
      mergeIntoPersonMap(personMap, miRes.data || [], 'التأمينات');
      mergeIntoPersonMap(personMap, rRes.data || [], 'الاستقالات');

      const distinct = Array.from(personMap.values()).slice(0, 100);
      return enrichPersonDrafts(distinct, targetYear, targetMonth);
    }

    return [];
  }

  // ── SINGLE ITEM SEARCH MODE: STRICT 14-DIGIT NATIONAL ID ONLY ──
  const q = tokens[0] || rawQ;
  const digitsOnly = q.replace(/\D/g, '');

  if (digitsOnly.length === 14) {
    const personMap = new Map<string, PersonDraft>();

    const [masterRes, insRes, payRes, miRes, resRes] = await Promise.all([
      supabaseServer.from('employees_master').select('*').eq('national_id', digitsOnly).limit(5),
      supabaseServer.from('incoming_insurance_records').select('*').eq('national_id', digitsOnly).limit(5),
      supabaseServer.from('monthly_payroll_records').select('*').eq('national_id', digitsOnly).limit(5),
      supabaseServer.from('monthly_insurance_records').select('*').eq('national_id', digitsOnly).limit(5),
      supabaseServer.from('resignation_records').select('*').eq('national_id', digitsOnly).limit(5),
    ]);

    mergeIntoPersonMap(personMap, masterRes.data || [], 'سجل الموظفين Master');
    mergeIntoPersonMap(personMap, insRes.data || [], 'وارد التأمين');
    mergeIntoPersonMap(personMap, payRes.data || [], 'المرتبات');
    mergeIntoPersonMap(personMap, miRes.data || [], 'التأمينات');
    mergeIntoPersonMap(personMap, resRes.data || [], 'الاستقالات');

    // Strict filter: only people who actually have this exact 14-digit national ID
    const distinct = Array.from(personMap.values()).filter(p => p.national_id === digitsOnly);
    if (distinct.length > 0) {
      return enrichPersonDrafts(distinct, targetYear, targetMonth);
    }
    return [];
  }

  // If not exactly 14 digits, do not search by codes, insurance numbers, or names
  return [];
}

export interface MonthAvailability {
  year: number;
  month: number;
  hasPayroll: boolean;
  hasInsurance: boolean;
}

export async function getAvailableImportedPeriods(accountId?: number | null): Promise<MonthAvailability[]> {
  let logsQuery = supabaseServer
    .from('import_logs')
    .select('source_type, period_year, period_month')
    .not('period_year', 'is', null)
    .not('period_month', 'is', null);
  // When an account is known, only that account's imported periods count —
  // another company's file must never light this employee's month chips.
  if (accountId !== undefined && accountId !== null) {
    logsQuery = logsQuery.eq('account_id', accountId);
  }
  const { data: logs } = await logsQuery;

  const periodsMap = new Map<string, { year: number; month: number; hasPayroll: boolean; hasInsurance: boolean }>();

  (logs || []).forEach((log) => {
    if (log.period_year && log.period_month) {
      const key = `${log.period_year}-${String(log.period_month).padStart(2, '0')}`;
      const entry = periodsMap.get(key) || {
        year: log.period_year,
        month: log.period_month,
        hasPayroll: false,
        hasInsurance: false,
      };

      if (log.source_type === 'monthly_payroll') entry.hasPayroll = true;
      if (log.source_type === 'monthly_insurance') entry.hasInsurance = true;

      periodsMap.set(key, entry);
    }
  });

  // Sort periods descending
  return Array.from(periodsMap.values()).sort((a, b) => {
    if (a.year !== b.year) return b.year - a.year;
    return b.month - a.month;
  });
}

export interface UnifiedEmployeeProfile {
  found: boolean;
  masterId?: string | null;
  companyAccount?: string | null;
  employeeCode?: string | null;
  employeeName?: string | null;
  nationalId?: string | null;
  currentStatus?: string | null;
  jobTitle?: string | null;
  region?: string | null;
  department?: string | null;
  hireDate?: string | null;
  phoneNumber?: string | null;
  address?: string | null;
  notes?: string | null;

  // Sheet-specific sections
  archives?: {
    contract?: string | null;
    idCard?: string | null;
    qualification?: string | null;
    military?: string | null;
    birthCertificate?: string | null;
    workPermit?: string | null;
    criminalRecord?: string | null;
    photos?: string | null;
    skillTest?: string | null;
    scan?: string | null;
    completenessScore: number;
    missingCount: number;
    availableCount: number;
    raw?: Record<string, unknown> | null;
  } | null;

  medical?: {
    exam111Status?: string | null;
    medicalCardStatus?: string | null;
    receiveDate?: string | null;
    issueDate?: string | null;
    renewal1?: string | null;
    renewal2?: string | null;
    privateMedical?: string | null;
    batch?: string | null;
    sendDate?: string | null;
    raw?: Record<string, unknown> | null;
  } | null;

  bank?: {
    saib?: string | null;
    cib?: string | null;
    adib?: string | null;
    dopay?: string | null;
    bankTransfer?: string | null;
    primaryBank?: string | null;
    accountNumber?: string | null;
    raw?: Record<string, unknown> | null;
  } | null;

  deductions?: Array<{
    type?: string | null;
    amount?: number | string | null;
    beneficiary?: string | null;
    department?: string | null;
    raw?: Record<string, unknown>;
  }>;

  discrepancies?: Array<{
    note?: string | null;
    actualSite?: string | null;
    region?: string | null;
    hireDate?: string | null;
    raw?: Record<string, unknown>;
  }>;

  requests?: Array<{
    requestType?: string | null;
    status?: string | null;
    date?: string | null;
    recipient?: string | null;
    notes?: string | null;
    raw?: Record<string, unknown>;
  }>;

  workInsurance?: {
    month5?: string | number | null;
    month6?: string | number | null;
    month7?: string | number | null;
    totalMonths?: string | number | null;
    totalSalary?: string | number | null;
    insuranceSalary?: string | number | null;
    raw?: Record<string, unknown> | null;
  } | null;

  socialInsuranceSheet?: {
    insuranceStatus?: string | null;
    insuranceNumber?: string | null;
    insuranceSalary?: string | number | null;
    insuranceJobTitle?: string | null;
    subscriptionStartDate?: string | null;
    supplyMethod?: string | null;
    crmNumber?: string | null;
    raw?: Record<string, unknown> | null;
  } | null;

  allSheetsRaw?: Record<string, Record<string, unknown>>;
}

export interface EmployeeDetailsResult {
  identifiers: {
    national_id: string | null;
    employee_code: string | null;
    employee_name: string | null;
  };
  conflicts: string[];
  // Cross-source field disagreements detected by the consolidation merge:
  // field key -> per-source newest values. The scalar value is WITHHELD
  // (never auto-selected); every competing value is shown with its source.
  field_conflicts?: Record<string, { source: string; value: unknown; at: string }[]>;
  accountDisplay?: {
    status: 'resolved' | 'conflict' | 'unknown';
    code: string | null;
    masterCode: string | null;
    waradCode: string | null;
  };
  latest_evidence?: {
    withheld: boolean;
    payroll: { year: number; month: number; accountCode: string | null } | null;
    insurance: { year: number; month: number; accountCode: string | null } | null;
  };
  incomingInsurance: {
    found: boolean;
    record: Record<string, unknown> | null;
    company_account: string | null; // Account
  };
  resignation: {
    found: boolean;
    records: Record<string, unknown>[];
    message: string;
  };
  firstAppearances: {
    payroll: { year: number; month: number } | null;
    insurance: { year: number; month: number } | null;
    both: { year: number; month: number } | null;
    notes: string;
  };
  allMonthsHistory: {
    year: number;
    month: number;
    payrollImported: boolean;
    insuranceImported: boolean;
    inPayroll: boolean;
    inInsurance: boolean;
    payrollRecord?: Record<string, unknown> | null;
    insuranceRecord?: Record<string, unknown> | null;
    statusSummary: string;
  }[];
  selectedMonthStatus?: {
    year: number;
    month: number;
    payrollImported: boolean;
    insuranceImported: boolean;
    inPayroll: boolean;
    inInsurance: boolean;
    inBoth: boolean;
    status: string;
    details: string;
    payrollRecord?: Record<string, unknown> | null;
    insuranceRecord?: Record<string, unknown> | null;
  };
  unifiedProfile?: UnifiedEmployeeProfile;
  masterStatus?: {
    value: string | null;
    insuranceValue: string | null;
    source: string;
  };
  s1_calculation?: S1CalculationInfo;
  s6_calculation?: S6CalculationInfo;
}

export async function getEmployeeFullDetails(params: {
  national_id?: string | null;
  employee_code?: string | null;
  employee_name?: string | null;
  company_account?: string | null;
  selected_year?: number;
  selected_month?: number;
}): Promise<EmployeeDetailsResult> {
  const { national_id, employee_code, employee_name, company_account: requestedAccount, selected_year, selected_month } = params;
  const conflicts: string[] = [];

  const cleanNid = national_id ? national_id.replace(/\D/g, '') : '';
  const hasValidNid = cleanNid.length === 14;

  // Account catalog FIRST: a requested-account filter must match by account
  // IDENTITY (code/aliases), never by raw text equality — the UI passes the
  // canonical code (MG) while sources store text (m.g / مودرن جاس).
  const { data: allAccounts } = await supabaseServer
    .from('company_accounts')
    .select('id, account_code, aliases')
    .eq('is_active', true);
  const resolveAccountText = (txt: unknown): number | null => {
    const t = String(txt || '').trim().toLowerCase();
    if (!t) return null;
    const m = (allAccounts || []).find(
      (a) => a.account_code.toLowerCase() === t ||
        (Array.isArray(a.aliases) && a.aliases.some((al: string) => al.trim().toLowerCase() === t))
    );
    return m ? (m.id as number) : null;
  };
  const aliasTextsOf = (id: number): string[] => {
    const a = (allAccounts || []).find((x) => x.id === id);
    if (!a) return [];
    return [a.account_code, ...(Array.isArray(a.aliases) ? a.aliases : [])].map((t) => String(t).trim()).filter(Boolean);
  };
  const requestedAccountId = (requestedAccount && requestedAccount !== '—') ? resolveAccountText(requestedAccount) : null;

  // 0. Resolve the employee's master record FIRST (exact national_id), so
  // account evidence is available before any monthly fact is fetched.
  let masterEmp: Record<string, unknown> | null = null;
  if (hasValidNid) {
    let mQuery = supabaseServer.from('employees_master').select('*').eq('national_id', cleanNid);
    if (requestedAccountId !== null) {
      const aliasOr = [`account_id.eq.${requestedAccountId}`, ...aliasTextsOf(requestedAccountId).map((t) => `company_account.ilike.${t}`)].join(',');
      mQuery = mQuery.or(aliasOr);
    } else if (requestedAccount && requestedAccount !== '—') {
      mQuery = mQuery.ilike('company_account', requestedAccount);
    }
    const { data: mData } = await mQuery.limit(1).maybeSingle();
    if (mData) masterEmp = mData;
  }

  // 1. Fetch matching incoming insurance records
  let incomingQuery = supabaseServer.from('incoming_insurance_records').select('*');
  if (hasValidNid) {
    // STRICT ISOLATION: When a 14-digit National ID is provided, ONLY match that exact National ID.
    // Never combine with employee_code using OR, as codes overlap between companies.
    incomingQuery = incomingQuery.eq('national_id', cleanNid).order('created_at', { ascending: false });
  } else {
    const incomingOrConditions: string[] = [];
    if (national_id) incomingOrConditions.push(`national_id.eq.${national_id}`);
    if (employee_code) {
      if (requestedAccountId !== null) {
        const aliasOr = aliasTextsOf(requestedAccountId).map((t) => `company_account.ilike.${t}`).join(',');
        incomingQuery = incomingQuery.eq('employee_code', employee_code).or(aliasOr);
      } else if (requestedAccount && requestedAccount !== '—') {
        incomingQuery = incomingQuery.eq('employee_code', employee_code).ilike('company_account', requestedAccount);
      } else {
        incomingOrConditions.push(`employee_code.eq.${employee_code}`);
      }
    }
    if (incomingOrConditions.length > 0) {
      incomingQuery = incomingQuery.or(incomingOrConditions.join(',')).order('created_at', { ascending: false });
    }
  }

  let incomingRecord: Record<string, unknown> | null = null;
  const { data } = await incomingQuery.limit(10);
  if (data && data.length > 0) {
    let candidatePool = data;
    if (requestedAccount && requestedAccount !== '—') {
      const matchPool = requestedAccountId !== null
        ? data.filter(r => r.company_account && resolveAccountText(r.company_account) === requestedAccountId)
        : data.filter(r => r.company_account && String(r.company_account).trim().toLowerCase() === requestedAccount.trim().toLowerCase());
      if (matchPool.length > 0) candidatePool = matchPool;
    }

    incomingRecord = candidatePool.find(r => r.insurance_number && String(r.insurance_number).trim() !== '0' && r.insurance_status) ||
                     candidatePool.find(r => r.insurance_number && String(r.insurance_number).trim() !== '0') ||
                     candidatePool.find(r => r.insurance_status) ||
                     candidatePool[0];

    // Check for code conflict within THIS person's own records only
    data.forEach((r) => {
      if (hasValidNid && r.national_id === cleanNid && employee_code && r.employee_code && r.employee_code !== employee_code) {
        conflicts.push(`تعارض في أرقام وارد التأمين: الكود المسجل (${employee_code}) يختلف عن الوارد (${r.employee_code})`);
      }
    });
  }

  // 2. Fetch resignation (RES.) records
  let resQuery = supabaseServer.from('resignation_records').select('*');
  if (hasValidNid) {
    resQuery = resQuery.eq('national_id', cleanNid);
  } else {
    const resOrConditions: string[] = [];
    if (national_id) resOrConditions.push(`national_id.eq.${national_id}`);
    if (employee_code) {
      if (requestedAccountId !== null) {
        const aliasOr = aliasTextsOf(requestedAccountId).map((t) => `company_account.ilike.${t}`).join(',');
        resQuery = resQuery.eq('employee_code', employee_code).or(aliasOr);
      } else if (requestedAccount && requestedAccount !== '—') {
        resQuery = resQuery.eq('employee_code', employee_code).ilike('company_account', requestedAccount);
      } else {
        resOrConditions.push(`employee_code.eq.${employee_code}`);
      }
    }
    if (resOrConditions.length > 0) resQuery = resQuery.or(resOrConditions.join(','));
  }

  let resignationRecords: Record<string, unknown>[] = [];
  const { data: resData } = await resQuery.limit(10);
  if (resData) resignationRecords = resData;

  // Account resolution rule (consistent everywhere): scope by account ONLY
  // when master and the warad file's own company text AGREE. A known
  // contradiction (case 1: master says one company, warad says another) is
  // surfaced as a conflict and facts stay UNscoped — never silently filtered
  // by an untrusted source. A single available source scopes with a visible
  // pending-confirmation note. No source at all stays unscoped + noted.
  const masterAccountId = (masterEmp?.account_id as number | null) ?? null;
  const waradAccountId = resolveAccountText(incomingRecord?.company_account);
  let resolvedAccountId: number | null = null;
  let accountContradiction = false;
  if (masterAccountId !== null && waradAccountId !== null) {
    if (masterAccountId === waradAccountId) {
      resolvedAccountId = masterAccountId;
    } else {
      // FAIL CLOSED: a known contradiction withholds attributed monthly
      // facts entirely — an unscoped fetch would merge both accounts' rows
      // into one timeline, which is the original contamination bug.
      accountContradiction = true;
      const codeOf = (id: number) => (allAccounts || []).find((a) => a.id === id)?.account_code ?? String(id);
      conflicts.push(`تعارض حساب: الدليل ينسب الموظف إلى "${codeOf(masterAccountId)}" بينما وارد التأمين ينسبه إلى "${codeOf(waradAccountId)}" — حُجبت السجلات الشهرية حتى حسم الحساب وتحتاج مراجعة`);
    }
  } else if (masterAccountId !== null || waradAccountId !== null) {
    resolvedAccountId = masterAccountId ?? waradAccountId;
    conflicts.push('نسبة الحساب معتمدة على مصدر واحد فقط — تحتاج تأكيداً من المصدر الآخر');
  }

  // When neither source resolves an account, the monthly rows' OWN
  // account_id is the remaining source. If every attributed row agrees on
  // exactly one account, scope to it (single-source, noted). If the rows
  // span several accounts, FAIL CLOSED: withhold them rather than merge.
  let withholdMonthly = resolvedAccountId === null;
  if (resolvedAccountId === null && !accountContradiction && (hasValidNid || employee_code)) {
    const probes: { account_id: number | null }[] = [];
    for (const table of ['monthly_payroll_records', 'monthly_insurance_records'] as const) {
      let q = supabaseServer.from(table).select('account_id');
      if (hasValidNid) q = q.eq('national_id', cleanNid);
      else if (employee_code) q = q.eq('employee_code', employee_code);
      const { data: probeRows } = await q.limit(5000);
      if (probeRows) probes.push(...(probeRows as { account_id: number | null }[]));
    }
    const byAccount = new Map<number, number>();
    let unattributed = 0;
    for (const row of probes) {
      const aid = row.account_id;
      if (aid === null || aid === undefined) unattributed++;
      else byAccount.set(aid, (byAccount.get(aid) ?? 0) + 1);
    }
    const codeOf = (id: number) => (allAccounts || []).find((a) => a.id === id)?.account_code ?? String(id);
    if (byAccount.size === 1) {
      resolvedAccountId = [...byAccount.keys()][0];
      withholdMonthly = false;
      conflicts.push('نسبة الحساب مستمدة من السجلات الشهرية نفسها (مصدر واحد) — تحتاج تأكيداً');
      if (unattributed > 0) {
        conflicts.push(`${unattributed} سجل شهري بلا حساب مؤكد — أُقصي من العرض ويحتاج مراجعة`);
      }
    } else if (byAccount.size > 1) {
      const parts = [...byAccount.entries()].map(([id, n]) => `"${codeOf(id)}" (${n})`);
      conflicts.push(`تعارض حساب: السجلات الشهرية نفسها موزعة على حسابات متعددة: ${parts.join('، ')}${unattributed ? ` إضافة إلى ${unattributed} بلا حساب` : ''} — حُجبت السجلات الشهرية حتى حسم الحساب`);
    } else if (unattributed > 0) {
      conflicts.push(`${unattributed} سجل شهري بلا أي نسبة حساب مؤكدة — حُجبت وتحتاج مراجعة`);
    }
  }

  // 3. Fetch all monthly payroll records for this employee — scoped to the
  // employee's account. Without a national_id or code there is NO fetch at
  // all (a name alone must never pull an unfiltered monthly scan).
  let payrollRecords: Record<string, unknown>[] = [];
  if ((hasValidNid || employee_code) && !withholdMonthly && !accountContradiction) {
    let payrollQuery = supabaseServer.from('monthly_payroll_records').select('*');
    if (hasValidNid) {
      payrollQuery = payrollQuery.eq('national_id', cleanNid);
    } else {
      const payrollOrConditions: string[] = [];
      if (national_id) payrollOrConditions.push(`national_id.eq.${national_id}`);
      if (employee_code) payrollOrConditions.push(`employee_code.eq.${employee_code}`);
      if (payrollOrConditions.length > 0) payrollQuery = payrollQuery.or(payrollOrConditions.join(','));
    }
    if (resolvedAccountId !== null) {
      payrollQuery = payrollQuery.eq('account_id', resolvedAccountId);
    }
    const { data: payData } = await payrollQuery.order('period_year', { ascending: true }).order('period_month', { ascending: true });
    if (payData) payrollRecords = payData;

    // Quarantine surface: same person's rows with NO account attribution are
    // excluded above; count and report them instead of silently mixing.
    if (hasValidNid && resolvedAccountId !== null) {
      const { count: quarantinedPay } = await supabaseServer
        .from('monthly_payroll_records')
        .select('*', { count: 'exact', head: true })
        .eq('national_id', cleanNid)
        .is('account_id', null);
      if (quarantinedPay && quarantinedPay > 0) {
        conflicts.push(`${quarantinedPay} سجل مرتبات شهري للموظف بلا حساب مؤكد — أُقصيت من العرض وتحتاج مراجعة`);
      }
    }
  } else if (employee_name) {
    conflicts.push('البحث بالاسم فقط لا يكفي لجلب السجلات الشهرية — يلزم الرقم القومي أو كود الموظف');
  }

  // 4. Fetch all monthly insurance records for this employee — same
  // account scoping and no-identifier guard as payroll.
  let monthlyInsRecords: Record<string, unknown>[] = [];
  if ((hasValidNid || employee_code) && !withholdMonthly && !accountContradiction) {
    let miQuery = supabaseServer.from('monthly_insurance_records').select('*');
    if (hasValidNid) {
      miQuery = miQuery.eq('national_id', cleanNid);
    } else {
      const miOrConditions: string[] = [];
      if (national_id) miOrConditions.push(`national_id.eq.${national_id}`);
      if (employee_code) miOrConditions.push(`employee_code.eq.${employee_code}`);
      if (miOrConditions.length > 0) miQuery = miQuery.or(miOrConditions.join(','));
    }
    if (resolvedAccountId !== null) {
      miQuery = miQuery.eq('account_id', resolvedAccountId);
    }
    const { data: miData } = await miQuery.order('period_year', { ascending: true }).order('period_month', { ascending: true });
    if (miData) monthlyInsRecords = miData;

    if (hasValidNid && resolvedAccountId !== null) {
      const { count: quarantinedIns } = await supabaseServer
        .from('monthly_insurance_records')
        .select('*', { count: 'exact', head: true })
        .eq('national_id', cleanNid)
        .is('account_id', null);
      if (quarantinedIns && quarantinedIns > 0) {
        conflicts.push(`${quarantinedIns} سجل تأمينات شهري للموظف بلا حساب مؤكد — أُقصيت من العرض وتحتاج مراجعة`);
      }
    }
  }

  // 5. Get available imported periods — for THIS account only
  const availablePeriods = await getAvailableImportedPeriods(resolvedAccountId);

  // Calculate First Appearances strictly from imported and verified data
  let firstPayroll: { year: number; month: number } | null = null;
  let firstInsurance: { year: number; month: number } | null = null;
  let firstBoth: { year: number; month: number } | null = null;

  if (payrollRecords.length > 0) {
    firstPayroll = {
      year: payrollRecords[0].period_year as number,
      month: payrollRecords[0].period_month as number,
    };
  }

  if (monthlyInsRecords.length > 0) {
    firstInsurance = {
      year: monthlyInsRecords[0].period_year as number,
      month: monthlyInsRecords[0].period_month as number,
    };
  }

  // Check months where employee appears in both
  for (const p of payrollRecords) {
    const match = monthlyInsRecords.find(
      (m) => m.period_year === p.period_year && m.period_month === p.period_month
    );
    if (match) {
      firstBoth = {
        year: p.period_year as number,
        month: p.period_month as number,
      };
      break;
    }
  }

  // Build complete history across all imported periods
  const allMonthsHistory = availablePeriods.map((period) => {
    const payRec = payrollRecords.find(
      (p) => p.period_year === period.year && p.period_month === period.month
    );
    const insRec = monthlyInsRecords.find(
      (m) => m.period_year === period.year && m.period_month === period.month
    );

    const inPayroll = Boolean(payRec);
    const inInsurance = Boolean(insRec);

    let statusSummary = '';
    if (!period.hasPayroll && !period.hasInsurance) {
      statusSummary = 'ملفات هذا الشهر غير مستوردة';
    } else if (!period.hasPayroll) {
      statusSummary = inInsurance ? 'موجود في التأمينات (ملف المرتبات غير مستورد)' : 'غير موجود في التأمينات (ملف المرتبات غير مستورد)';
    } else if (!period.hasInsurance) {
      statusSummary = inPayroll ? 'موجود في المرتبات (ملف التأمينات غير مستورد)' : 'غير موجود في المرتبات (ملف التأمينات غير مستورد)';
    } else {
      if (inPayroll && inInsurance) {
        statusSummary = 'موجود في المرتبات والتأمينات';
      } else if (inPayroll) {
        statusSummary = 'موجود في المرتبات فقط';
      } else if (inInsurance) {
        statusSummary = 'موجود في التأمينات فقط';
      } else {
        statusSummary = 'غير موجود في المصدرين';
      }
    }

    return {
      year: period.year,
      month: period.month,
      payrollImported: period.hasPayroll,
      insuranceImported: period.hasInsurance,
      inPayroll,
      inInsurance,
      payrollRecord: payRec || null,
      insuranceRecord: insRec || null,
      statusSummary,
    };
  });

  // Check selected month if provided
  let selectedMonthStatus = undefined;
  if (selected_year && selected_month) {
    const targetPeriod = availablePeriods.find(
      (p) => p.year === selected_year && p.month === selected_month
    );
    const hasPayFile = targetPeriod ? targetPeriod.hasPayroll : false;
    const hasInsFile = targetPeriod ? targetPeriod.hasInsurance : false;

    const payRec = payrollRecords.find(
      (p) => p.period_year === selected_year && p.period_month === selected_month
    );
    const insRec = monthlyInsRecords.find(
      (m) => m.period_year === selected_year && m.period_month === selected_month
    );

    let status = '';
    let details = '';

    if (!hasPayFile && !hasInsFile) {
      status = 'ملفات هذا الشهر غير مستوردة';
      details = `لم يتم استيراد أي ملفات (مرتبات أو تأمينات) لشهر ${selected_month}/${selected_year}. عدم وجود بيانات لا يعني عدم وجود الموظف في الملف الأصلي.`;
    } else if (!hasPayFile) {
      status = insRec ? 'موجود في التأمينات فقط (ملف المرتبات غير مستورد)' : 'غير موجود في التأمينات (ملف المرتبات غير مستورد)';
      details = `ملف التأمينات لشهر ${selected_month}/${selected_year} تم فحصه (${insRec ? 'تم العثور على الموظف' : 'لم يتم العثور على الموظف'}). ملف المرتبات لهذا الشهر لم يتم استيراده بعد.`;
    } else if (!hasInsFile) {
      status = payRec ? 'موجود في المرتبات فقط (ملف التأمينات غير مستورد)' : 'غير موجود في المرتبات (ملف التأمينات غير مستورد)';
      details = `ملف المرتبات لشهر ${selected_month}/${selected_year} تم فحصه (${payRec ? 'تم العثور على الموظف' : 'لم يتم العثور على الموظف'}). ملف التأمينات لهذا الشهر لم يتم استيراده بعد.`;
    } else {
      if (payRec && insRec) {
        status = 'موجود في المرتبات والتأمينات';
        details = `تم العثور على سجل مطابق في كلا المصدرين لشهر ${selected_month}/${selected_year}.`;
      } else if (payRec) {
        status = 'موجود في المرتبات فقط';
        details = `تم العثور على سجل في المرتبات، ولم يتم العثور على سجل مطابق في التأمينات لشهر ${selected_month}/${selected_year}.`;
      } else if (insRec) {
        status = 'موجود في التأمينات فقط';
        details = `تم العثور على سجل في التأمينات، ولم يتم العثور على سجل مطابق في المرتبات لشهر ${selected_month}/${selected_year}.`;
      } else {
        status = 'غير موجود في المصدرين';
        details = `تم فحص ملفي المرتبات والتأمينات لشهر ${selected_month}/${selected_year} ولم يُعثر على سجل مطابق.`;
      }
    }

    selectedMonthStatus = {
      year: selected_year,
      month: selected_month,
      payrollImported: hasPayFile,
      insuranceImported: hasInsFile,
      inPayroll: Boolean(payRec),
      inInsurance: Boolean(insRec),
      inBoth: Boolean(payRec && insRec),
      status,
      details,
      payrollRecord: payRec || null,
      insuranceRecord: insRec || null,
    };
  }

  // 6. Build Unified Employee Profile (ملف الموحد الشامل من جميع أوراق العمل)
  const targetNid = hasValidNid ? cleanNid : (national_id || (incomingRecord?.national_id as string) || '');
  const targetCode = employee_code || (incomingRecord?.employee_code as string) || '';
  const targetName = employee_name || (incomingRecord?.employee_name as string) || '';

  // masterEmp was already resolved above for valid NIDs; try looser matching
  // only when it is still unknown.
  if (!masterEmp) {
    const masterOrConds: string[] = [];
    if (targetNid) masterOrConds.push(`national_id.eq.${targetNid}`);
    if (targetCode) masterOrConds.push(`employee_code.eq.${targetCode}`);

    if (masterOrConds.length > 0) {
      const { data: mData } = await supabaseServer
        .from('employees_master')
        .select('*')
        .or(masterOrConds.join(','))
        .limit(1)
        .maybeSingle();
      if (mData) masterEmp = mData;
    }
  }

  // Fetch sheet_data records for this employee
  const sheetOrConds: string[] = [];
  if (masterEmp?.id) sheetOrConds.push(`employee_id.eq.${masterEmp.id}`);
  if (hasValidNid) {
    sheetOrConds.push(`row_national_id.eq.${cleanNid}`);
  } else {
    if (targetNid) sheetOrConds.push(`row_national_id.eq.${targetNid}`);
    if (targetCode) sheetOrConds.push(`row_code.eq.${targetCode}`);
  }

  let allSheetRecords: Array<{
    sheet_id: string;
    row_data: Record<string, unknown>;
    dynamic_sheets?: { sheet_name: string; display_name: string } | null;
  }> = [];

  if (sheetOrConds.length > 0) {
    const { data: sRows } = await supabaseServer
      .from('sheet_data')
      .select('sheet_id, row_data, dynamic_sheets(sheet_name, display_name)')
      .or(sheetOrConds.join(','))
      .eq('is_latest', true)
      .order('created_at', { ascending: false });
    if (sRows) {
      allSheetRecords = sRows as unknown as typeof allSheetRecords;
    }
  }

  // Fallback search in sheet_data if row_code or row_national_id had shifted columns
  if (allSheetRecords.length === 0 && (hasValidNid || targetCode)) {
    // Attempt finding in sheet_data where row_data contains code or nid
    const { data: fallbackRows } = await supabaseServer
      .from('sheet_data')
      .select('sheet_id, row_data, dynamic_sheets(sheet_name, display_name)')
      .limit(200);

    if (fallbackRows) {
      const filtered = fallbackRows.filter((r) => {
        const str = JSON.stringify(r.row_data);
        if (hasValidNid) return str.includes(cleanNid);
        return targetCode && str.includes(`"${targetCode}"`);
      });
      if (filtered.length > 0) {
        allSheetRecords = filtered as unknown as typeof allSheetRecords;
      }
    }
  }

  // Organize by sheet_name
  const sheetsByName: Record<string, Record<string, unknown>[]> = {};
  for (const sr of allSheetRecords) {
    const sName = sr.dynamic_sheets?.sheet_name || 'unknown';
    if (!sheetsByName[sName]) sheetsByName[sName] = [];
    sheetsByName[sName].push(sr.row_data);
  }

  // 1. Database Sheet
  const dbRow = sheetsByName['Database']?.[0] || {};
  // Handle shifted columns if present
  const isShifted = dbRow.employee_name && /^\d{4,6}$/.test(String(dbRow.employee_name));
  const cleanDbCode = isShifted ? String(dbRow.employee_name) : (dbRow.employee_code ? String(dbRow.employee_code) : targetCode);
  const cleanDbName = isShifted ? String(dbRow.national_id) : (dbRow.employee_name ? String(dbRow.employee_name) : targetName);
  const cleanDbNid = isShifted ? String(dbRow.job_title) : (dbRow.national_id ? String(dbRow.national_id) : targetNid);
  const cleanDbJob = isShifted ? String(dbRow.region) : (dbRow.job_title ? String(dbRow.job_title) : (incomingRecord?.job_title as string) || '');
  const cleanDbRegion = isShifted ? String(dbRow.department) : (dbRow.region ? String(dbRow.region) : '');
  const cleanDbDept = isShifted ? String(dbRow.hire_date) : (dbRow.department ? String(dbRow.department) : '');
  const cleanDbHireDate = isShifted ? String(dbRow.address) : (dbRow.hire_date ? String(dbRow.hire_date) : '');
  const cleanDbAddress = isShifted ? String(dbRow.phone_number) : (dbRow.address ? String(dbRow.address) : '');
  const cleanDbPhone = isShifted ? String(dbRow.status) : (dbRow.phone_number ? String(dbRow.phone_number) : (masterEmp?.phone_number ? String(masterEmp.phone_number) : ''));
  const cleanDbStatus = isShifted ? String(dbRow.note) : (dbRow.status ? String(dbRow.status) : (incomingRecord?.status as string) || 'Active');

  // 2. Archives Sheet (اكتمال مسوغات التعيين)
  const archRow = sheetsByName['Archives']?.[0] || {};
  let archivesData: UnifiedEmployeeProfile['archives'] = null;
  if (Object.keys(archRow).length > 0) {
    const docFields = [
      'contract', 'id_card', 'qualification', 'military',
      'birth_certificate', 'work_permit', 'criminal_record', 'photos', 'skill_test', 'scan'
    ];
    let availableCount = 0;
    let missingCount = 0;
    const isDocPresent = (val: unknown) => {
      const s = String(val || '').trim().toLowerCase();
      return s.includes('يوجد') || s.includes('اصل') || s.includes('أصل') || s.includes('صوره') || s.includes('صورة') || s === 'scan';
    };

    docFields.forEach((f) => {
      if (isDocPresent(archRow[f])) availableCount++;
      else missingCount++;
    });

    const completenessScore = Math.round((availableCount / docFields.length) * 100);

    archivesData = {
      contract: (archRow.contract as string) || null,
      idCard: (archRow.id_card as string) || null,
      qualification: (archRow.qualification as string) || null,
      military: (archRow.military as string) || null,
      birthCertificate: (archRow.birth_certificate as string) || null,
      workPermit: (archRow.work_permit as string) || null,
      criminalRecord: (archRow.criminal_record as string) || null,
      photos: (archRow.photos as string) || null,
      skillTest: (archRow.skill_test as string) || null,
      scan: (archRow.scan as string) || null,
      completenessScore,
      availableCount,
      missingCount,
      raw: archRow,
    };
  }

  // 3. Medical Sheet (الكشف الطبي ونماذج 111)
  const medRow = sheetsByName['Medical']?.[0] || {};
  let medicalData: UnifiedEmployeeProfile['medical'] = null;
  if (Object.keys(medRow).length > 0) {
    medicalData = {
      exam111Status: (medRow['111'] as string) || (medRow.exam_111 as string) || null,
      medicalCardStatus: (medRow.medical_card as string) || (medRow['بطاقه علاجيه'] as string) || null,
      receiveDate: (medRow.receive_date as string) || (medRow['تاريخ الاستلام'] as string) || null,
      issueDate: (medRow.issue_date as string) || (medRow['تاريخ الإصدار'] as string) || null,
      renewal1: (medRow.renewal_1 as string) || (medRow['التجديد الأول'] as string) || null,
      renewal2: (medRow.renewal_2 as string) || (medRow['التجديد التانى'] as string) || null,
      privateMedical: (medRow.private_medical as string) || (medRow['برايفت ميديكال'] as string) || null,
      batch: (medRow.batch as string) || (medRow['الدفعه'] as string) || null,
      sendDate: (medRow.send_date as string) || (medRow['تاريخ الارسال'] as string) || null,
      raw: medRow,
    };
  }

  // 4. Bank ACC. Sheet
  const bankRow = sheetsByName['Bank ACC.']?.[0] || sheetsByName['Bank ACC']?.[0] || {};
  let bankData: UnifiedEmployeeProfile['bank'] = null;
  if (Object.keys(bankRow).length > 0) {
    const saib = (bankRow.SAIB as string) || (bankRow.saib as string) || null;
    const cib = (bankRow.CIB as string) || (bankRow.cib as string) || null;
    const adib = (bankRow.ADIB as string) || (bankRow.adib as string) || null;
    const dopay = (bankRow.DOPAY as string) || (bankRow.dopay as string) || null;
    const transfer = (bankRow['Bank Transfer'] as string) || (bankRow.bank_transfer as string) || null;

    let primaryBank = transfer || '';
    let accountNumber = '';
    if (saib && saib !== '0') { primaryBank = 'SAIB'; accountNumber = saib; }
    else if (cib && cib !== '0') { primaryBank = 'CIB'; accountNumber = cib; }
    else if (adib && adib !== '0') { primaryBank = 'ADIB'; accountNumber = adib; }
    else if (dopay && dopay !== '0') { primaryBank = 'DOPAY'; accountNumber = dopay; }

    bankData = {
      saib,
      cib,
      adib,
      dopay,
      bankTransfer: transfer,
      primaryBank: primaryBank || 'غير محدد',
      accountNumber: accountNumber || '—',
      raw: bankRow,
    };
  }

  // 5. Deductions Sheet
  const deductionRows = sheetsByName['Deductions'] || [];
  const deductionsList = deductionRows.map((d) => ({
    type: (d.deduction_type as string) || (d['نوع الاستقطاع'] as string) || 'نفقة',
    amount: (d.amount as number | string) || (d['المبلغ'] as number | string) || 0,
    beneficiary: (d.beneficiary as string) || (d['المستفيد'] as string) || '—',
    department: (d.department as string) || (d['الاداره'] as string) || '',
    raw: d,
  }));

  // 6. شيت المنقاضات / Discrepancies
  const discRows = sheetsByName['المنقاضات'] || sheetsByName['شيت المنقاضات'] || [];
  const discrepanciesList = discRows.map((dc) => ({
    note: (dc.note as string) || (dc.NOTE as string) || (dc['ملاحظات'] as string) || 'تنبيه تدقيق',
    actualSite: (dc.actual_site as string) || (dc['الموقع الفعلى'] as string) || '',
    region: (dc.region as string) || (dc['المنطقه'] as string) || '',
    hireDate: (dc.hire_date as string) || (dc['تاريخ استلام العمل'] as string) || '',
    raw: dc,
  }));

  // 7. Requests Sheet
  const reqRows = sheetsByName['Requests'] || [];
  const requestsList = reqRows.map((rq) => ({
    requestType: (rq.request as string) || (rq['الطلب'] as string) || 'طلب مستندات',
    status: (rq.status as string) || (rq['الحاله'] as string) || 'جاري',
    date: (rq.date as string) || (rq['التاريخ'] as string) || '',
    recipient: (rq.recipient as string) || (rq['المستلم'] as string) || '',
    notes: (rq.note as string) || (rq['ملاحضات'] as string) || '',
    raw: rq,
  }));

  // Explicit 0 is meaningful and preserved; a missing/blank value is '—',
  // never coerced to an invented 0.
  const pickKeepZero = (...vals: unknown[]): string | number => {
    for (const v of vals) {
      if (v === undefined || v === null) continue;
      if (typeof v === 'string' && v.trim() === '') continue;
      return v as string | number;
    }
    return '—';
  };
  // 8. شغل تأمينات
  const workInsRow = sheetsByName['شغل تامينات']?.[0] || sheetsByName['شغل تامينات ']?.[0] || {};
  let workInsuranceData: UnifiedEmployeeProfile['workInsurance'] = null;
  if (Object.keys(workInsRow).length > 0) {
    workInsuranceData = {
      month5: (workInsRow['شهر 5'] as string | number) || workInsRow.month_5 as string | number || '—',
      month6: (workInsRow['شهر 6'] as string | number) || workInsRow.month_6 as string | number || '—',
      month7: (workInsRow['شهر 7'] as string | number) || workInsRow.month_7 as string | number || '—',
      totalMonths: pickKeepZero(workInsRow['عدد اشهر العمل'], workInsRow.work_months),
      totalSalary: pickKeepZero(workInsRow['الاجر الشامل'], workInsRow.gross_salary),
      insuranceSalary: pickKeepZero(workInsRow['الاجر التامينى'], workInsRow.insurance_salary),
      raw: workInsRow,
    };
  }

  // 9. Social.insurance
  const socialRow = sheetsByName['Social.insurance']?.[0] || {};
  let socialInsData: UnifiedEmployeeProfile['socialInsuranceSheet'] = null;
  if (Object.keys(socialRow).length > 0) {
    socialInsData = {
      insuranceStatus: (socialRow['الحاله التامينيه'] as string) || (socialRow.insurance_status as string) || '',
      insuranceNumber: (socialRow['الرقم التامينى'] as string) || (socialRow.insurance_number as string) || '',
      insuranceSalary: pickKeepZero(socialRow['الاجر التامينى'], socialRow.insurance_salary),
      insuranceJobTitle: (socialRow['الوظيفه في التامينات'] as string) || (socialRow.insurance_job_title as string) || '',
      subscriptionStartDate: (socialRow['تاريخ بدايه الاشتراك'] as string) || (socialRow.subscription_start_date as string) || '',
      supplyMethod: (socialRow['طريقه التوريد'] as string) || (socialRow.supply_method as string) || '',
      crmNumber: (socialRow['رقم ال CRM'] as string) || (socialRow.crm_number as string) || '',
      raw: socialRow,
    };
  }

  const unifiedProfile: UnifiedEmployeeProfile = {
    found: Boolean(masterEmp || allSheetRecords.length > 0 || incomingRecord),
    masterId: masterEmp?.id as string || null,
    companyAccount: (incomingRecord?.company_account as string) || (masterEmp?.company_account as string) || (requestedAccount && requestedAccount !== '—' ? requestedAccount : null), // no default: unknown stays unknown
    employeeCode: cleanDbCode || targetCode,
    employeeName: cleanDbName || targetName,
    nationalId: cleanDbNid || targetNid,
    currentStatus: cleanDbStatus,
    jobTitle: cleanDbJob,
    region: cleanDbRegion,
    department: cleanDbDept,
    hireDate: cleanDbHireDate,
    phoneNumber: cleanDbPhone,
    address: cleanDbAddress,
    notes: (dbRow.note as string) || '',
    archives: archivesData,
    medical: medicalData,
    bank: bankData,
    deductions: deductionsList,
    discrepancies: discrepanciesList,
    requests: requestsList,
    workInsurance: workInsuranceData,
    socialInsuranceSheet: socialInsData,
    allSheetsRaw: Object.fromEntries(
      Object.entries(sheetsByName).map(([k, v]) => [k, v[0] || {}])
    ),
  };

  // Company account: only evidence-supported sources. No fallback.
  const companyAccount = (incomingRecord?.company_account as string) || (masterEmp?.company_account as string) || (requestedAccount && requestedAccount !== '—' ? requestedAccount : null);
  // Explicit account display: an unresolved contradiction must NEVER render
  // as one definitive company. Surface both labeled sources + unresolved.
  const codeOfId = (id: number | null) => id === null ? null : ((allAccounts || []).find((a) => a.id === id)?.account_code ?? String(id));
  const accountDisplay = accountContradiction
    ? { status: 'conflict' as const, code: null as string | null, masterCode: codeOfId(masterAccountId), waradCode: codeOfId(waradAccountId) }
    : resolvedAccountId !== null
      ? { status: 'resolved' as const, code: codeOfId(resolvedAccountId), masterCode: codeOfId(masterAccountId), waradCode: codeOfId(waradAccountId) }
      : { status: 'unknown' as const, code: null as string | null, masterCode: codeOfId(masterAccountId), waradCode: codeOfId(waradAccountId) };

  // Latest EVIDENCED monthly facts. The payroll/insurance period is a real
  // effective date (the month the money/coverage was for) — shown with its
  // account label. Import/upload dates are never presented as freshness.
  // Withheld entirely while the account is unresolved: an un-attributable
  // month is not evidence about THIS employee's company.
  const lastPayEv = payrollRecords.length > 0 ? payrollRecords[payrollRecords.length - 1] : null;
  const lastInsEv = monthlyInsRecords.length > 0 ? monthlyInsRecords[monthlyInsRecords.length - 1] : null;
  const latest_evidence = (withholdMonthly || accountContradiction)
    ? { withheld: true as const, payroll: null, insurance: null }
    : {
        withheld: false as const,
        payroll: lastPayEv
          ? { year: lastPayEv.period_year as number, month: lastPayEv.period_month as number, accountCode: codeOfId(resolvedAccountId) }
          : null,
        insurance: lastInsEv
          ? { year: lastInsEv.period_year as number, month: lastInsEv.period_month as number, accountCode: codeOfId(resolvedAccountId) }
          : null,
      };

  // Source-separated status conflicts: facts from different sources are
  // surfaced side by side, never reconciled by an inferred precedence, and
  // missing payroll is never treated as proof of termination.
  const waradStatus = String(incomingRecord?.status || '');
  const waradLooksActive = /مستمر|active|نشط/i.test(waradStatus) && !/غير|not/i.test(waradStatus);
  const masterStatusStr = String(masterEmp?.current_status || '');
  const masterLooksInactive = /غير|not active|منته|ملغ/i.test(masterStatusStr);
  const masterLooksActive = /مستمر|active|نشط/i.test(masterStatusStr) && !/غير|not/i.test(masterStatusStr);
  if (resignationRecords.length > 0 && waradLooksActive) {
    conflicts.push(`تعارض حالة: يوجد ${resignationRecords.length} سجل استقالة بينما حالة وارد التأمين "${waradStatus}" — يحتاج مراجعة`);
  }
  if (masterLooksInactive && waradLooksActive) {
    conflicts.push(`تعارض حالة: حالة الدليل "${masterStatusStr}" بينما حالة وارد التأمين "${waradStatus}" — يحتاج مراجعة`);
  }
  if (masterLooksActive && resignationRecords.length > 0) {
    conflicts.push(`تعارض حالة: حالة الدليل "${masterStatusStr}" بينما يوجد سجل استقالة مسجل — يحتاج مراجعة`);
  }

  // ── S1 Calculation (استمارة س1 - بداية الاشتراك) ──
  const s1Year = firstBoth?.year || firstPayroll?.year || (monthlyInsRecords[0]?.period_year as number) || null;
  const s1Month = firstBoth?.month || firstPayroll?.month || (monthlyInsRecords[0]?.period_month as number) || null;
  const matchFirstPay = (s1Year && s1Month)
    ? payrollRecords.find(p => p.period_year === s1Year && p.period_month === s1Month)
    : payrollRecords[0];
  const s1Attendance = matchFirstPay?.attendance_days || workInsuranceData?.month5;
  const recordedS1Date = (incomingRecord?.subscription_start_date as string) || (masterEmp?.insurance_start_date as string) || (socialInsData?.subscriptionStartDate as string) || null;
  const s1_calculation = computeS1Date(s1Year, s1Month, s1Attendance, recordedS1Date);

  // ── S6 Calculation (استمارة س6 - نهاية الاشتراك) ──
  const lastPayroll = payrollRecords.length > 0 ? payrollRecords[payrollRecords.length - 1] : null;
  const lastInsurance = monthlyInsRecords.length > 0 ? monthlyInsRecords[monthlyInsRecords.length - 1] : null;
  const s6Year = (lastPayroll?.period_year as number) || (lastInsurance?.period_year as number) || null;
  const s6Month = (lastPayroll?.period_month as number) || (lastInsurance?.period_month as number) || null;
  const s6WorkDays = lastPayroll?.attendance_days;
  const hasResignation = resignationRecords.length > 0;
  const empStatusStr = (masterEmp?.current_status as string) || (incomingRecord?.status as string) || 'Active';
  const isActive = !hasResignation && !/استق|منته|resign/i.test(empStatusStr);
  const recordedEndDate = (resignationRecords[0]?.last_working_day as string) || (resignationRecords[0]?.resignation_date as string) || (incomingRecord?.subscription_end_date as string) || null;
  const resignationType = (resignationRecords[0]?.resignation_type as string) || (incomingRecord?.termination_reason as string) || null;
  // When monthly inputs are withheld (unresolved account conflict) there is
  // NO basis for an affirmative employment/termination claim: absence of
  // evidence is not evidence. Report uncomputable, never "مستمر بالخدمة".
  const s6_calculation = (withholdMonthly || accountContradiction)
    ? {
        calculatedDate: null,
        formula: '—',
        sourceMonth: null,
        sourceYear: null,
        daysInMonth: null,
        workDays: null,
        recordedDate: recordedEndDate,
        resignationType,
        status: 'insufficient_data' as const,
        message: 'لا يمكن احتساب س6 — السجلات الشهرية محجوبة لحين حسم حساب الموظف. عدم توفر السجل لا يعني استمرار العمل أو انتهاءه — يحتاج مراجعة',
      }
    : computeS6Date(s6Year, s6Month, s6WorkDays, isActive, hasResignation, recordedEndDate, resignationType);

  // Generic cross-source field conflicts recorded by the consolidation
  // merge (same-fact disagreement between independent sources, no automatic
  // selection). Surfaced in the SAME conflicts list the profile already
  // shows — values labeled with their sources, scalar stays withheld.
  const FIELD_LABELS: Record<string, string> = {
    employee_code: 'كود الموظف', national_id: 'الرقم القومي',
    current_job_title: 'الوظيفة', current_region: 'المنطقة',
    current_department: 'الإدارة', current_status: 'حالة العمل',
    insurance_number: 'الرقم التأميني', insurance_status: 'الحالة التأمينية',
    insurance_salary: 'الأجر التأميني', insurance_job_title: 'الوظيفة في التأمينات',
    insurance_start_date: 'تاريخ بداية الاشتراك', phone_number: 'رقم الهاتف',
    address: 'العنوان', hire_date: 'تاريخ استلام العمل',
    resignation_date: 'تاريخ الاستقالة', last_working_day: 'آخر يوم عمل',
  };
  const fieldConflicts = ((masterEmp?.consolidated_data as Record<string, unknown> | null)?.field_conflicts || {}) as Record<string, { source: string; value: unknown; at: string }[]>;
  // Dedupe: a raw alias key and its canonical key describe the SAME fact;
  // when both are recorded, show the canonical one only.
  const ALIAS_TO_CANONICAL: Record<string, string> = {
    'الكود': 'employee_code', 'الرقم القومى': 'national_id',
    'job_title': 'current_job_title', 'الوظيفه': 'current_job_title',
    'region': 'current_region', 'المنطقه': 'current_region',
    'department': 'current_department', 'الاداره': 'current_department',
    'status': 'current_status', 'الحاله': 'current_status',
    'الرقم التامينى': 'insurance_number', 'الرقم التاميني': 'insurance_number',
    'الرقم التأميني': 'insurance_number', 'الرقم التأمينى': 'insurance_number',
    'الحاله التامينيه': 'insurance_status', 'الحالة التأمينية': 'insurance_status',
    'الاجر التامينى': 'insurance_salary',
    'الوظيفه في التامينات': 'insurance_job_title',
    'رقم الهاتف': 'phone_number', 'العنوان': 'address',
    'تاريخ استلام العمل': 'hire_date',
    'subscription_start_date': 'insurance_start_date', 'تاريخ بدايه الاشتراك': 'insurance_start_date',
    'resignation_date': 'resignation_date', 'تاريخ الاستقاله': 'resignation_date',
    'last_working_day': 'last_working_day', 'اخر يوم عمل': 'last_working_day',
  };
  for (const [field, entries] of Object.entries(fieldConflicts)) {
    if (!Array.isArray(entries) || entries.length < 2) continue;
    const canonical = ALIAS_TO_CANONICAL[field];
    if (canonical && Array.isArray(fieldConflicts[canonical]) && fieldConflicts[canonical].length >= 2) continue;
    const label = FIELD_LABELS[field] || field;
    const parts = entries.map((e) => `"${String(e.value)}" (مصدر: ${e.source})`).join(' مقابل ');
    conflicts.push(`تعارض ${label}: ${parts} — لم تُختر قيمة تلقائيًا ويحتاج مراجعة`);
  }

  return {
    field_conflicts: fieldConflicts,
    identifiers: {
      national_id: national_id || (incomingRecord?.national_id as string) || cleanDbNid || null,
      employee_code: employee_code || (incomingRecord?.employee_code as string) || cleanDbCode || null,
      employee_name: employee_name || (incomingRecord?.employee_name as string) || cleanDbName || null,
    },
    conflicts,
    accountDisplay,
    latest_evidence,
    incomingInsurance: {
      found: Boolean(incomingRecord || masterEmp || socialInsData),
      record: {
        ...(incomingRecord || {}),
        insurance_number: (incomingRecord?.insurance_number as string) || (masterEmp?.insurance_number as string) || (socialInsData?.insuranceNumber as string) || null,
        job_title: (incomingRecord?.job_title as string) || (masterEmp?.current_job_title as string) || cleanDbJob || null,
        insurance_job_title: (incomingRecord?.insurance_job_title as string) || (masterEmp?.insurance_job_title as string) || (socialInsData?.insuranceJobTitle as string) || null,
        status: (incomingRecord?.status as string) || null, // warad record's own status only — master status is reported separately
        insurance_status: (incomingRecord?.insurance_status as string) || null, // warad's own insurance status only
        subscription_start_date: (incomingRecord?.subscription_start_date as string) || (masterEmp?.insurance_start_date as string) || (socialInsData?.subscriptionStartDate as string) || null,
        company_account: companyAccount || (masterEmp?.company_account as string) || null,
        employee_code: (incomingRecord?.employee_code as string) || (masterEmp?.employee_code as string) || cleanDbCode || targetCode || null,
        national_id: (incomingRecord?.national_id as string) || (masterEmp?.national_id as string) || cleanDbNid || targetNid || null,
        employee_name: (incomingRecord?.employee_name as string) || (masterEmp?.employee_name as string) || cleanDbName || targetName || 'بدون اسم',
      },
      company_account: companyAccount || (masterEmp?.company_account as string) || null,
    },
    masterStatus: {
      value: (masterEmp?.current_status as string) || null,
      insuranceValue: (masterEmp?.insurance_status as string) || null,
      source: 'employees_master',
    },
    resignation: {
      found: resignationRecords.length > 0,
      records: resignationRecords,
      message: resignationRecords.length > 0
        ? `تم العثور على ${resignationRecords.length} سجل في ملف RES.`
        : 'لم يتم العثور على سجل مطابق في ملف RES المستورد',
    },
    firstAppearances: {
      payroll: firstPayroll,
      insurance: firstInsurance,
      both: firstBoth,
      notes: availablePeriods.length > 0
        ? 'النتائج محسوبة استناداً إلى الشهور المستوردة والمتاحة فقط، ولا تعبر عن بيانات تاريخية غير مستوردة.'
        : 'لا توجد شهور مستوردة حتى الآن لحساب أول ظهور.',
    },
    allMonthsHistory,
    selectedMonthStatus,
    unifiedProfile,
    s1_calculation,
    s6_calculation,
  };
}
