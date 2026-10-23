import { supabaseServer } from '@/lib/supabaseServer';

export interface SearchCandidate {
  id: string;
  national_id: string | null;
  employee_code: string | null;
  employee_name: string | null;
  source: string;
  source_label: string;
  company_account?: string | null;
  first_both_month?: string | null;
  first_both_year?: number | null;
  first_both_m?: number | null;
  attendance_days?: string | null;
  insurance_status?: string | null;
  status?: string | null;
  has_resignation?: boolean;
  resignation_summary?: string;
  sources?: string[];
  target_month_status?: {
    year: number;
    month: number;
    inPayroll: boolean;
    inInsurance: boolean;
    inBoth: boolean;
    attendance_days?: string | null;
    statusLabel: string;
  } | null;
}

export async function searchEmployees(
  query: string,
  targetYear?: number,
  targetMonth?: number
): Promise<SearchCandidate[]> {
  const q = query.trim();
  if (!q || q.length < 2) return [];

  // 1. Search across all 4 tables in parallel
  const [insRes, payRes, miRes, resRes] = await Promise.all([
    supabaseServer
      .from('incoming_insurance_records')
      .select('id, national_id, employee_code, employee_name, company_account, status, insurance_status')
      .or(`national_id.ilike.%${q}%,employee_code.ilike.%${q}%,employee_name.ilike.%${q}%`)
      .limit(25),
    supabaseServer
      .from('monthly_payroll_records')
      .select('id, national_id, employee_code, employee_name, period_year, period_month, attendance_days')
      .or(`national_id.ilike.%${q}%,employee_code.ilike.%${q}%,employee_name.ilike.%${q}%`)
      .limit(25),
    supabaseServer
      .from('monthly_insurance_records')
      .select('id, national_id, employee_code, employee_name, period_year, period_month')
      .or(`national_id.ilike.%${q}%,employee_code.ilike.%${q}%,employee_name.ilike.%${q}%`)
      .limit(25),
    supabaseServer
      .from('resignation_records')
      .select('id, national_id, employee_code, employee_name, resignation_date, resignation_type, last_working_day')
      .or(`national_id.ilike.%${q}%,employee_code.ilike.%${q}%,employee_name.ilike.%${q}%`)
      .limit(15),
  ]);

  // 2. Group into unique persons (unifying by national_id or code)
  type PersonDraft = {
    id: string;
    national_id: string | null;
    employee_code: string | null;
    employee_name: string | null;
    company_account: string | null;
    status: string | null;
    insurance_status: string | null;
    sources: Set<string>;
  };

  const personMap = new Map<string, PersonDraft>();

  const getPersonKey = (r: { national_id?: string | null; employee_code?: string | null; employee_name?: string | null }) => {
    if (r.national_id && r.national_id.trim()) return `nat_${r.national_id.trim()}`;
    if (r.employee_code && r.employee_code.trim()) return `code_${r.employee_code.trim()}`;
    if (r.employee_name && r.employee_name.trim()) return `name_${r.employee_name.trim()}`;
    return null;
  };

  const mergeDraft = (
    r: {
      id: string;
      national_id?: string | null;
      employee_code?: string | null;
      employee_name?: string | null;
      company_account?: string | null;
      status?: string | null;
      insurance_status?: string | null;
    },
    source: string
  ) => {
    const key = getPersonKey(r);
    if (!key) return;

    const existing = personMap.get(key);
    if (!existing) {
      personMap.set(key, {
        id: r.id,
        national_id: r.national_id || null,
        employee_code: r.employee_code || null,
        employee_name: r.employee_name || null,
        company_account: r.company_account || null,
        status: r.status || null,
        insurance_status: r.insurance_status || null,
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
      if (!existing.status && r.status) existing.status = r.status;
      if (!existing.insurance_status && r.insurance_status) existing.insurance_status = r.insurance_status;
    }
  };

  (insRes.data || []).forEach((r) => mergeDraft(r, 'وارد التأمين'));
  (payRes.data || []).forEach((r) => mergeDraft(r, 'المرتبات'));
  (miRes.data || []).forEach((r) => mergeDraft(r, 'التأمينات'));
  (resRes.data || []).forEach((r) => mergeDraft(r, 'الاستقالات'));

  const distinctPeople = Array.from(personMap.values()).slice(0, 15);

  // 3. For each distinct person, query their full monthly and resignation records in parallel
  const enrichedResults: SearchCandidate[] = await Promise.all(
    distinctPeople.map(async (p) => {
      // Build conditions for matching this person
      const orConds: string[] = [];
      if (p.national_id) orConds.push(`national_id.eq.${p.national_id}`);
      if (p.employee_code) orConds.push(`employee_code.eq.${p.employee_code}`);

      let companyAccount = p.company_account;
      let insuranceStatus = p.insurance_status;
      let status = p.status;
      let hasResignation = false;
      let resignationSummary = 'لا توجد استقالة (مستمر)';
      let firstBothMonth: string | null = null;
      let firstBothYear: number | null = null;
      let firstBothM: number | null = null;
      let attendanceDays: string | null = null;
      let targetMonthStatus: {
        year: number;
        month: number;
        inPayroll: boolean;
        inInsurance: boolean;
        inBoth: boolean;
        attendance_days: string | null;
        statusLabel: string;
      } | null = null;

      if (orConds.length > 0) {
        const orClause = orConds.join(',');

        const [incomingData, payData, miData, resData] = await Promise.all([
          // If company_account or status missing, fetch from incoming_insurance
          (!companyAccount || !insuranceStatus || !status)
            ? supabaseServer.from('incoming_insurance_records').select('company_account, status, insurance_status, employee_name').or(orClause).limit(1).maybeSingle()
            : Promise.resolve({ data: null }),

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
        ]);

        if (incomingData.data) {
          if (!companyAccount && incomingData.data.company_account) companyAccount = incomingData.data.company_account;
          if (!insuranceStatus && incomingData.data.insurance_status) insuranceStatus = incomingData.data.insurance_status;
          if (!status && incomingData.data.status) status = incomingData.data.status;
          if ((!p.employee_name || p.employee_name === 'بدون اسم') && incomingData.data.employee_name) {
            p.employee_name = incomingData.data.employee_name;
          }
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

        // Calculate first joint appearance (both payroll and insurance together)
        for (const pr of payrolls) {
          const matchedMi = insurances.find(
            (mi) => mi.period_year === pr.period_year && mi.period_month === pr.period_month
          );
          if (matchedMi) {
            firstBothMonth = `${matchedMi.period_month} / ${matchedMi.period_year}`;
            firstBothYear = matchedMi.period_year;
            firstBothM = matchedMi.period_month;
            attendanceDays = pr.attendance_days ? String(pr.attendance_days).trim() : '0';
            break;
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
      }

      return {
        id: p.id,
        national_id: p.national_id,
        employee_code: p.employee_code,
        employee_name: p.employee_name || 'بدون اسم',
        company_account: companyAccount || '—',
        first_both_month: firstBothMonth || 'غير متوفر',
        first_both_year: firstBothYear,
        first_both_m: firstBothM,
        attendance_days: attendanceDays || '—',
        insurance_status: insuranceStatus || 'غير مسجل',
        status: status || '—',
        has_resignation: hasResignation,
        resignation_summary: resignationSummary,
        source: 'consolidated',
        source_label: Array.from(p.sources).join(' • '),
        sources: Array.from(p.sources),
        target_month_status: targetMonthStatus,
      };
    })
  );

  return enrichedResults;
}

export interface MonthAvailability {
  year: number;
  month: number;
  hasPayroll: boolean;
  hasInsurance: boolean;
}

export async function getAvailableImportedPeriods(): Promise<MonthAvailability[]> {
  const { data: logs } = await supabaseServer
    .from('import_logs')
    .select('source_type, period_year, period_month')
    .not('period_year', 'is', null)
    .not('period_month', 'is', null);

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

export interface EmployeeDetailsResult {
  identifiers: {
    national_id: string | null;
    employee_code: string | null;
    employee_name: string | null;
  };
  conflicts: string[];
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
}

export async function getEmployeeFullDetails(params: {
  national_id?: string | null;
  employee_code?: string | null;
  employee_name?: string | null;
  selected_year?: number;
  selected_month?: number;
}): Promise<EmployeeDetailsResult> {
  const { national_id, employee_code, employee_name, selected_year, selected_month } = params;
  const conflicts: string[] = [];

  // 1. Fetch matching incoming insurance records
  let incomingQuery = supabaseServer.from('incoming_insurance_records').select('*');
  const incomingOrConditions: string[] = [];
  if (national_id) incomingOrConditions.push(`national_id.eq.${national_id}`);
  if (employee_code) incomingOrConditions.push(`employee_code.eq.${employee_code}`);

  let incomingRecord: Record<string, unknown> | null = null;
  if (incomingOrConditions.length > 0) {
    incomingQuery = incomingQuery.or(incomingOrConditions.join(','));
    const { data } = await incomingQuery.limit(5);
    if (data && data.length > 0) {
      incomingRecord = data[0];
      // Check for code/national_id conflict
      data.forEach((r) => {
        if (national_id && r.national_id && r.national_id !== national_id) {
          conflicts.push(`تعارض في أرقام وارد التأمين: تم العثور على نفس الكود (${employee_code}) مع رقم قومي مختلف (${r.national_id})`);
        }
        if (employee_code && r.employee_code && r.employee_code !== employee_code) {
          conflicts.push(`تعارض في أرقام وارد التأمين: تم العثور على نفس الرقم القومي (${national_id}) مع كود مختلف (${r.employee_code})`);
        }
      });
    }
  }

  // 2. Fetch resignation (RES.) records
  let resQuery = supabaseServer.from('resignation_records').select('*');
  const resOrConditions: string[] = [];
  if (national_id) resOrConditions.push(`national_id.eq.${national_id}`);
  if (employee_code) resOrConditions.push(`employee_code.eq.${employee_code}`);

  let resignationRecords: Record<string, unknown>[] = [];
  if (resOrConditions.length > 0) {
    resQuery = resQuery.or(resOrConditions.join(','));
    const { data } = await resQuery.limit(10);
    if (data) resignationRecords = data;
  }

  // 3. Fetch all monthly payroll records for this employee
  let payrollQuery = supabaseServer.from('monthly_payroll_records').select('*');
  const payrollOrConditions: string[] = [];
  if (national_id) payrollOrConditions.push(`national_id.eq.${national_id}`);
  if (employee_code) payrollOrConditions.push(`employee_code.eq.${employee_code}`);

  let payrollRecords: Record<string, unknown>[] = [];
  if (payrollOrConditions.length > 0) {
    payrollQuery = payrollQuery.or(payrollOrConditions.join(','));
    const { data } = await payrollQuery.order('period_year', { ascending: true }).order('period_month', { ascending: true });
    if (data) payrollRecords = data;
  }

  // 4. Fetch all monthly insurance records for this employee
  let miQuery = supabaseServer.from('monthly_insurance_records').select('*');
  const miOrConditions: string[] = [];
  if (national_id) miOrConditions.push(`national_id.eq.${national_id}`);
  if (employee_code) miOrConditions.push(`employee_code.eq.${employee_code}`);

  let monthlyInsRecords: Record<string, unknown>[] = [];
  if (miOrConditions.length > 0) {
    miQuery = miQuery.or(miOrConditions.join(','));
    const { data } = await miQuery.order('period_year', { ascending: true }).order('period_month', { ascending: true });
    if (data) monthlyInsRecords = data;
  }

  // 5. Get available imported periods
  const availablePeriods = await getAvailableImportedPeriods();

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

  // Company account rule: Sharka in incoming insurance
  const companyAccount = incomingRecord ? (incomingRecord.company_account as string) || null : null;

  return {
    identifiers: {
      national_id: national_id || (incomingRecord?.national_id as string) || null,
      employee_code: employee_code || (incomingRecord?.employee_code as string) || null,
      employee_name: employee_name || (incomingRecord?.employee_name as string) || null,
    },
    conflicts,
    incomingInsurance: {
      found: Boolean(incomingRecord),
      record: incomingRecord,
      company_account: companyAccount,
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
  };
}
