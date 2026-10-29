const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { createClient } = require('@supabase/supabase-js');

// 1. Read environment variables
const envText = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
const env = {};
envText.split('\n').forEach(line => {
  const m = line.match(/^([^=]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim();
});

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

// Helper to paginate Supabase queries
async function fetchAll(table, selectFields = '*', filterCol = null, filterVal = null) {
  let all = [];
  let from = 0;
  const step = 1000;
  while (true) {
    let query = supabase.from(table).select(selectFields).range(from, from + step - 1);
    if (filterCol && filterVal !== null && filterVal !== undefined) {
      if (Array.isArray(filterVal)) {
        query = query.in(filterCol, filterVal);
      } else {
        query = query.eq(filterCol, filterVal);
      }
    }
    const { data, error } = await query;
    if (error) {
      console.error(`Error querying ${table}:`, error.message);
      throw error;
    }
    all.push(...data);
    if (data.length < step) break;
    from += step;
  }
  return all;
}

// Clean date formatting as YYYY-MM-DD
function formatDate(val) {
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

// Clean number parser
function parseAmount(val) {
  if (val === null || val === undefined) return 0;
  const clean = String(val).replace(/[^0-9.-]/g, '');
  const num = parseFloat(clean);
  return isNaN(num) ? 0 : num;
}

async function run() {
  console.log('Fetching all records from Supabase...');

  console.time('fetch');
  const [incomingIns, monthlyIns, payrollRecords] = await Promise.all([
    fetchAll('incoming_insurance_records'),
    fetchAll('monthly_insurance_records'),
    fetchAll('monthly_payroll_records')
  ]);
  console.timeEnd('fetch');

  console.log(`Loaded ${incomingIns.length} incoming insurance records`);
  console.log(`Loaded ${monthlyIns.length} monthly insurance records`);
  console.log(`Loaded ${payrollRecords.length} monthly payroll records`);

  // 1. Build Global Reference Dictionary for IDs and Names
  const globalByNid = new Map();
  const globalByCode = new Map();

  function registerGlobal(nid, code, name, job, insJob, subDate) {
    nid = (nid || '').trim();
    code = (code || '').trim();
    name = (name || '').trim();
    job = (job || '').trim();
    insJob = (insJob || '').trim();
    subDate = formatDate(subDate);

    const existing = (nid && globalByNid.get(nid)) || (code && globalByCode.get(code)) || {};
    const merged = {
      nid: nid || existing.nid || '',
      code: code || existing.code || '',
      name: name || existing.name || '',
      job: job || existing.job || '',
      insJob: insJob || existing.insJob || '',
      subDate: subDate || existing.subDate || ''
    };

    if (merged.nid) globalByNid.set(merged.nid, merged);
    if (merged.code) globalByCode.set(merged.code, merged);
  }

  // Populate from incoming insurance
  incomingIns.forEach(r => {
    const raw = r.raw_data || {};
    registerGlobal(
      r.national_id || raw['الرقم القومى'] || raw['الرقم القومي'] || raw['القومي'],
      r.employee_code || raw['الكود'],
      r.employee_name || raw['الاسم'],
      r.job_title || raw['الوظيفه'] || raw['الوظيفة'],
      r.insurance_job_title || raw['الوظيفه في التامينات'] || raw['الوظيفة في التأمينات'],
      r.subscription_start_date || raw['تاريخ بدايه الاشتراك'] || raw['تاريخ بداية الاشتراك']
    );
  });

  // Populate from monthly insurance
  monthlyIns.forEach(r => {
    const raw = r.raw_data || {};
    registerGlobal(
      r.national_id || raw['القومي'] || raw['الرقم القومي'],
      r.employee_code || raw['الكود'],
      r.employee_name || raw['الاسم'],
      r.job_title || raw['الوظيفة نهائي'],
      '',
      ''
    );
  });

  // Insurance monthly wages map: key -> { [month]: wage }
  const insWageByNid = new Map();
  const insWageByCode = new Map();

  monthlyIns.forEach(r => {
    const raw = r.raw_data || {};
    const nid = (r.national_id || raw['القومي'] || raw['الرقم القومي'] || '').trim();
    const code = (r.employee_code || raw['الكود'] || '').trim();
    const month = r.period_month;
    const wage = parseAmount(raw['الاجر التاميني'] || raw['الاجر التامينى'] || 0);

    if (nid) {
      if (!insWageByNid.has(nid)) insWageByNid.set(nid, {});
      insWageByNid.get(nid)[month] = wage;
    }
    if (code) {
      if (!insWageByCode.has(code)) insWageByCode.set(code, {});
      insWageByCode.get(code)[month] = wage;
    }
  });

  // Payroll aggregation map
  const employeesMap = new Map();

  function getEmpKey(r) {
    const raw = r.raw_data || {};
    const nid = (r.national_id || raw['الرقم القومي'] || raw['القومي'] || '').trim();
    const code = (r.employee_code || raw['الكود'] || '').trim();
    if (nid) return `nid:${nid}`;
    if (code) return `code:${code}`;
    const name = (r.employee_name || raw['الاسم'] || '').trim();
    return name ? `name:${name}` : null;
  }

  payrollRecords.forEach(r => {
    const key = getEmpKey(r);
    if (!key) return;

    const raw = r.raw_data || {};
    let nid = (r.national_id || raw['الرقم القومي'] || raw['القومي'] || '').trim();
    let code = (r.employee_code || raw['الكود'] || '').trim();
    let name = (r.employee_name || raw['الاسم'] || '').trim();
    const month = r.period_month;

    // Cross-check with global lookup if missing
    if ((!code || !name) && nid && globalByNid.has(nid)) {
      const g = globalByNid.get(nid);
      if (!code && g.code) code = g.code;
      if (!name && g.name) name = g.name;
    }
    if ((!nid || !name) && code && globalByCode.has(code)) {
      const g = globalByCode.get(code);
      if (!nid && g.nid) nid = g.nid;
      if (!name && g.name) name = g.name;
    }

    const salary = parseAmount(raw['الراتب'] || raw['اجمالي المستحق'] || raw['صافى التحويل'] || 0);

    if (!employeesMap.has(key)) {
      employeesMap.set(key, {
        code,
        nid,
        name,
        jobTitle: r.job_title || raw['الوظيفة نهائي'] || raw['الوظيفة'] || '',
        department: r.department || raw['الادارة نهائي'] || '',
        region: r.region || raw['المنطقة نهائي'] || '',
        salariesByMonth: {},
      });
    }

    const emp = employeesMap.get(key);
    if (!emp.code && code) emp.code = code;
    if (!emp.nid && nid) emp.nid = nid;
    if (!emp.name && name) emp.name = name;
    if (!emp.jobTitle && (r.job_title || raw['الوظيفة نهائي'])) {
      emp.jobTitle = r.job_title || raw['الوظيفة نهائي'];
    }
    if (!emp.department && (r.department || raw['الادارة نهائي'])) {
      emp.department = r.department || raw['الادارة نهائي'];
    }
    if (!emp.region && (r.region || raw['المنطقة نهائي'])) {
      emp.region = r.region || raw['المنطقة نهائي'];
    }

    if (salary > 0 || !emp.salariesByMonth[month]) {
      emp.salariesByMonth[month] = salary;
    }
  });

  // Final pass: backfill any remaining missing details from global dictionary
  for (const [_, emp] of employeesMap.entries()) {
    const g = (emp.nid && globalByNid.get(emp.nid)) || (emp.code && globalByCode.get(emp.code));
    if (g) {
      if (!emp.code && g.code) emp.code = g.code;
      if (!emp.nid && g.nid) emp.nid = g.nid;
      if (!emp.name && g.name) emp.name = g.name;
      if (!emp.jobTitle && g.job) emp.jobTitle = g.job;
    }
  }

  // Filter employees: Keep all employees who have at least a name or code and were active in Q3
  // (We also include employees who worked in Q1/Q2 so full history is preserved)
  const allEmployeesList = Array.from(employeesMap.values()).filter(emp => {
    return emp.code || emp.name || emp.nid;
  });

  // Sort logically:
  // 1. Employees active in Q3 first (most relevant), then others
  // 2. By numeric employee_code ascending
  allEmployeesList.sort((a, b) => {
    const q3A = (a.salariesByMonth[7] || 0) + (a.salariesByMonth[8] || 0) + (a.salariesByMonth[9] || 0) > 0 ? 1 : 0;
    const q3B = (b.salariesByMonth[7] || 0) + (b.salariesByMonth[8] || 0) + (b.salariesByMonth[9] || 0) > 0 ? 1 : 0;
    if (q3A !== q3B) return q3B - q3A; // Q3 active first

    const codeA = parseInt(a.code, 10);
    const codeB = parseInt(b.code, 10);
    if (!isNaN(codeA) && !isNaN(codeB)) return codeA - codeB;
    return (a.code || '').localeCompare(b.code || '');
  });

  console.log(`Processing ${allEmployeesList.length} employees into final workbook...`);

  const hrLetterRows = [];
  const detailedAuditRows = [];

  for (const emp of allEmployeesList) {
    const g = (emp.nid && globalByNid.get(emp.nid)) || (emp.code && globalByCode.get(emp.code)) || {};
    const finalJob = emp.jobTitle || g.job || '';
    const insJobTitle = g.insJob || '';
    const subStartDate = g.subDate || '';

    // Insurance wage priority: Q3 months (9, then 8, then 7), fallback to any available month
    const insWages = (emp.nid && insWageByNid.get(emp.nid)) || (emp.code && insWageByCode.get(emp.code)) || {};
    let insWageVal = insWages[9] || insWages[8] || insWages[7] || insWages[6] || insWages[5] || insWages[4] || insWages[3] || insWages[2] || 0;

    // Q1 Average (months 2, 3)
    const q1Salaries = [emp.salariesByMonth[2], emp.salariesByMonth[3]].filter(s => s !== undefined && s > 0);
    let avgQ1 = '';
    if (q1Salaries.length > 0) {
      const sumQ1 = q1Salaries.reduce((acc, v) => acc + v, 0);
      avgQ1 = Math.round(sumQ1 / q1Salaries.length);
    }

    // Q2 Average (months 4, 5, 6)
    const q2Salaries = [emp.salariesByMonth[4], emp.salariesByMonth[5], emp.salariesByMonth[6]].filter(s => s !== undefined && s > 0);
    let avgQ2 = '';
    if (q2Salaries.length > 0) {
      const sumQ2 = q2Salaries.reduce((acc, v) => acc + v, 0);
      avgQ2 = Math.round(sumQ2 / q2Salaries.length);
    }

    // Q3 Calculation (months 7, 8, 9)
    const s7 = emp.salariesByMonth[7] || 0;
    const s8 = emp.salariesByMonth[8] || 0;
    const s9 = emp.salariesByMonth[9] || 0;

    const workedMonthsList = [];
    if (s7 > 0) workedMonthsList.push(7);
    if (s8 > 0) workedMonthsList.push(8);
    if (s9 > 0) workedMonthsList.push(9);

    const workedMonthsCount = workedMonthsList.length;
    const q3Total = s7 + s8 + s9;

    let hrAvgQ3 = '';
    let accountingAvgQ3 = '';
    let statusNote = '';
    let hrLetterNote = '';

    if (workedMonthsCount > 0) {
      // 1. HR Letter average (Actual working months)
      hrAvgQ3 = Math.round((q3Total / workedMonthsCount) * 100) / 100;

      // 2. Accounting average (Divided by 3)
      accountingAvgQ3 = Math.round((q3Total / 3) * 100) / 100;

      if (workedMonthsCount === 3) {
        statusNote = 'كامل (3 أشهر)';
        hrLetterNote = '';
      } else if (workedMonthsCount === 2) {
        statusNote = 'متوسط شهرين (تعيين جديد / استقالة)';
        hrLetterNote = 'متوسط شهرين';
      } else if (workedMonthsCount === 1) {
        statusNote = 'شهر واحد فقط';
        hrLetterNote = 'شهر واحد';
      }
    } else {
      statusNote = 'لم يتقاضَ راتب في الربع الثالث';
      hrLetterNote = 'غير نشط في Q3';
    }

    // Sheet 1: HR Letter Table (Requested Layout)
    hrLetterRows.push({
      'الكود': emp.code,
      'الاسم': emp.name,
      'الرقم القومى': emp.nid,
      'الوظيفه': finalJob,
      'الوظيفه في التامينات': insJobTitle,
      'تاريخ بدايه الاشتراك': subStartDate,
      'الاجر التامينى': insWageVal || '',
      'متوسط Q1': avgQ1,
      'متوسط Q2': avgQ2,
      'متوسط Q3': hrAvgQ3,
      'متوسط Q4': '',
      'ملاحظات الربع الثالث': hrLetterNote,
    });

    // Sheet 2: Audit & Accounting Comparison
    detailedAuditRows.push({
      'الكود': emp.code,
      'الاسم': emp.name,
      'الرقم القومى': emp.nid,
      'الإدارة': emp.department,
      'المنطقة': emp.region,
      'الوظيفة': finalJob,
      'الوظيفة في التأمينات': insJobTitle,
      'تاريخ الاشتراك': subStartDate,
      'الأجر التأميني': insWageVal || 0,
      'راتب شهر 7': s7 || 0,
      'راتب شهر 8': s8 || 0,
      'راتب شهر 9': s9 || 0,
      'إجمالي دخل الربع الثالث': q3Total,
      'عدد شهور العمل Q3': workedMonthsCount,
      'متوسط Q3 (HR Letter - شهور فعلية)': hrAvgQ3 || 0,
      'متوسط Q3 (المحاسبي - قسمة على 3)': accountingAvgQ3 || 0,
      'الفارق بين الحسابين': hrAvgQ3 && accountingAvgQ3 ? Math.round((hrAvgQ3 - accountingAvgQ3) * 100) / 100 : 0,
      'بيان الحالة': statusNote,
    });
  }

  // Workbook setup
  const workbook = XLSX.utils.book_new();
  const ws1 = XLSX.utils.json_to_sheet(hrLetterRows);
  const ws2 = XLSX.utils.json_to_sheet(detailedAuditRows);

  // Column formatting for Sheet 1
  ws1['!cols'] = [
    { wch: 10 }, // الكود
    { wch: 34 }, // الاسم
    { wch: 18 }, // الرقم القومي
    { wch: 22 }, // الوظيفة
    { wch: 24 }, // الوظيفة في التامينات
    { wch: 18 }, // تاريخ بداية الاشتراك
    { wch: 15 }, // الأجر التأميني
    { wch: 14 }, // متوسط Q1
    { wch: 14 }, // متوسط Q2
    { wch: 16 }, // متوسط Q3
    { wch: 14 }, // متوسط Q4
    { wch: 22 }, // ملاحظات الربع الثالث
  ];

  // Column formatting for Sheet 2
  ws2['!cols'] = [
    { wch: 10 }, // الكود
    { wch: 34 }, // الاسم
    { wch: 18 }, // الرقم القومي
    { wch: 24 }, // الإدارة
    { wch: 18 }, // المنطقة
    { wch: 22 }, // الوظيفة
    { wch: 24 }, // الوظيفة في التأمينات
    { wch: 16 }, // تاريخ الاشتراك
    { wch: 15 }, // الأجر التأميني
    { wch: 14 }, // راتب شهر 7
    { wch: 14 }, // راتب شهر 8
    { wch: 14 }, // راتب شهر 9
    { wch: 20 }, // إجمالي دخل الربع
    { wch: 18 }, // عدد شهور العمل
    { wch: 28 }, // متوسط HR Letter
    { wch: 28 }, // متوسط المحاسبي
    { wch: 18 }, // الفارق
    { wch: 32 }, // بيان الحالة
  ];

  XLSX.utils.book_append_sheet(workbook, ws1, 'HR Letter - الربع الثالث');
  XLSX.utils.book_append_sheet(workbook, ws2, 'التفاصيل والمقارنة المحاسبية');

  const exportDir = path.join(__dirname, '..', 'public', 'exports');
  if (!fs.existsSync(exportDir)) {
    fs.mkdirSync(exportDir, { recursive: true });
  }

  const exportPath = path.join(exportDir, 'HR_Letter_Quarter_3_2026.xlsx');
  XLSX.writeFile(workbook, exportPath);

  console.log(`Excel file successfully created at: ${exportPath}`);
  console.log(`Employees processed: ${hrLetterRows.length}`);
}

run().catch(err => {
  console.error('Execution error:', err);
  process.exit(1);
});
