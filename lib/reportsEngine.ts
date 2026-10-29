import * as XLSX from 'xlsx';
import { supabaseServer } from './supabaseServer';

export type CompanyAccount = 'E.G' | 'm.g' | 'ALL';
export type ReportType =
  | 'hr_letter'
  | 'insurance_invoice'
  | 'compliance_2026'
  | 'tcoe_costs'
  | 'resignation_audit'
  | 'comprehensive_master';

export type QuarterSelection = 'Q1' | 'Q2' | 'Q3' | 'Q4' | 'ANNUAL';
export type CalculationMethod = 'actual' | 'divided_by_3' | 'both';

export interface ReportColumn {
  key: string;
  label: string;
  width?: number;
}

export interface DepartmentSummaryItem {
  department: string;
  region: string;
  employeeCount: number;
  totalInsWage: number;
  totalWorker11: number;
  totalEmployer1875: number;
  totalInsuranceContribution: number;
  totalPayroll: number;
  avgWage: number;
  matchedCount: number;
  unmatchedCount: number;
}

export interface MonthComparisonSummary {
  currentMonth: number;
  currentMonthName: string;
  previousMonth: number;
  previousMonthName: string;
  hasPreviousData: boolean;
  currentEmployees: number;
  previousEmployees: number;
  diffEmployees: number;
  currentInsWage: number;
  previousInsWage: number;
  diffInsWage: number;
  currentEmployer1875: number;
  previousEmployer1875: number;
  diffEmployer1875: number;
  currentWorker11: number;
  previousWorker11: number;
  diffWorker11: number;
  currentTotal2975: number;
  previousTotal2975: number;
  diffTotal2975: number;
  newHiresCount: number;
  terminatedCount: number;
}

export interface ReportResult {
  summary: {
    totalEmployees: number;
    activeInPeriod: number;
    avgWage: number;
    totalPayroll: number;
    totalEmployerInsurance: number;
    minWageComplianceCount: number;
    warningsCount: number;
  };
  summaryRow: Record<string, unknown>;
  monthComparison?: MonthComparisonSummary;
  departmentSummary: DepartmentSummaryItem[];
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
  reportTitle: string;
  account: CompanyAccount;
  period: QuarterSelection;
}

// Format clean date
function formatDate(val: unknown): string {
  if (!val) return '';
  const str = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  const d = new Date(str);
  if (!isNaN(d.getTime())) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return str;
}

function parseAmount(val: unknown): number {
  if (val === null || val === undefined) return 0;
  const clean = String(val).replace(/[^0-9.-]/g, '');
  const num = parseFloat(clean);
  return isNaN(num) ? 0 : num;
}

// Paginated Supabase fetcher
async function fetchAllRecords(table: string, selectFields = '*') {
  const all: Record<string, unknown>[] = [];
  let from = 0;
  const step = 1000;
  while (true) {
    const { data, error } = await supabaseServer
      .from(table as 'incoming_insurance_records')
      .select(selectFields)
      .range(from, from + step - 1);
    if (error) {
      console.error(`Error querying ${table}:`, error.message);
      break;
    }
    if (!data || data.length === 0) break;
    all.push(...(data as unknown as Record<string, unknown>[]));
    if (data.length < step) break;
    from += step;
  }
  return all;
}

// In-memory cache for fast interactive queries (5 minute TTL)
let cachedData: {
  incomingIns: Record<string, unknown>[];
  monthlyIns: Record<string, unknown>[];
  payrollRecords: Record<string, unknown>[];
  resignationRecords: Record<string, unknown>[];
  timestamp: number;
} | null = null;

async function getCachedRawData() {
  const now = Date.now();
  if (cachedData && now - cachedData.timestamp < 300000) {
    return cachedData;
  }

  const [incomingIns, monthlyIns, payrollRecords, resignationRecords] = await Promise.all([
    fetchAllRecords('incoming_insurance_records'),
    fetchAllRecords('monthly_insurance_records'),
    fetchAllRecords('monthly_payroll_records'),
    fetchAllRecords('resignation_records'),
  ]);

  cachedData = {
    incomingIns,
    monthlyIns,
    payrollRecords,
    resignationRecords,
    timestamp: now,
  };

  return cachedData;
}

export async function generateReportData(
  account: CompanyAccount,
  reportType: ReportType,
  quarter: QuarterSelection = 'Q3',
  method: CalculationMethod = 'actual',
  targetMonth: number = 9
): Promise<ReportResult> {
  const { incomingIns, monthlyIns, payrollRecords, resignationRecords } = await getCachedRawData();

  // 1. Build Global Reference Maps
  const globalByNid = new Map<string, Record<string, unknown>>();
  const globalByCode = new Map<string, Record<string, unknown>>();

  incomingIns.forEach((r) => {
    const raw = (r.raw_data as Record<string, string>) || {};
    const nid = (
      (r.national_id as string) ||
      raw['الرقم القومى'] ||
      raw['الرقم القومي'] ||
      raw['القومي'] ||
      ''
    ).trim();
    const code = ((r.employee_code as string) || raw['الكود'] || '').trim();
    const name = ((r.employee_name as string) || raw['الاسم'] || '').trim();
    const job = ((r.job_title as string) || raw['الوظيفه'] || raw['الوظيفة'] || '').trim();
    const insJob = (
      (r.insurance_job_title as string) ||
      raw['الوظيفه في التامينات'] ||
      raw['الوظيفة في التأمينات'] ||
      ''
    ).trim();
    const subDate = formatDate(
      (r.subscription_start_date as string) ||
        raw['تاريخ بدايه الاشتراك'] ||
        raw['تاريخ بداية الاشتراك']
    );
    const insNum = (
      (r.insurance_number as string) ||
      raw['الرقم التاميني'] ||
      raw['الرقم التأميني'] ||
      ''
    ).trim();
    const companyAcc = (
      (r.company_account as string) ||
      raw['الشركه'] ||
      raw['الشركة'] ||
      'E.G'
    ).trim();

    const info = { nid, code, name, job, insJob, subDate, insNum, companyAcc };
    if (nid) globalByNid.set(nid, info);
    if (code) globalByCode.set(code, info);
  });

  // Resignation Lookup Map
  const resignationMap = new Map<string, Record<string, unknown>>();
  resignationRecords.forEach((r) => {
    const raw = (r.raw_data as Record<string, string>) || {};
    const nid = (
      (r.national_id as string) ||
      raw['الرقم القومى'] ||
      raw['الرقم القومي'] ||
      ''
    ).trim();
    const code = ((r.employee_code as string) || raw['الكود'] || '').trim();
    const resDate = formatDate((r.resignation_date as string) || raw['تاريخ الاستقاله']);
    const lastDay = formatDate((r.last_working_day as string) || raw['اخر يوم عمل']);
    const resType = ((r.resignation_type as string) || raw['نوع الاستقاله'] || '').trim();
    const supplyDate = formatDate((r.supply_date as string) || raw['تاريخ التوريد']);

    const info = { resDate, lastDay, resType, supplyDate };
    if (nid) resignationMap.set(nid, info);
    if (code) resignationMap.set(code, info);
  });

  // Insurance Wages Map: key -> { [month]: wage }
  const insWagesMap = new Map<string, Record<number, number>>();
  monthlyIns.forEach((r) => {
    const raw = (r.raw_data as Record<string, string>) || {};
    const nid = (
      (r.national_id as string) ||
      raw['القومي'] ||
      raw['الرقم القومي'] ||
      ''
    ).trim();
    const code = ((r.employee_code as string) || raw['الكود'] || '').trim();
    const month = Number(r.period_month);
    const wage = parseAmount(raw['الاجر التاميني'] || raw['الاجر التامينى'] || 0);

    const keys = [nid, code].filter(Boolean);
    keys.forEach((k) => {
      if (!insWagesMap.has(k)) insWagesMap.set(k, {});
      insWagesMap.get(k)![month] = wage;
    });
  });

  // Payroll Aggregation Map
  interface EmpRecord {
    code: string;
    nid: string;
    name: string;
    jobTitle: string;
    department: string;
    region: string;
    companyAcc: string;
    salariesByMonth: Record<number, number>;
    attendanceByMonth: Record<number, number>;
  }

  const employeesMap = new Map<string, EmpRecord>();

  // If user selected m.g or ALL, include all employees from incoming insurance
  incomingIns.forEach((r) => {
    const raw = (r.raw_data as Record<string, string>) || {};
    const nid = (
      (r.national_id as string) ||
      raw['الرقم القومى'] ||
      raw['الرقم القومي'] ||
      ''
    ).trim();
    const code = ((r.employee_code as string) || raw['الكود'] || '').trim();
    const companyAcc = (
      (r.company_account as string) ||
      raw['الشركه'] ||
      raw['الشركة'] ||
      'E.G'
    ).trim();

    if (account !== 'ALL') {
      const matchAcc =
        account === 'E.G'
          ? companyAcc.toUpperCase() === 'E.G' || companyAcc === ''
          : companyAcc.toLowerCase() === 'm.g';
      if (!matchAcc) return;
    }

    const key = nid || code || (r.employee_name as string);
    if (!key) return;

    if (!employeesMap.has(key)) {
      employeesMap.set(key, {
        code,
        nid,
        name: ((r.employee_name as string) || raw['الاسم'] || '').trim(),
        jobTitle: ((r.job_title as string) || raw['الوظيفه'] || '').trim(),
        department: '',
        region: '',
        companyAcc,
        salariesByMonth: {},
        attendanceByMonth: {},
      });
    }
  });

  // Helper lookups
  const getGlobal = (n?: string, c?: string): Record<string, unknown> => {
    return (n ? globalByNid.get(n) : undefined) || (c ? globalByCode.get(c) : undefined) || {};
  };

  const getInsWages = (n?: string, c?: string): Record<number, number> => {
    return (n ? insWagesMap.get(n) : undefined) || (c ? insWagesMap.get(c) : undefined) || {};
  };

  const getResignation = (n?: string, c?: string): Record<string, unknown> | undefined => {
    return (n ? resignationMap.get(n) : undefined) || (c ? resignationMap.get(c) : undefined);
  };

  // Populate payroll records
  payrollRecords.forEach((r) => {
    const raw = (r.raw_data as Record<string, string>) || {};
    let nid = (
      (r.national_id as string) ||
      raw['الرقم القومي'] ||
      raw['القومي'] ||
      ''
    ).trim();
    let code = ((r.employee_code as string) || raw['الكود'] || '').trim();
    let name = ((r.employee_name as string) || raw['الاسم'] || '').trim();

    const g = getGlobal(nid, code);
    if (g && Object.keys(g).length > 0) {
      if (!nid && g.nid) nid = g.nid as string;
      if (!code && g.code) code = g.code as string;
      if (!name && g.name) name = g.name as string;
    }

    const companyAcc = (g.companyAcc as string) || 'E.G';

    if (account !== 'ALL') {
      const matchAcc =
        account === 'E.G'
          ? companyAcc.toUpperCase() === 'E.G' || companyAcc === ''
          : companyAcc.toLowerCase() === 'm.g';
      if (!matchAcc) return;
    }

    const key = nid || code || name;
    if (!key) return;

    const month = Number(r.period_month);
    const salary = parseAmount(
      raw['الراتب'] || raw['اجمالي المستحق'] || raw['صافى التحويل'] || 0
    );
    const attendance = parseAmount(raw['عدد ايام الحضور'] || 0);

    if (!employeesMap.has(key)) {
      employeesMap.set(key, {
        code,
        nid,
        name,
        jobTitle: ((r.job_title as string) || raw['الوظيفة نهائي'] || '').trim(),
        department: ((r.department as string) || raw['الادارة نهائي'] || '').trim(),
        region: ((r.region as string) || raw['المنطقة نهائي'] || '').trim(),
        companyAcc,
        salariesByMonth: {},
        attendanceByMonth: {},
      });
    }

    const emp = employeesMap.get(key)!;
    if (!emp.code && code) emp.code = code;
    if (!emp.nid && nid) emp.nid = nid;
    if (!emp.name && name) emp.name = name;
    if (!emp.jobTitle && (r.job_title || raw['الوظيفة نهائي'])) {
      emp.jobTitle = ((r.job_title as string) || raw['الوظيفة نهائي']).trim();
    }
    if (!emp.department && (r.department || raw['الادارة نهائي'])) {
      emp.department = ((r.department as string) || raw['الادارة نهائي']).trim();
    }
    if (!emp.region && (r.region || raw['المنطقة نهائي'])) {
      emp.region = ((r.region as string) || raw['المنطقة نهائي']).trim();
    }

    if (salary > 0 || !emp.salariesByMonth[month]) {
      emp.salariesByMonth[month] = salary;
    }
    if (attendance > 0) {
      emp.attendanceByMonth[month] = attendance;
    }
  });

  // Sort employees: Active in target period first, then numeric code
  const targetMonths =
    quarter === 'Q1'
      ? [1, 2, 3]
      : quarter === 'Q2'
      ? [4, 5, 6]
      : quarter === 'Q3'
      ? [7, 8, 9]
      : quarter === 'Q4'
      ? [10, 11, 12]
      : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

  const empList = Array.from(employeesMap.values()).sort((a, b) => {
    const hasA = targetMonths.some((m) => (a.salariesByMonth[m] || 0) > 0) ? 1 : 0;
    const hasB = targetMonths.some((m) => (b.salariesByMonth[m] || 0) > 0) ? 1 : 0;
    if (hasA !== hasB) return hasB - hasA;

    const numA = parseInt(a.code, 10);
    const numB = parseInt(b.code, 10);
    if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
    return (a.code || '').localeCompare(b.code || '');
  });

  // Summary Metrics Accumulator
  let totalPayroll = 0;
  let totalEmployerInsurance = 0;
  let minWageComplianceCount = 0;
  let warningsCount = 0;
  let activeInPeriodCount = 0;
  let sumAvgWages = 0;

  const rows: Record<string, unknown>[] = [];
  let columns: ReportColumn[] = [];
  let reportTitle = '';

  // Process rows according to reportType
  if (reportType === 'hr_letter') {
    reportTitle = `تقرير HR Letter ومتوسطات الأجور - ${quarter} (${account === 'ALL' ? 'جميع الحسابات' : account})`;
    columns = [
      { key: 'code', label: 'الكود', width: 10 },
      { key: 'name', label: 'الاسم', width: 34 },
      { key: 'nid', label: 'الرقم القومى', width: 18 },
      { key: 'jobTitle', label: 'الوظيفه', width: 22 },
      { key: 'insJobTitle', label: 'الوظيفه في التامينات', width: 24 },
      { key: 'subStartDate', label: 'تاريخ بدايه الاشتراك', width: 18 },
      { key: 'insWage', label: 'الاجر التامينى', width: 15 },
      { key: 'avgQ1', label: 'متوسط Q1', width: 14 },
      { key: 'avgQ2', label: 'متوسط Q2', width: 14 },
      { key: 'avgQ3', label: 'متوسط Q3', width: 16 },
      { key: 'workedMonthsInQuarter', label: 'عدد أشهر العمل (الربع المحدد)', width: 22 },
      { key: 'notes', label: 'ملاحظات الفترة', width: 22 },
    ];

    empList.forEach((emp) => {
      const g = getGlobal(emp.nid, emp.code);
      const insJobTitle = (g.insJob as string) || '';
      const subStartDate = (g.subDate as string) || '';

      const insWages = getInsWages(emp.nid, emp.code);
      const insWage =
        insWages[9] ||
        insWages[8] ||
        insWages[7] ||
        insWages[6] ||
        insWages[5] ||
        insWages[4] ||
        insWages[3] ||
        insWages[2] ||
        0;

      // Quarterly averages
      const calcQuarterAvg = (months: number[]) => {
        const sals = months
          .map((m) => emp.salariesByMonth[m])
          .filter((s) => s !== undefined && s > 0);
        if (sals.length === 0) return '';
        const sum = sals.reduce((acc, v) => acc + v, 0);
        return Math.round(method === 'divided_by_3' ? sum / 3 : sum / sals.length);
      };

      const q1 = calcQuarterAvg([1, 2, 3]);
      const q2 = calcQuarterAvg([4, 5, 6]);
      const q3 = calcQuarterAvg([7, 8, 9]);

      // Target period check
      const currentTargetSals = targetMonths
        .map((m) => emp.salariesByMonth[m])
        .filter((s) => s !== undefined && s > 0);
      const workedMonthsCount = currentTargetSals.length;
      const activeInTarget = workedMonthsCount > 0;

      // Pick the correct quarter average based on selected quarter
      const targetQuarterAvg =
        quarter === 'Q1' ? q1
        : quarter === 'Q2' ? q2
        : q3; // Q3 or any other selection defaults to Q3

      if (activeInTarget) {
        activeInPeriodCount++;
        const numericAvg = typeof targetQuarterAvg === 'number' ? targetQuarterAvg : 0;
        sumAvgWages += numericAvg;
        totalPayroll += currentTargetSals.reduce((a, b) => a + b, 0);
        if (numericAvg >= 7000) minWageComplianceCount++;
        else warningsCount++;
      }

      totalEmployerInsurance += insWage * 0.1875;

      // Human-readable worked months label
      const workedMonthsLabel =
        workedMonthsCount === 3
          ? `3 أشهر (${targetMonths.join('، ')})`
          : workedMonthsCount === 2
          ? `شهران (متوسط شهرين) - ${targetMonths.filter((m) => (emp.salariesByMonth[m] || 0) > 0).join('، ')}`
          : workedMonthsCount === 1
          ? `شهر واحد فقط - شهر ${targetMonths.filter((m) => (emp.salariesByMonth[m] || 0) > 0)[0]}`
          : 'غير نشط';

      let note = '';
      if (workedMonthsCount === 2) note = 'متوسط شهرين عمل';
      else if (workedMonthsCount === 1) note = 'شهر عمل واحد';
      else if (workedMonthsCount === 0) note = 'غير نشط في الفترة';

      rows.push({
        code: emp.code,
        name: emp.name,
        nid: emp.nid,
        jobTitle: emp.jobTitle || (g.job as string) || '',
        insJobTitle,
        subStartDate,
        insWage: insWage || '',
        avgQ1: q1,
        avgQ2: q2,
        avgQ3: q3,
        workedMonthsInQuarter: workedMonthsLabel,
        notes: note,
      });
    });
  } else if (reportType === 'insurance_invoice') {
    const monthNum = targetMonth || (quarter === 'Q1' ? 3 : quarter === 'Q2' ? 6 : quarter === 'Q3' ? 9 : 10);
    const monthNames: Record<number, string> = {
      1: 'يناير', 2: 'فبراير', 3: 'مارس', 4: 'أبريل', 5: 'مايو', 6: 'يونيو',
      7: 'يوليو', 8: 'أغسطس', 9: 'سبتمبر', 10: 'أكتوبر', 11: 'نوفمبر', 12: 'ديسمبر'
    };
    const monthName = monthNames[monthNum] || `شهر ${monthNum}`;

    const currentMonthIns = monthlyIns.filter((r) => Number(r.period_month) === monthNum);
    const hasInsuranceSheet = currentMonthIns.length > 0;

    columns = [
      { key: 'code', label: 'الكود', width: 12 },
      { key: 'name', label: 'الاسم', width: 34 },
      { key: 'nid', label: 'الرقم القومي', width: 20 },
      { key: 'jobTitle', label: 'الوظيفة', width: 22 },
      { key: 'region', label: 'المنطقة', width: 18 },
      { key: 'department', label: 'الإدارة', width: 20 },
      { key: 'insNumber', label: 'الرقم التأميني', width: 16 },
      { key: 'insWage', label: 'الأجر التأميني', width: 18 },
      { key: 'employerContribution', label: 'حصة صاحب العمل', width: 18 },
      { key: 'workerContribution', label: 'حصة العامل', width: 18 },
      { key: 'totalContribution', label: 'الاجمالي', width: 18 },
    ];

    if (hasInsuranceSheet) {
      reportTitle = `الفاتورة التأمينية والمطالبة الرسمية - ${monthName} 2026 (${account === 'ALL' ? 'جميع الحسابات' : account})`;

      const monthInsMap = new Map<string, Record<string, unknown>>();
      currentMonthIns.forEach((r) => {
        const raw = (r.raw_data as Record<string, string>) || {};
        const nid = ((r.national_id as string) || raw['القومي'] || raw['الرقم القومي'] || '').trim();
        const code = ((r.employee_code as string) || raw['الكود'] || '').trim();
        if (nid) monthInsMap.set(nid, r);
        if (code) monthInsMap.set(code, r);
      });

      empList.forEach((emp) => {
        const insRec = (emp.nid ? monthInsMap.get(emp.nid) : undefined) || (emp.code ? monthInsMap.get(emp.code) : undefined);
        const rawIns = insRec ? ((insRec.raw_data as Record<string, string>) || {}) : null;

        const g = getGlobal(emp.nid, emp.code);
        const insNumber = (rawIns ? rawIns['الرقم التأميني'] : '') || (g.insNum as string) || '0';

        const insWage = rawIns ? parseAmount(rawIns['الأجر التأميني'] || rawIns['الاجر التاميني'] || rawIns['الاجر التامينى'] || 0) : 0;
        const employer1875 = rawIns ? parseAmount(rawIns['حصة صاحب العمل'] || insWage * 0.1875) : Math.round(insWage * 0.1875 * 100) / 100;
        const worker11 = rawIns ? parseAmount(rawIns['حصة العامل'] || insWage * 0.11) : Math.round(insWage * 0.11 * 100) / 100;
        const total2975 = rawIns ? parseAmount(rawIns['الاجمالي'] || rawIns['الإجمالي'] || (worker11 + employer1875)) : Math.round((worker11 + employer1875) * 100) / 100;

        const salaryInMonth = emp.salariesByMonth[monthNum] || 0;

        if (rawIns && salaryInMonth > 0) {
          activeInPeriodCount++;
          minWageComplianceCount++;
        } else if (rawIns && salaryInMonth === 0) {
          warningsCount++;
        } else if (!rawIns && salaryInMonth > 0) {
          warningsCount++;
        } else {
          return;
        }

        totalPayroll += salaryInMonth;
        totalEmployerInsurance += employer1875;
        sumAvgWages += insWage;

        rows.push({
          code: emp.code,
          name: emp.name,
          nid: emp.nid,
          jobTitle: (rawIns ? rawIns['الوظيفة'] || rawIns['الوظيفة نهائي'] : '') || emp.jobTitle || (g.job as string) || '',
          region: (rawIns ? rawIns['المنطقة'] || rawIns['المنطقة نهائي'] : '') || emp.region || '',
          department: (rawIns ? rawIns['الإدارة'] || rawIns['الادارة نهائي'] : '') || emp.department || '',
          insNumber,
          insWage: Number(insWage).toFixed(2),
          employerContribution: Number(employer1875).toFixed(2),
          workerContribution: Number(worker11).toFixed(2),
          totalContribution: Number(total2975).toFixed(2),
        });
      });
    } else {
      reportTitle = `الفاتورة التأمينية لشهر ${monthName} 2026 (${account}) - ⚠️ شيت التأمينات لم يُرفع بعد`;

      empList.forEach((emp) => {
        const salaryInMonth = emp.salariesByMonth[monthNum] || 0;
        if (salaryInMonth > 0) {
          const g = getGlobal(emp.nid, emp.code);
          warningsCount++;
          totalPayroll += salaryInMonth;

          const insWages = getInsWages(emp.nid, emp.code);
          const insWage = insWages[9] || insWages[8] || insWages[7] || 5385;
          const employer1875 = Math.round(insWage * 0.1875 * 100) / 100;
          const worker11 = Math.round(insWage * 0.11 * 100) / 100;
          const total2975 = Math.round((worker11 + employer1875) * 100) / 100;

          rows.push({
            code: emp.code,
            name: emp.name,
            nid: emp.nid,
            jobTitle: emp.jobTitle || (g.job as string) || '',
            region: emp.region || '',
            department: emp.department || '',
            insNumber: (g.insNum as string) || '0',
            insWage: Number(insWage).toFixed(2),
            employerContribution: Number(employer1875).toFixed(2),
            workerContribution: Number(worker11).toFixed(2),
            totalContribution: Number(total2975).toFixed(2),
          });
        }
      });
    }
  } else if (reportType === 'compliance_2026') {
    reportTitle = `تقرير المطابقة القانونية والتأمينية لعام 2026 - ${account}`;
    columns = [
      { key: 'code', label: 'الكود', width: 10 },
      { key: 'name', label: 'الاسم', width: 34 },
      { key: 'nid', label: 'الرقم القومى', width: 18 },
      { key: 'jobTitle', label: 'الوظيفة الفعلية', width: 22 },
      { key: 'insJobTitle', label: 'الوظيفة في التأمينات', width: 22 },
      { key: 'actualWage', label: 'متوسط الراتب الفعلي', width: 18 },
      { key: 'insWage', label: 'الأجر التأميني', width: 15 },
      { key: 'workerContribution', label: 'حصة العامل (11%)', width: 16 },
      { key: 'employerContribution', label: 'حصة الشركة (18.75%)', width: 18 },
      { key: 'minWageStatus', label: 'الحد الأدنى (7,000 ج.م)', width: 20 },
      { key: 'insBoundsStatus', label: 'حدود التأمينات (2,700-16,700)', width: 24 },
      { key: 'jobMatchStatus', label: 'تطابق المسمى', width: 18 },
    ];

    empList.forEach((emp) => {
      const g = getGlobal(emp.nid, emp.code);
      const insWages = getInsWages(emp.nid, emp.code);
      const insWage = insWages[9] || insWages[8] || insWages[7] || 0;

      const currentTargetSals = targetMonths
        .map((m) => emp.salariesByMonth[m])
        .filter((s) => s !== undefined && s > 0);
      const actualWage =
        currentTargetSals.length > 0
          ? Math.round(
              currentTargetSals.reduce((a, b) => a + b, 0) /
                currentTargetSals.length
            )
          : 0;

      if (actualWage > 0) activeInPeriodCount++;
      sumAvgWages += actualWage;
      totalPayroll += actualWage;

      const worker11 = Math.round(insWage * 0.11 * 100) / 100;
      const employer1875 = Math.round(insWage * 0.1875 * 100) / 100;
      totalEmployerInsurance += employer1875;

      const minWageCompliant = actualWage >= 7000;
      if (minWageCompliant && actualWage > 0) minWageComplianceCount++;
      else if (actualWage > 0) warningsCount++;

      const insWithinBounds =
        insWage >= 2700 && insWage <= 16700;
      const jobMatches =
        !g.insJob ||
        !emp.jobTitle ||
        (emp.jobTitle as string).toLowerCase().includes((g.insJob as string).toLowerCase());

      rows.push({
        code: emp.code,
        name: emp.name,
        nid: emp.nid,
        jobTitle: emp.jobTitle || (g.job as string) || '',
        insJobTitle: (g.insJob as string) || '',
        actualWage: actualWage || '',
        insWage: insWage || '',
        workerContribution: worker11 || '',
        employerContribution: employer1875 || '',
        minWageStatus:
          actualWage === 0
            ? 'غير مسجل راتب'
            : minWageCompliant
            ? '✅ مطابق (≥ 7,000)'
            : '⚠️ أقل من الحد الأدنى',
        insBoundsStatus:
          insWage === 0
            ? 'غير مؤمن'
            : insWithinBounds
            ? '✅ ضمن الحدود القانونية'
            : '⚠️ خارج حدود 2026',
        jobMatchStatus: jobMatches ? 'متطابق' : '⚠️ اختلاف مسمى',
      });
    });
  } else if (reportType === 'tcoe_costs') {
    reportTitle = `تقرير التكلفة الشاملة للعمالة (TCOE) والموازنة - ${account}`;
    columns = [
      { key: 'code', label: 'الكود', width: 10 },
      { key: 'name', label: 'الاسم', width: 34 },
      { key: 'nid', label: 'الرقم القومى', width: 18 },
      { key: 'department', label: 'الإدارة', width: 22 },
      { key: 'region', label: 'المنطقة', width: 18 },
      { key: 'jobTitle', label: 'الوظيفة', width: 20 },
      { key: 'netSalary', label: 'الراتب الفعلي', width: 16 },
      { key: 'employerIns', label: 'حصة الشركة في التأمين (18.75%)', width: 24 },
      { key: 'totalEmploymentCost', label: 'إجمالي تكلفة الموظف شهرياً', width: 24 },
    ];

    empList.forEach((emp) => {
      const insWages = getInsWages(emp.nid, emp.code);
      const insWage = insWages[9] || insWages[8] || insWages[7] || 0;

      const currentTargetSals = targetMonths
        .map((m) => emp.salariesByMonth[m])
        .filter((s) => s !== undefined && s > 0);
      const actualWage =
        currentTargetSals.length > 0
          ? Math.round(
              currentTargetSals.reduce((a, b) => a + b, 0) /
                currentTargetSals.length
            )
          : 0;

      if (actualWage > 0) activeInPeriodCount++;
      const employerIns = Math.round(insWage * 0.1875 * 100) / 100;
      const totalCost = actualWage + employerIns;

      totalPayroll += actualWage;
      totalEmployerInsurance += employerIns;
      sumAvgWages += actualWage;

      rows.push({
        code: emp.code,
        name: emp.name,
        nid: emp.nid,
        department: emp.department,
        region: emp.region,
        jobTitle: emp.jobTitle,
        netSalary: actualWage || 0,
        employerIns,
        totalEmploymentCost: totalCost,
      });
    });
  } else if (reportType === 'resignation_audit') {
    reportTitle = `تقرير الاستقالات وحركة العمالة وتوريد التأمينات - ${account}`;
    columns = [
      { key: 'code', label: 'الكود', width: 10 },
      { key: 'name', label: 'الاسم', width: 34 },
      { key: 'nid', label: 'الرقم القومى', width: 18 },
      { key: 'resDate', label: 'تاريخ الاستقالة', width: 18 },
      { key: 'lastDay', label: 'آخر يوم عمل', width: 18 },
      { key: 'resType', label: 'نوع الاستقالة', width: 18 },
      { key: 'supplyDate', label: 'تاريخ توريد استمارة 6', width: 20 },
      { key: 'postResignPayrollCheck', label: 'مطابقة صرف الراتب بعد الاستقالة', width: 28 },
    ];

    empList.forEach((emp) => {
      const res = getResignation(emp.nid, emp.code);

      if (res || Object.keys(emp.salariesByMonth).length > 0) {
        const lastDay = res ? (res.lastDay as string) : '';
        let postPayrollCheck = 'سليم';
        if (lastDay) {
          const lastMonth = new Date(lastDay).getMonth() + 1;
          const subsequentSal = Object.entries(emp.salariesByMonth).find(
            ([m, val]) => Number(m) > lastMonth && val > 0
          );
          if (subsequentSal) {
            postPayrollCheck = `⚠️ تم صرف راتب في شهر ${subsequentSal[0]}`;
            warningsCount++;
          }
        }

        if (res) {
          rows.push({
            code: emp.code,
            name: emp.name,
            nid: emp.nid,
            resDate: res.resDate || '',
            lastDay: res.lastDay || '',
            resType: res.resType || '',
            supplyDate: res.supplyDate || '',
            postResignPayrollCheck: postPayrollCheck,
          });
        }
      }
    });
  } else {
    // comprehensive_master
    reportTitle = `كشف البيانات الشامل للموظفين والرواتب - ${account}`;
    columns = [
      { key: 'code', label: 'الكود', width: 10 },
      { key: 'name', label: 'الاسم', width: 34 },
      { key: 'nid', label: 'الرقم القومى', width: 18 },
      { key: 'companyAcc', label: 'الشركة (Account)', width: 16 },
      { key: 'department', label: 'الإدارة', width: 20 },
      { key: 'region', label: 'المنطقة', width: 16 },
      { key: 'jobTitle', label: 'الوظيفة', width: 20 },
      { key: 'insJobTitle', label: 'الوظيفة بالتأمينات', width: 20 },
      { key: 'subStartDate', label: 'بداية الاشتراك', width: 16 },
      { key: 'insWage', label: 'الأجر التأميني', width: 14 },
      { key: 's7', label: 'راتب شهر 7', width: 14 },
      { key: 's8', label: 'راتب شهر 8', width: 14 },
      { key: 's9', label: 'راتب شهر 9', width: 14 },
      { key: 'hrAvgQ3', label: 'متوسط Q3 (HR)', width: 16 },
      { key: 'accountingAvgQ3', label: 'متوسط Q3 (÷3)', width: 16 },
      { key: 'status', label: 'الحالة', width: 22 },
    ];

    empList.forEach((emp) => {
      const g = getGlobal(emp.nid, emp.code);
      const insWages = getInsWages(emp.nid, emp.code);
      const insWage = insWages[9] || insWages[8] || insWages[7] || 0;

      const s7 = emp.salariesByMonth[7] || 0;
      const s8 = emp.salariesByMonth[8] || 0;
      const s9 = emp.salariesByMonth[9] || 0;
      const q3Total = s7 + s8 + s9;
      const workedMonths = (s7 > 0 ? 1 : 0) + (s8 > 0 ? 1 : 0) + (s9 > 0 ? 1 : 0);

      const hrAvgQ3 = workedMonths > 0 ? Math.round(q3Total / workedMonths) : '';
      const accAvgQ3 = workedMonths > 0 ? Math.round(q3Total / 3) : '';

      if (workedMonths > 0) activeInPeriodCount++;

      rows.push({
        code: emp.code,
        name: emp.name,
        nid: emp.nid,
        companyAcc: emp.companyAcc,
        department: emp.department,
        region: emp.region,
        jobTitle: emp.jobTitle || (g.job as string) || '',
        insJobTitle: (g.insJob as string) || '',
        subStartDate: (g.subDate as string) || '',
        insWage: insWage || '',
        s7: s7 || '',
        s8: s8 || '',
        s9: s9 || '',
        hrAvgQ3,
        accountingAvgQ3: accAvgQ3,
        status:
          workedMonths === 3
            ? 'كامل (3 أشهر)'
            : workedMonths === 2
            ? 'متوسط شهرين'
            : workedMonths === 1
            ? 'شهر واحد'
            : 'غير مسجل بـ Q3',
      });
    });
  }

  const finalAvg =
    activeInPeriodCount > 0 ? Math.round(sumAvgWages / activeInPeriodCount) : 0;

  // 1. Build Grand Summary Row (صف مجاميع الحسابات في نهاية الشيت كالمعتمد في الشيتات القديمة)
  const summaryRow: Record<string, unknown> = {};

  if (reportType === 'insurance_invoice') {
    let sumInsWage = 0;
    let sumEmployer = 0;
    let sumWorker = 0;
    let sumTotal = 0;

    rows.forEach((r) => {
      sumInsWage += parseAmount(r.insWage);
      sumEmployer += parseAmount(r.employerContribution);
      sumWorker += parseAmount(r.workerContribution);
      sumTotal += parseAmount(r.totalContribution);
    });

    // Exact structure of previous standard sheet:
    // First 7 columns empty, then sums of wages, employer, worker, and total
    summaryRow['code'] = '';
    summaryRow['name'] = '';
    summaryRow['nid'] = '';
    summaryRow['jobTitle'] = '';
    summaryRow['region'] = '';
    summaryRow['department'] = '';
    summaryRow['insNumber'] = '';
    summaryRow['insWage'] = sumInsWage.toFixed(2);
    summaryRow['employerContribution'] = sumEmployer.toFixed(2);
    summaryRow['workerContribution'] = sumWorker.toFixed(2);
    summaryRow['totalContribution'] = sumTotal.toFixed(2);
  } else {
    columns.forEach((col) => {
      if (['code', 'name', 'nid', 'jobTitle', 'insJobTitle', 'department', 'region', 'subStartDate'].includes(col.key)) {
        summaryRow[col.key] = '';
        return;
      }
      let sum = 0;
      let hasNumeric = false;
      rows.forEach((r) => {
        const v = r[col.key];
        if (typeof v === 'number') {
          sum += v;
          hasNumeric = true;
        } else if (typeof v === 'string') {
          const parsed = parseFloat(v.replace(/[^0-9.-]/g, ''));
          if (!isNaN(parsed)) {
            sum += parsed;
            hasNumeric = true;
          }
        }
      });

      if (hasNumeric) {
        summaryRow[col.key] = col.key.toLowerCase().includes('avg') ? Math.round(finalAvg).toFixed(2) : sum.toFixed(2);
      } else {
        summaryRow[col.key] = '';
      }
    });
  }

    const departmentSummary: DepartmentSummaryItem[] = [];

  // 3. Build Previous Month Comparison (تقرير مقارنة الفاتورة التأمينية بالشهر السابق ورصد التغيرات)
  let monthComparison: MonthComparisonSummary | undefined = undefined;

  if (reportType === 'insurance_invoice') {
    const monthNum = targetMonth || (quarter === 'Q1' ? 3 : quarter === 'Q2' ? 6 : quarter === 'Q3' ? 9 : 10);
    const monthNames: Record<number, string> = {
      1: 'يناير', 2: 'فبراير', 3: 'مارس', 4: 'أبريل', 5: 'مايو', 6: 'يونيو',
      7: 'يوليو', 8: 'أغسطس', 9: 'سبتمبر', 10: 'أكتوبر', 11: 'نوفمبر', 12: 'ديسمبر'
    };
    const prevMonthNum = monthNum > 1 ? monthNum - 1 : 12;
    const currentMonthName = monthNames[monthNum] || `شهر ${monthNum}`;
    const previousMonthName = monthNames[prevMonthNum] || `شهر ${prevMonthNum}`;

    const prevMonthIns = monthlyIns.filter((r) => Number(r.period_month) === prevMonthNum);
    const hasPreviousData = prevMonthIns.length > 0;

    let prevInsWage = 0;
    let prevEmployer1875 = 0;
    let prevWorker11 = 0;
    let prevTotal2975 = 0;
    const prevNidSet = new Set<string>();
    const prevCodeSet = new Set<string>();

    prevMonthIns.forEach((r) => {
      const raw = (r.raw_data as Record<string, string>) || {};
      const nid = ((r.national_id as string) || raw['القومي'] || raw['الرقم القومي'] || '').trim();
      const code = ((r.employee_code as string) || raw['الكود'] || '').trim();
      if (nid) prevNidSet.add(nid);
      if (code) prevCodeSet.add(code);

      const wage = parseAmount(raw['الأجر التأميني'] || raw['الاجر التاميني'] || raw['الاجر التامينى'] || 0);
      const emp1875 = parseAmount(raw['حصة صاحب العمل'] || wage * 0.1875);
      const wrk11 = parseAmount(raw['حصة العامل'] || wage * 0.11);
      const tot2975 = parseAmount(raw['الاجمالي'] || raw['الإجمالي'] || (wrk11 + emp1875));

      prevInsWage += wage;
      prevEmployer1875 += emp1875;
      prevWorker11 += wrk11;
      prevTotal2975 += tot2975;
    });

    let newHiresCount = 0;
    let terminatedCount = 0;

    if (hasPreviousData) {
      rows.forEach((r) => {
        const nid = String(r.nid || '').trim();
        const code = String(r.code || '').trim();
        const inPrev = (nid && prevNidSet.has(nid)) || (code && prevCodeSet.has(code));
        if (!inPrev) newHiresCount++;
      });

      prevMonthIns.forEach((r) => {
        const raw = (r.raw_data as Record<string, string>) || {};
        const nid = ((r.national_id as string) || raw['القومي'] || raw['الرقم القومي'] || '').trim();
        const code = ((r.employee_code as string) || raw['الكود'] || '').trim();
        const inCurr = rows.some((curr) => (nid && String(curr.nid).trim() === nid) || (code && String(curr.code).trim() === code));
        if (!inCurr) terminatedCount++;
      });
    }

    const currentEmployees = rows.length;
    const previousEmployees = prevMonthIns.length;

    const currWage = parseAmount(summaryRow['insWage']);
    const currEmployer = parseAmount(summaryRow['employerContribution']);
    const currWorker = parseAmount(summaryRow['workerContribution']);
    const currTotal = parseAmount(summaryRow['totalContribution']);

    monthComparison = {
      currentMonth: monthNum,
      currentMonthName,
      previousMonth: prevMonthNum,
      previousMonthName,
      hasPreviousData,
      currentEmployees,
      previousEmployees,
      diffEmployees: currentEmployees - previousEmployees,
      currentInsWage: Math.round(currWage * 100) / 100,
      previousInsWage: Math.round(prevInsWage * 100) / 100,
      diffInsWage: Math.round((currWage - prevInsWage) * 100) / 100,
      currentEmployer1875: Math.round(currEmployer * 100) / 100,
      previousEmployer1875: Math.round(prevEmployer1875 * 100) / 100,
      diffEmployer1875: Math.round((currEmployer - prevEmployer1875) * 100) / 100,
      currentWorker11: Math.round(currWorker * 100) / 100,
      previousWorker11: Math.round(prevWorker11 * 100) / 100,
      diffWorker11: Math.round((currWorker - prevWorker11) * 100) / 100,
      currentTotal2975: Math.round(currTotal * 100) / 100,
      previousTotal2975: Math.round(prevTotal2975 * 100) / 100,
      diffTotal2975: Math.round((currTotal - prevTotal2975) * 100) / 100,
      newHiresCount,
      terminatedCount,
    };
  }

  return {
    summary: {
      totalEmployees: empList.length,
      activeInPeriod: activeInPeriodCount,
      avgWage: finalAvg,
      totalPayroll: Math.round(totalPayroll),
      totalEmployerInsurance: Math.round(totalEmployerInsurance),
      minWageComplianceCount,
      warningsCount,
    },
    summaryRow,
    monthComparison,
    departmentSummary,
    columns,
    rows,
    reportTitle,
    account,
    period: quarter,
  };
}

// Generate Blank Template with Sample Row
export function generateBlankTemplate(reportType: ReportType, account: CompanyAccount) {
  const wb = XLSX.utils.book_new();

  let headers: string[] = [];
  let sampleRow: Record<string, string> = {};
  let sheetName = 'نموذج إدخال البيانات';

  if (reportType === 'hr_letter') {
    sheetName = 'قالب بيانات HR Letter';
    headers = [
      'الكود',
      'الاسم',
      'الرقم القومى',
      'الوظيفه',
      'الوظيفه في التامينات',
      'تاريخ بدايه الاشتراك',
      'الاجر التامينى',
      'متوسط Q1',
      'متوسط Q2',
      'متوسط Q3',
      'متوسط Q4',
      'ملاحظات',
    ];
    sampleRow = {
      'الكود': '31003',
      'الاسم': 'اسم الموظف الثلاثي',
      'الرقم القومى': '29603010203053',
      'الوظيفه': 'براد منتج',
      'الوظيفه في التامينات': 'عامل',
      'تاريخ بدايه الاشتراك': '2024-02-01',
      'الاجر التامينى': '5401',
      'متوسط Q1': '7500',
      'متوسط Q2': '7427',
      'متوسط Q3': '7653',
      'متوسط Q4': '',
      'ملاحظات': 'نموذج استرشادي',
    };
  } else if (reportType === 'insurance_invoice') {
    sheetName = 'شيت التأمينات الاجتماعية';
    headers = [
      'الكود',
      'الاسم',
      'الرقم القومي',
      'الوظيفة',
      'المنطقة',
      'الإدارة',
      'الرقم التأميني',
      'الأجر التأميني',
      'حصة صاحب العمل',
      'حصة العامل',
      'الاجمالي',
    ];
    sampleRow = {
      'الكود': '52127',
      'الاسم': 'علي  عبدالكريم احمد حسن',
      'الرقم القومي': '28607112102792',
      'الوظيفة': 'سائق كلارك',
      'المنطقة': 'العين السخنة',
      'الإدارة': 'المصنع',
      'الرقم التأميني': '0',
      'الأجر التأميني': '5385.00',
      'حصة صاحب العمل': '1009.69',
      'حصة العامل': '592.35',
      'الاجمالي': '1602.04',
    };
  } else if (reportType === 'compliance_2026') {
    sheetName = 'قالب التدقيق التأميني 2026';
    headers = [
      'الكود',
      'الاسم',
      'الرقم القومى',
      'الشركة (Account)',
      'الوظيفة الفعلية',
      'الوظيفة في التأمينات',
      'الأجر التأميني (2700-16700)',
      'الراتب الفعلي الشامل (≥ 7000)',
      'أيام الحضور',
      'ملاحظات المراجعة',
    ];
    sampleRow = {
      'الكود': '50012',
      'الاسم': 'أحمد إبراهيم محمود',
      'الرقم القومى': '29405010101234',
      'الشركة (Account)': account === 'ALL' ? 'E.G' : account,
      'الوظيفة الفعلية': 'مهندس شبكات',
      'الوظيفة في التأمينات': 'مهندس',
      'الأجر التأميني (2700-16700)': '7500',
      'الراتب الفعلي الشامل (≥ 7000)': '11200',
      'أيام الحضور': '26',
      'ملاحظات المراجعة': 'مثال لقيد صحيح',
    };
  } else if (reportType === 'tcoe_costs') {
    sheetName = 'قالب تكاليف العمالة TCOE';
    headers = [
      'الكود',
      'الاسم',
      'الرقم القومى',
      'الإدارة',
      'المنطقة',
      'الوظيفة',
      'الراتب الشهري',
      'الأجر التأميني',
      'التأمين الطبي (الميديكال)',
      'البدلات الإضافية',
    ];
    sampleRow = {
      'الكود': '40120',
      'الاسم': 'محمد السيد حسن',
      'الرقم القومى': '28912120104321',
      'الإدارة': 'الشبكات',
      'المنطقة': 'العبور',
      'الوظيفة': 'فني',
      'الراتب الشهري': '8500',
      'الأجر التأميني': '6000',
      'التأمين الطبي (الميديكال)': '150',
      'البدلات الإضافية': '500',
    };
  } else if (reportType === 'resignation_audit') {
    sheetName = 'قالب الاستقالات وتوريد س6';
    headers = [
      'الكود',
      'الاسم',
      'الرقم القومى',
      'تاريخ الاستقالة (YYYY-MM-DD)',
      'آخر يوم عمل',
      'نوع الاستقالة',
      'تاريخ توريد استمارة 6',
      'رقم استمارة 6',
      'ملاحظات الشؤون القانونية',
    ];
    sampleRow = {
      'الكود': '38090',
      'الاسم': 'محمود علي حسن',
      'الرقم القومى': '29001010105678',
      'تاريخ الاستقالة (YYYY-MM-DD)': '2026-08-15',
      'آخر يوم عمل': '2026-08-31',
      'نوع الاستقالة': 'استقالة بمحض الإرادة',
      'تاريخ توريد استمارة 6': '2026-09-10',
      'رقم استمارة 6': 'S6-9921',
      'ملاحظات الشؤون القانونية': 'تمت التسوية',
    };
  } else {
    sheetName = 'قالب إدخال الرواتب الشامل';
    headers = [
      'الكود',
      'الاسم',
      'الرقم القومى',
      'الشركة (Account)',
      'الإدارة',
      'المنطقة',
      'الوظيفة',
      'تاريخ بداية الاشتراك',
      'الأجر التأميني',
      'راتب شهر 1',
      'راتب شهر 2',
      'راتب شهر 3',
      'راتب شهر 4',
      'راتب شهر 5',
      'راتب شهر 6',
      'راتب شهر 7',
      'راتب شهر 8',
      'راتب شهر 9',
      'راتب شهر 10',
      'راتب شهر 11',
      'راتب شهر 12',
    ];
    sampleRow = {
      'الكود': '1001',
      'الاسم': 'مثال لاسم الموظف',
      'الرقم القومى': '29001010100000',
      'الشركة (Account)': account === 'ALL' ? 'E.G' : account,
      'الإدارة': 'المحطات',
      'المنطقة': 'غرب النيل',
      'الوظيفة': 'مساعد فني',
      'تاريخ بداية الاشتراك': '2024-01-01',
      'الأجر التأميني': '5000',
      'راتب شهر 1': '7200',
      'راتب شهر 2': '7200',
      'راتب شهر 3': '7200',
      'راتب شهر 4': '7500',
      'راتب شهر 5': '7500',
      'راتب شهر 6': '7500',
      'راتب شهر 7': '7800',
      'راتب شهر 8': '7800',
      'راتب شهر 9': '7800',
      'راتب شهر 10': '7800',
      'راتب شهر 11': '',
      'راتب شهر 12': '',
    };
  }

  // Create empty template with headers and 1 sample guidance row
  const rows = [sampleRow];
  const ws = XLSX.utils.json_to_sheet(rows, { header: headers });

  // Auto-fit column widths
  ws['!cols'] = headers.map((h) => ({ wch: Math.max(h.length * 2 + 4, 15) }));

  XLSX.utils.book_append_sheet(wb, ws, sheetName);

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}
