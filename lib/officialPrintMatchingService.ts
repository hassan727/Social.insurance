/**
 * Official Print Matching & Multi-Sheet Forensic Audit Service
 *
 * المنظومة الرقابية المتكاملة لمطابقة برنت التأمينات الاجتماعية (مرجع 22/09/2026)
 * مع شيتات المرتبات، وارد التأمين (س1 ورقم CRM)، الاستقالات (س6)، والتأمينات الشهرية.
 *
 * القواعد الصارمة:
 * 1. المطابقة بالمرحلة الأولى: الرقم القومي (14 رقم) كمفتاح أساسي لا يتكرر.
 * 2. المطابقة بالمرحلة الثانية: فحص الاسم الرباعي وتحديد تباين الهوية.
 * 3. فحص كافة الشيتات: عدم اتهام أي موظف بمخالفة إذا كان له س1 في "وارد التأمين" برقم CRM ومكتب توريد،
 *    أو كان له استقالة في شيت "الاستقالات"، أو كان تعيينه بعد 22/09/2026.
 * 4. إدارة الأكونتات: ربط كل شركة بكود ومعرف فريد مركب يمنع خلط الموظفين بين الشركات.
 */

import * as fs from 'fs';
import * as XLSX from 'xlsx';
import { supabaseService } from './supabaseServer';
import { normalizeArabicText } from './matchingEngine';
import { cleanNationalId } from './smartImportService';

// ═══════════════════════════════════════════════════════════════════════════
// 1. معمارية الحسابات والشركات الفريدة (Company Accounts Architecture)
// ═══════════════════════════════════════════════════════════════════════════

export interface CompanyAccountDefinition {
  id: string;              // المعرف الفريد الداخلي للشركة
  code: string;            // كود الحساب (E.G, m.g, etc.)
  name: string;            // الاسم الرسمي للشركة
  facilityNumber?: string; // رقم المنشأة التأميني المعتمد
}

export const REGISTERED_ACCOUNTS: Record<string, CompanyAccountDefinition> = {
  'E.G': {
    id: 'ACC-01-EG',
    code: 'E.G',
    name: 'شركة غاز مصر (Egypt Gas)',
    facilityNumber: '10023451',
  },
  'm.g': {
    id: 'ACC-02-MG',
    code: 'm.g',
    name: 'شركة مقاولات غاز مصر (M.G)',
    facilityNumber: '10087612',
  },
};

/**
 * الحصول على المعرف الفريد المركب للموظف داخل الشركة
 * يمنع تكرار كود الأداء بين الشركات المختلفة
 */
export function getCompositeEmployeeKey(
  companyCode: string | null | undefined,
  empCode: string | null | undefined,
  nationalId?: string | null | undefined
): string {
  const comp = (companyCode || 'EG').toUpperCase().trim().replace(/[^A-Z0-9._-]/g, '') || 'EG';
  const cleanCode = (empCode || '').trim();
  if (cleanCode && cleanCode !== '-' && cleanCode !== '—' && cleanCode !== 'null' && cleanCode !== 'NULL') {
    return `${comp}#${cleanCode}`;
  }
  const cleanNid = (nationalId || '').trim();
  if (cleanNid.length >= 6) {
    return `${comp}#NID-${cleanNid.slice(-6)}`;
  }
  return `${comp}#REC`;
}

/**
 * دالة ذكية لتحليل كافة صيغ التواريخ المصرية الشائعة (DD/MM/YYYY, ISO, Excel serial)
 * تضمن عدم إرجاع NaN للتواريخ المصرية كـ 24/10/2026
 */
export function parseEgyptianDate(val: unknown): Date | null {
  if (!val) return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
  if (typeof val === 'number') {
    if (val > 20000 && val < 60000) {
      const d = new Date(Math.round((val - 25569) * 86400 * 1000));
      return isNaN(d.getTime()) ? null : d;
    }
  }
  const s = String(val).trim();
  if (!s || s.toLowerCase() === 'null' || s === '-' || s === '—') return null;

  // استبدال الأرقام الهندية/العربية بالأرقام اللاتينية
  const normalizedStr = s.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));

  // صيغة DD/MM/YYYY أو DD-MM-YYYY أو DD.MM.YYYY
  const dmyMatch = normalizedStr.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (dmyMatch) {
    const day = parseInt(dmyMatch[1], 10);
    const month = parseInt(dmyMatch[2], 10) - 1;
    const year = parseInt(dmyMatch[3], 10);
    if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
      const d = new Date(year, month, day);
      return isNaN(d.getTime()) ? null : d;
    }
  }

  // صيغة YYYY/MM/DD أو YYYY-MM-DD
  const isoMatch = normalizedStr.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (isoMatch) {
    const year = parseInt(isoMatch[1], 10);
    const month = parseInt(isoMatch[2], 10) - 1;
    const day = parseInt(isoMatch[3], 10);
    if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
      const d = new Date(year, month, day);
      return isNaN(d.getTime()) ? null : d;
    }
  }

  const fallback = new Date(normalizedStr);
  return isNaN(fallback.getTime()) ? null : fallback;
}

/**
 * تنظيف المسمى الوظيفي والتأكد من أنه ليس فراغاً أو قيمة ملغية
 */
export function cleanJobTitle(val: unknown): string {
  if (!val) return '';
  const s = String(val).trim();
  if (!s || s.toLowerCase() === 'null' || s.toLowerCase() === 'undefined' || s === '—' || s === '-' || s === '0') {
    return '';
  }
  return s;
}

/**
 * تنظيف النص العربي وتجريده من الكشيدة وعلامات التشكيل
 */
export function normalizeJobText(text: string): string {
  return (text || '')
    .replace(/[ـًٌٍَُِّْ]/g, '') // إزالة التشكيل والكشيدة
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[^\w\s\u0600-\u06FF]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * دليل المواءمة والتكافؤ المهني وفقاً لمعايير التأمينات الاجتماعية وقانون العمل المصري
 * يمنع التعارضات الوهمية بين التوصيف الداخلي وتوصيف استمارة 1 النمطية
 */
export function evaluateJobEquivalence(actualJob: string, insJob: string): {
  status: 'متطابق' | 'تعارض مسميات' | 'غير محدد';
  details: string;
} {
  const cleanAct = cleanJobTitle(actualJob);
  const cleanIns = cleanJobTitle(insJob);

  if (!cleanAct || !cleanIns) {
    return {
      status: 'غير محدد',
      details: !cleanIns ? 'المهنة غير مسجلة ببرنت التأمينات' : 'الوظيفة غير محددة بالمرتبات',
    };
  }

  const normAct = normalizeJobText(cleanAct);
  const normIns = normalizeJobText(cleanIns);

  // 1. التطابق التام أو التطابق الجزئي المباشر
  if (normAct === normIns || normAct.includes(normIns) || normIns.includes(normAct)) {
    return {
      status: 'متطابق',
      details: 'المسمى الفعلي متطابق مع المهنة التأمينية',
    };
  }

  // 2. عائلات التكافؤ المهني في قطاع المقاولات والغاز والتوريدات (Occupational Families)
  const OCCUPATIONAL_FAMILIES = [
    {
      family: 'تشغيل معادن وتركيبات ولحام وبرادة',
      keywords: ['براد', 'لحام', 'تركيبات', 'مواسير', 'حديد', 'خراط', 'صاج', 'معادن', 'شبكات', 'تشغيل'],
      genericInsKeywords: ['عامل', 'فني', 'عامل تشغيل', 'عامل عادي', 'عامل مهني', 'مهني'],
    },
    {
      family: 'حفر وإنشاءات وبناء ومساعدين',
      keywords: ['حفار', 'بناء', 'مساعد', 'معاون', 'نجار', 'سباك', 'محارة', 'مد شبكات'],
      genericInsKeywords: ['عامل', 'عامل عادي', 'عامل بناء', 'فني تشغيل'],
    },
    {
      family: 'حركة وسيارات ومعدات',
      keywords: ['سائق', 'سواق', 'معدة', 'لودر', 'حفار معدة', 'ونش', 'سيارة', 'نقل', 'جرار'],
      genericInsKeywords: ['سائق', 'عامل قيادة', 'عامل تشغيل سيارات', 'فني تشغيل'],
    },
    {
      family: 'أمن وحراسة وسلامة مهنية',
      keywords: ['امن', 'حارس', 'حراسة', 'خفير', 'سلامة', 'صحة مهنية', 'مراقب'],
      genericInsKeywords: ['حارس', 'خفير', 'حارس امن', 'مراقب', 'مشرف'],
    },
    {
      family: 'خدمات وبوفيه ونظافة',
      keywords: ['خدمات', 'بوفيه', 'نظافة', 'ساعي', 'اوفيس', 'فراش'],
      genericInsKeywords: ['عامل', 'عامل خدمات', 'عامل نظافة', 'فراش'],
    },
    {
      family: 'وظائف مالية ومحاسبية وإدارية',
      keywords: ['محاسب', 'مالي', 'خزينة', 'حسابات', 'مشتريات', 'مخازن', 'امين مخزن', 'اداري', 'كاتب', 'مدخل بيانات'],
      genericInsKeywords: ['محاسب', 'كاتب', 'موظف كتابي', 'اداري', 'امين مخزن'],
    },
    {
      family: 'وظائف هندسية وإشراف فني',
      keywords: ['مهندس', 'موقع', 'جودة', 'مكتب فني', 'كهرباء', 'ميكانيكا', 'مدني', 'مشرف فني'],
      genericInsKeywords: ['مهندس', 'مشرف', 'ملاحظ فني', 'فني اول'],
    },
  ];

  for (const fam of OCCUPATIONAL_FAMILIES) {
    const actMatch = fam.keywords.some((k) => normAct.includes(k));
    const insMatch = fam.keywords.some((k) => normIns.includes(k)) || fam.genericInsKeywords.some((k) => normIns.includes(k));

    if (actMatch && insMatch) {
      return {
        status: 'متطابق',
        details: `مسمى مكافئ مهنياً معتمد بالتأمينات (${cleanAct} ↔ ${cleanIns}) ضمن عائلة ${fam.family}`,
      };
    }
  }

  // 3. تعارض حقيقي جوهري يستلزم استمارة تعديل مهنة (س2)
  return {
    status: 'تعارض مسميات',
    details: `تعارض جوهري: المسمى الفعلي (${cleanAct}) يختلف كلياً عن التأميني (${cleanIns})`,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. أنواع البيانات للمطابقة وفحص الشيتات (Types & Data Models)
// ═══════════════════════════════════════════════════════════════════════════

export interface OfficialInsurancePrintRow {
  national_id: string;           // الرقم القومي
  employee_name: string;         // اسم المؤمن عليه
  insurance_number: string;      // الرقم التأميني
  insurance_job_title: string;   // المهنة المسجلة بالتأمينات
  company_account: string;       // الشركة أو الـ Account
  subscription_start_date: string; // تاريخ بداية المدة
  wage_start_date: string;       // تاريخ بداية الأجر
  insurance_salary: number;      // قيمة الأجر التأميني
  performance_number: string;    // رقم الأداء (كود الموظف)
  status: string;                // الحالة (ساري / منتهي)
  raw_data?: Record<string, unknown>;
}

export interface MatchedForensicRecord {
  // المعرفات
  nationalId: string;
  employeeCode: string;
  compositeKey: string;
  companyAccount: string;
  employeeName: string;
  insuredNameInPrint: string;
  nameMatchConfidence: 'متطابق تماماً' | 'تباين طفيف بالحروف' | 'تعارض أسماء يحتاج تدقيق' | 'غير مسجل بالبرنت';

  // الوظائف
  actualJobTitle: string;
  insuranceJobTitle: string;
  jobConflictStatus: 'متطابق' | 'تعارض مسميات' | 'غير محدد';
  jobConflictDetails: string;

  // التأمينات والأجور
  insuranceNumberInPrint: string;
  insuranceNumberInMaster: string;
  insNumberMatch: 'متطابق' | 'اختلاف أرقام تأمينية' | 'مفقود بالبرنت' | 'مفقود بالشركة';
  
  insuranceSalaryInPrint: number;
  actualPayrollSalary: number;
  salaryNotes: string;

  // التواريخ
  hireDate: string;
  insuranceStartDate: string;
  dateNotes: string;

  // الفحص متعدد الشيتات
  foundInPrint: boolean;
  foundInPayroll: boolean;
  foundInIncomingInsurance: boolean;
  foundInResignation: boolean;
  foundInMonthlyInsurance: boolean;

  // تفاصيل وارد التأمين والاستقالات
  incomingDetails?: {
    formType?: string;          // س1 أو س6
    crmNumber?: string;         // رقم الـ CRM
    supplyMethod?: string;      // مكتب التوريد (هرم، عجوزة، الخ)
    recordDate?: string;        // تاريخ التسجيل والتوريد
    insuranceStatus?: string;   // تم التوريد، تم التأمين
  };

  resignationDetails?: {
    resignationDate?: string;
    lastWorkingDay?: string;
    resignationType?: string;
  };

  // التصنيف النهائي الدقيق
  finalForensicStatus:
    | 'مطابق ومعتمد'
    | 'تعيين جديد بعد تاريخ البرنت (22/09/2026)'
    | 'تم توريد س1 بوارد التأمين وجارٍ الاعتماد'
    | 'مستقيل في شيت الاستقالات (RES)'
    | 'مخالفة تأمينية مؤكدة (غير مؤمن عليه ولم يُرصد له توريد س1)'
    | 'مسجل بالتأمينات ولا يتقاضى راتباً بالمرتبات'
    | 'تعارض مسميات وظيفية رسمي'
    | 'تعارض أرقام تأمينية أو أسماء';

  actionRequired: string;
}

export interface ForensicAuditSummary {
  auditDate: string;
  printReferenceDate: string; // 22/09/2026
  totalUniqueEmployeesAnalyzed: number;
  matchedCount: number;
  jobTitleConflictCount: number;
  missingInPrintCount: number;
  suppliedS1Count: number;        // تم توريد س1 بوارد التأمين ولم يظهر بالبرنت بعد
  hiredAfterPrintDateCount: number; // معينين بعد 22/09/2026
  confirmedUninsuredCount: number;  // مخالفة مؤكدة تستلزم س1
  missingInPayrollCount: number;    // مسجلين بالتأمينات ولا رواتب لهم
  dataDiscrepancyCount: number;
  duplicateNationalIdsCount: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. محرك الفحص والتدقيق الجنائي الشامل (Forensic Engine)
// ═══════════════════════════════════════════════════════════════════════════

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchAllRows<T = Record<string, any>>(tableName: string, selectFields = '*'): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  const step = 1000;
  while (true) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabaseService.from(tableName as any) as any)
      .select(selectFields)
      .range(from, from + step - 1);
    if (error) {
      console.error(`Error querying ${tableName}:`, error.message);
      break;
    }
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < step) break;
    from += step;
  }
  return all;
}

// In-memory cache for fast interactive dashboard filtering (3-minute TTL)
interface CachedAuditResult {
  account: string;
  timestamp: number;
  data: {
    summary: ForensicAuditSummary;
    records: MatchedForensicRecord[];
  };
}

const auditCache = new Map<string, CachedAuditResult>();

export function invalidateForensicAuditCache() {
  auditCache.clear();
}

export async function runOfficialPrintForensicAudit(
  targetAccount: 'E.G' | 'm.g' | 'ALL' = 'ALL',
  forceRefresh = false
): Promise<{
  summary: ForensicAuditSummary;
  records: MatchedForensicRecord[];
}> {
  const cacheKey = targetAccount.toUpperCase();
  const now = Date.now();
  const cached = auditCache.get(cacheKey);
  if (!forceRefresh && cached && now - cached.timestamp < 180000) {
    return cached.data;
  }

  const PRINT_CUTOFF_DATE = new Date('2026-09-22');

  // جلب كافة مصادر البيانات بالتوازي مع جلب كامل السجلات دون اقتطاع
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [incomingRecords, payrollRecords, monthlyInsRecords, resignationRecords, masterRecords] = await Promise.all([
    fetchAllRows<Record<string, any>>('incoming_insurance_records'),
    fetchAllRows<Record<string, any>>('monthly_payroll_records'),
    fetchAllRows<Record<string, any>>('monthly_insurance_records'),
    fetchAllRows<Record<string, any>>('resignation_records'),
    fetchAllRows<Record<string, any>>('employees_master'),
  ]);

  // 1. فهرسة برنت العمالة الرسمي
  const officialPrintMap = new Map<string, OfficialInsurancePrintRow>();

  // أ) فحص ملف برنت التأمينات الرسمي المباشر من القرص إن وجد (المؤسسه العربيه للتوريدات.xlsx)
  const defaultPrintPath = 'F:\\المرتبات والتامينات\\المؤسسه العربيه للتوريدات.xlsx';
  if (fs.existsSync(defaultPrintPath)) {
    try {
      const wb = XLSX.readFile(defaultPrintPath);
      const firstSheet = wb.Sheets[wb.SheetNames[0]];
      const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, { defval: '' });
      rawRows.forEach((row) => {
        const rawNid = cleanNationalId(row['الرقم القومى 2'] || row['الرقم القومي'] || row['الرقم القومى']) || '';
        if (rawNid.length !== 14) return;
        const comp = String(row['الشركه '] || row['الشركه'] || row['الشركة'] || '').trim();
        if (targetAccount !== 'ALL' && comp.toUpperCase() !== targetAccount.toUpperCase()) return;

        const sal = parseFloat(String(row['قيمة الاجر'] || row['الاجر التأمينى'] || 0).replace(/[^\d.]/g, '')) || 0;
        let subDate = '';
        if (typeof row['تاريخ بداية المده'] === 'number') {
          const d = new Date(Math.round(((row['تاريخ بداية المده'] as number) - 25569) * 86400 * 1000));
          subDate = !isNaN(d.getTime()) ? d.toISOString().split('T')[0] : '';
        } else {
          subDate = String(row['تاريخ بداية المده'] || '').trim();
        }

        let wageDate = '';
        if (typeof row['تاريخ بداية الاجر'] === 'number') {
          const d = new Date(Math.round(((row['تاريخ بداية الاجر'] as number) - 25569) * 86400 * 1000));
          wageDate = !isNaN(d.getTime()) ? d.toISOString().split('T')[0] : '';
        } else {
          wageDate = String(row['تاريخ بداية الاجر'] || '').trim();
        }

        officialPrintMap.set(rawNid, {
          national_id: rawNid,
          employee_name: String(row['اسم المؤمن عليه '] || row['اسم المؤمن عليه'] || '').trim(),
          insurance_number: String(row['الرقم التأميني للمؤمن علية'] || row['الرقم التأميني'] || row['الرقم التاميني'] || '').trim(),
          insurance_job_title: String(row['المهنة'] || row['المهنه'] || '').trim(),
          company_account: comp,
          subscription_start_date: subDate,
          wage_start_date: wageDate,
          insurance_salary: sal,
          performance_number: String(row['رقم الاداء'] || row['رقم الأداء'] || '').trim(),
          status: String(row['الحاله '] || row['الحالة'] || 'Active').trim(),
          raw_data: row,
        });
      });
    } catch (e) {
      console.warn('Error reading default print file from disk:', e);
    }
  }

  // ب) فحص وارد التأمين والسجلات المرفوعة عبر واجهة الاستيراد (برنت التأمينات الرسمي)
  incomingRecords.forEach((r) => {
    const raw = (r.raw_data as Record<string, string>) || {};
    const nid = cleanNationalId(r.national_id || raw['الرقم القومى 2'] || raw['الرقم القومى'] || raw['الرقم القومي']) || '';
    if (!nid || nid.length !== 14) return;

    const acc = (r.company_account || raw['الشركه'] || raw['الشركة'] || '').trim();
    if (targetAccount !== 'ALL' && acc.toUpperCase() !== targetAccount.toUpperCase()) return;

    // إذا لم يكن بالخريطة أو كان قادماً من استيراد برنت تأمينات رسمي صريح
    const isExplicitPrint = String(r.form_type || '').includes('برنت') || !!raw['المهنة'];
    if (!officialPrintMap.has(nid) || isExplicitPrint) {
      officialPrintMap.set(nid, {
        national_id: nid,
        employee_name: String(r.employee_name || raw['اسم المؤمن عليه'] || raw['الاسم'] || '').trim(),
        insurance_number: String(r.insurance_number || raw['الرقم التأميني للمؤمن علية'] || raw['الرقم التاميني'] || '').trim(),
        insurance_job_title: String(r.insurance_job_title || raw['المهنة'] || raw['الوظيفه في التامينات'] || '').trim(),
        company_account: acc,
        subscription_start_date: String(r.subscription_start_date || raw['تاريخ بداية المده'] || raw['تاريخ بدايه الاشتراك'] || '').trim(),
        wage_start_date: raw['تاريخ بداية الاجر'] || raw['تاريخ بداية الأجر'] || '',
        insurance_salary: parseFloat(String(raw['قيمة الاجر'] || raw['الاجر التاميني'] || raw['الاجر التامينى'] || '0').replace(/[^\d.]/g, '')) || 0,
        performance_number: String(r.employee_code || raw['رقم الاداء'] || raw['الكود'] || '').trim(),
        status: String(r.insurance_status || r.status || raw['الحاله'] || 'Active').trim(),
        raw_data: raw,
      });
    }
  });

  // 2. فهرسة شيت وارد التأمين (Incoming Insurance S1)
  // Identity linkage is by 14-digit national ID ONLY (user rule): no
  // employee-code fallback index — a code is a per-company label, never an identity.
  const incomingByNid = new Map<string, typeof incomingRecords[0]>();
  incomingRecords.forEach((r) => {
    const raw = (r.raw_data as Record<string, string>) || {};
    const nid = cleanNationalId(r.national_id || raw['الرقم القومى'] || raw['الرقم القومي']) || '';
    if (nid) incomingByNid.set(nid, r);
  });

  // 3. فهرسة شيت الاستقالات (Resignations S6)
  const resignationByNid = new Map<string, typeof resignationRecords[0]>();
  resignationRecords.forEach((r) => {
    const raw = (r.raw_data as Record<string, string>) || {};
    const nid = cleanNationalId(r.national_id || raw['الرقم القومى'] || raw['الرقم القومي']) || '';
    if (nid) resignationByNid.set(nid, r);
  });

  // 4. فهرسة المرتبات (Payroll)
  interface PayrollAggregated {
    nid: string;
    code: string;
    name: string;
    jobTitle: string;
    companyAccount: string;
    latestSalary: number;
    salariesCount: number;
    hireDate?: string;
  }
  const payrollMap = new Map<string, PayrollAggregated>();

  payrollRecords.forEach((r) => {
    const raw = (r.raw_data as Record<string, string>) || {};
    const nid = cleanNationalId(r.national_id || raw['الرقم القومي'] || raw['الرقم القومى']) || '';
    const code = (r.employee_code || raw['الكود'] || '').trim();
    // NID-only identity (user rule): rows without a valid NID stay unlinked —
    // a bare code never attaches a payroll row to a person.
    const key = nid;
    if (!key) return;

    const acc = (raw['الشركة'] || raw['الشركه'] || '').trim();
    if (targetAccount !== 'ALL' && acc.toUpperCase() !== targetAccount.toUpperCase()) return;

    const sal = parseFloat(String(raw['الراتب'] || raw['اجمالي المستحق'] || raw['صافى التحويل'] || '0').replace(/[^\d.]/g, '')) || 0;
    const name = (r.employee_name || raw['الاسم'] || '').trim();
    const job = ((r.job_title as string) || raw['الوظيفة نهائي'] || raw['الوظيفة'] || '').trim();

    if (!payrollMap.has(key)) {
      payrollMap.set(key, {
        nid,
        code,
        name,
        jobTitle: job,
        companyAccount: acc,
        latestSalary: sal,
        salariesCount: sal > 0 ? 1 : 0,
        hireDate: raw['تاريخ استلام العمل'] || raw['تاريخ التعيين'],
      });
    } else {
      const existing = payrollMap.get(key)!;
      if (!existing.nid && nid) existing.nid = nid;
      if (!existing.code && code) existing.code = code;
      if (!existing.name && name) existing.name = name;
      if (!existing.jobTitle && job) existing.jobTitle = job;
      if (sal > 0) {
        existing.latestSalary = sal;
        existing.salariesCount++;
      }
    }
  });

  // 5. فهرسة جدول الموظفين الموحد (Master)
  const masterByNid = new Map<string, typeof masterRecords[0]>();
  masterRecords.forEach((m) => {
    if (m.national_id) masterByNid.set(m.national_id.trim(), m);
  });

  // جمع كافة الأرقام القومية والأكواد الفريدة لفحصها
  const allNids = new Set<string>();
  officialPrintMap.forEach((_, nid) => allNids.add(nid));
  payrollMap.forEach((p) => { if (p.nid) allNids.add(p.nid); });
  masterRecords.forEach((m) => { if (m.national_id) allNids.add(m.national_id.trim()); });

  // ═══════════════════════════════════════════════════════════════════════════
  // 6. تشغيل خوارزمية المطابقة والتدقيق الجنائي
  // ═══════════════════════════════════════════════════════════════════════════

  const records: MatchedForensicRecord[] = [];
  let matchedCount = 0;
  let jobTitleConflictCount = 0;
  let missingInPrintCount = 0;
  let suppliedS1Count = 0;
  let hiredAfterPrintDateCount = 0;
  let confirmedUninsuredCount = 0;
  let missingInPayrollCount = 0;
  let dataDiscrepancyCount = 0;

  for (const nid of Array.from(allNids)) {
    const printRec = officialPrintMap.get(nid);
    const masterRec = masterByNid.get(nid);
    const payRec = payrollMap.get(nid);
    const incomingRec = incomingByNid.get(nid);
    const resRec = resignationByNid.get(nid);

    const empCode = masterRec?.employee_code || payRec?.code || printRec?.performance_number || incomingRec?.employee_code || '';
    const empName = masterRec?.employee_name || payRec?.name || incomingRec?.employee_name || printRec?.employee_name || 'بدون اسم';
    const compAccount = masterRec?.company_account || payRec?.companyAccount || printRec?.company_account || incomingRec?.company_account || '';

    if (targetAccount !== 'ALL' && compAccount.toUpperCase() !== targetAccount.toUpperCase()) {
      continue;
    }

    const compositeKey = getCompositeEmployeeKey(compAccount, empCode, nid);

    // التحقق من الاسم وتحديد درجة التطابق
    let nameConfidence: MatchedForensicRecord['nameMatchConfidence'] = 'متطابق تماماً';
    if (!printRec) {
      nameConfidence = 'غير مسجل بالبرنت';
    } else {
      const normEmpName = normalizeArabicText(empName);
      const normPrintName = normalizeArabicText(printRec.employee_name);
      if (normEmpName === normPrintName) {
        nameConfidence = 'متطابق تماماً';
      } else {
        // فحص التشابه: إذا كان يتطابق في مقطعين أو أكثر
        const p1 = normEmpName.split(' ').filter(Boolean);
        const p2 = normPrintName.split(' ').filter(Boolean);
        const commonWords = p1.filter((w) => p2.includes(w)).length;
        if (commonWords >= 2) {
          nameConfidence = 'تباين طفيف بالحروف';
        } else {
          nameConfidence = 'تعارض أسماء يحتاج تدقيق';
          dataDiscrepancyCount++;
        }
      }
    }

    // ── الفحص الذكي للوظائف والمواءمة المهنية المعتمدة ──
    const actualJob = cleanJobTitle(masterRec?.current_job_title || payRec?.jobTitle || incomingRec?.job_title);
    const insJob = cleanJobTitle(printRec?.insurance_job_title || masterRec?.insurance_job_title || incomingRec?.insurance_job_title);
    
    const jobEval = evaluateJobEquivalence(actualJob, insJob);
    const jobConflictStatus: MatchedForensicRecord['jobConflictStatus'] = jobEval.status;
    const jobConflictDetails = jobEval.details;

    if (jobConflictStatus === 'تعارض مسميات') {
      jobTitleConflictCount++;
    }

    // الأرقام التأمينية
    const insNumPrint = cleanJobTitle(printRec?.insurance_number);
    const insNumMaster = cleanJobTitle(masterRec?.insurance_number || incomingRec?.insurance_number);
    let insNumberMatch: MatchedForensicRecord['insNumberMatch'] = 'متطابق';

    if (insNumPrint && insNumMaster) {
      if (insNumPrint === insNumMaster) {
        insNumberMatch = 'متطابق';
      } else {
        insNumberMatch = 'اختلاف أرقام تأمينية';
        dataDiscrepancyCount++;
      }
    } else if (insNumPrint && !insNumMaster) {
      insNumberMatch = 'مفقود بالشركة';
    } else if (!insNumPrint && insNumMaster) {
      insNumberMatch = 'مفقود بالبرنت';
    }

    // ── التحليل الزمني الدقيق للتعيينات (تجاوز مشكلة التاريخ المصري والـ NaN) ──
    const masterConflicts = ((masterRec?.consolidated_data as Record<string, unknown> | null)?.field_conflicts || {}) as Record<string, unknown>;
    const hireWithheld = !masterRec?.hire_date && !!(masterConflicts['hire_date'] || masterConflicts['تاريخ استلام العمل']);
    // Withheld (cross-source conflict) hire date: no silent single-source
    // fallback — the audit marks it needs-review instead of picking a value.
    const rawHire = hireWithheld ? '' : (masterRec?.hire_date || payRec?.hireDate || (incomingRec?.raw_data as Record<string, string>)?.['تاريخ استلام العمل'] || (masterRec?.consolidated_data as Record<string, string>)?.['تاريخ التعيين'] || '');
    const parsedHire = parseEgyptianDate(rawHire);
    let isHiredAfterCutoff = false;
    let formattedHireDate = rawHire ? String(rawHire).trim() : '—';
    if (parsedHire) {
      isHiredAfterCutoff = parsedHire.getTime() > PRINT_CUTOFF_DATE.getTime();
      formattedHireDate = `${parsedHire.getFullYear()}-${String(parsedHire.getMonth() + 1).padStart(2, '0')}-${String(parsedHire.getDate()).padStart(2, '0')}`;
    }

    // تجهيز تفاصيل وارد التأمين إن وجدت
    let incDetails: MatchedForensicRecord['incomingDetails'] = undefined;
    if (incomingRec) {
      const rawInc = (incomingRec.raw_data as Record<string, string>) || {};
      incDetails = {
        formType: incomingRec.form_type || rawInc['نوع الاستماره'] || rawInc['نوع الاستمارة'] || undefined,
        crmNumber: incomingRec.crm_number || rawInc['رقم ال CRM'] || rawInc['رقم CRM'] || undefined,
        supplyMethod: incomingRec.supply_method || rawInc['طريقه التوريد'] || rawInc['طريقة التوريد'] || undefined,
        recordDate: incomingRec.record_date || rawInc['التاريخ'] || undefined,
        insuranceStatus: incomingRec.insurance_status || rawInc['الحاله التامينية'] || rawInc['الحالة التأمينية'] || undefined,
      };
    }

    // تفاصيل الاستقالة إن وجدت
    let resDetails: MatchedForensicRecord['resignationDetails'] = undefined;
    if (resRec) {
      const rawRes = (resRec.raw_data as Record<string, string>) || {};
      resDetails = {
        resignationDate: resRec.resignation_date || rawRes['تاريخ الاستقاله'] || rawRes['تاريخ الاستقالة'] || undefined,
        lastWorkingDay: resRec.last_working_day || rawRes['اخر يوم عمل'] || rawRes['آخر يوم عمل'] || undefined,
        resignationType: resRec.resignation_type || rawRes['نوع الاستقاله'] || rawRes['نوع الاستقالة'] || undefined,
      };
    }

    // ── تحديد التصنيف النهائي والإجراء المطلوب الصارم ──
    let finalStatus: MatchedForensicRecord['finalForensicStatus'] = 'مطابق ومعتمد';
    let actionRequired = 'البيانات سليمة ومطابقة ✓';

    const inPrint = !!printRec;
    // A payroll record with an EXPLICIT 0 salary is still present evidence;
    // only a missing record means "not in payroll".
    const inPay = !!payRec;
    const hasIncomingS1 = !!(
      incDetails?.formType?.includes('1') ||
      incDetails?.crmNumber ||
      incDetails?.insuranceStatus?.includes('توريد') ||
      incDetails?.insuranceStatus?.includes('تأمين') ||
      incDetails?.insuranceStatus?.includes('تامين') ||
      incomingRec
    );
    const isResigned = !!(resRec || masterRec?.current_status === 'Resigned' || masterRec?.current_status === 'مستقيل');

    if (inPrint && inPay) {
      if (jobConflictStatus === 'تعارض مسميات') {
        finalStatus = 'تعارض مسميات وظيفية رسمي';
        actionRequired = `تقديم طلب تعديل مهنة بالتأمينات من (${insJob}) إلى (${actualJob})`;
      } else if (nameConfidence === 'تعارض أسماء يحتاج تدقيق') {
        finalStatus = 'تعارض أرقام تأمينية أو أسماء';
        actionRequired = 'مراجعة أصل بطاقة الرقم القومي للموظف والاسم المدون بالهيئة';
      } else {
        finalStatus = 'مطابق ومعتمد';
        actionRequired = 'سجل موثق وسليم - لا يتطلب إجراء';
        matchedCount++;
      }
    } else if (!inPrint && inPay) {
      missingInPrintCount++;
      if (isHiredAfterCutoff) {
        finalStatus = 'تعيين جديد بعد تاريخ البرنت (22/09/2026)';
        actionRequired = 'الموظف عُين بعد تاريخ تحديث البرنت - متابعة ظهوره في برنت الدورة القادمة';
        hiredAfterPrintDateCount++;
      } else if (hasIncomingS1) {
        finalStatus = 'تم توريد س1 بوارد التأمين وجارٍ الاعتماد';
        actionRequired = `تم التوريد لمكتب (${incDetails?.supplyMethod || 'التأمينات'}) برقم CRM (${incDetails?.crmNumber || '—'}) - متابعة قيد الرقم التأميني`;
        suppliedS1Count++;
      } else if (isResigned) {
        finalStatus = 'مستقيل في شيت الاستقالات (RES)';
        actionRequired = 'الموظف مستقيل بالشركة ولم يسجل بالتأمينات - مراجعة عدم صرف رواتب بعد الاستقالة';
      } else {
        finalStatus = 'مخالفة تأمينية مؤكدة (غير مؤمن عليه ولم يُرصد له توريد س1)';
        actionRequired = '⚠️ يلزم تحرير وتوريد استمارة 1 تأمينات فوراً لتجنب غرامات التأخير';
        confirmedUninsuredCount++;
      }
    } else if (inPrint && !inPay) {
      missingInPayrollCount++;
      if (isResigned) {
        finalStatus = 'مستقيل في شيت الاستقالات (RES)';
        actionRequired = 'الموظف ترك الخدمة وما زال مسجلاً بالتأمينات - يلزم توريد استمارة 6 لغلق مدته';
      } else {
        finalStatus = 'مسجل بالتأمينات ولا يتقاضى راتباً بالمرتبات';
        actionRequired = 'فحص موقف الموظف: هل هو إجازة بدون أجر أم ترك العمل دون س6 لتحاشي سداد حصة الشركة';
      }
    } else if (!inPrint && !inPay && hasIncomingS1) {
      finalStatus = 'تم توريد س1 بوارد التأمين وجارٍ الاعتماد';
      actionRequired = `استمارة س1 موردة بوارد التأمين (CRM: ${incDetails?.crmNumber || '—'}) في انتظار صدور الرقم`;
      suppliedS1Count++;
    }

    records.push({
      nationalId: nid,
      employeeCode: empCode,
      compositeKey,
      companyAccount: compAccount,
      employeeName: empName,
      insuredNameInPrint: printRec?.employee_name || '—',
      nameMatchConfidence: nameConfidence,
      actualJobTitle: actualJob || '—',
      insuranceJobTitle: insJob || '—',
      jobConflictStatus,
      jobConflictDetails,
      insuranceNumberInPrint: insNumPrint || '—',
      insuranceNumberInMaster: insNumMaster || '—',
      insNumberMatch,
      insuranceSalaryInPrint: printRec?.insurance_salary || 0,
      actualPayrollSalary: payRec?.latestSalary || 0,
      salaryNotes: printRec?.insurance_salary && payRec?.latestSalary
        ? `أجر التأمين: ${printRec.insurance_salary} ج.م | الراتب الفعلي: ${payRec.latestSalary} ج.م`
        : '—',
      hireDate: hireWithheld ? 'متعارض — يحتاج مراجعة' : formattedHireDate,
      insuranceStartDate: printRec?.subscription_start_date || masterRec?.insurance_start_date || '—',
      dateNotes: hireWithheld ? 'تاريخ الاستلام متعارض بين المصادر — يحتاج مراجعة' : (isHiredAfterCutoff ? 'تعيين بعد تاريخ البرنت' : '—'),
      foundInPrint: inPrint,
      foundInPayroll: inPay,
      foundInIncomingInsurance: !!incomingRec,
      foundInResignation: !!resRec,
      foundInMonthlyInsurance: monthlyInsRecords.some((m) => m.national_id === nid),
      incomingDetails: incDetails,
      resignationDetails: resDetails,
      finalForensicStatus: finalStatus,
      actionRequired,
    });
  }

  // فرز السجلات: الحالات التي تتطلب إجراء أولاً، ثم حسب كود الموظف
  records.sort((a, b) => {
    if (a.finalForensicStatus !== 'مطابق ومعتمد' && b.finalForensicStatus === 'مطابق ومعتمد') return -1;
    if (a.finalForensicStatus === 'مطابق ومعتمد' && b.finalForensicStatus !== 'مطابق ومعتمد') return 1;
    const numA = parseInt(a.employeeCode, 10);
    const numB = parseInt(b.employeeCode, 10);
    if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
    return a.employeeCode.localeCompare(b.employeeCode);
  });

  const summary: ForensicAuditSummary = {
    auditDate: new Date().toLocaleDateString('ar-EG'),
    printReferenceDate: '2026-09-22',
    totalUniqueEmployeesAnalyzed: records.length,
    matchedCount,
    jobTitleConflictCount,
    missingInPrintCount,
    suppliedS1Count,
    hiredAfterPrintDateCount,
    confirmedUninsuredCount,
    missingInPayrollCount,
    dataDiscrepancyCount,
    duplicateNationalIdsCount: 0,
  };

  const result = { summary, records };
  auditCache.set(cacheKey, { account: targetAccount, timestamp: Date.now(), data: result });

  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. مولد مصنف الإكسيل الجنائي الشامل ذي الـ 7 شيتات (Forensic Excel Workbook)
// ═══════════════════════════════════════════════════════════════════════════

export async function generateOfficialPrintForensicWorkbook(
  targetAccount: 'E.G' | 'm.g' | 'ALL' = 'ALL',
  subset: string = 'all'
): Promise<Buffer> {
  const { summary, records } = await runOfficialPrintForensicAudit(targetAccount);
  const wb = XLSX.utils.book_new();

  // ── Sheet 1: تقرير المطابقة التامة (Matched) ──
  const matchedRows = records
    .filter((r) => r.finalForensicStatus === 'مطابق ومعتمد')
    .map((r, i) => ({
      'م': i + 1,
      'المعرف المركب (Account#Code)': r.compositeKey,
      'الشركة': r.companyAccount,
      'كود الموظف': r.employeeCode,
      'الرقم القومي': r.nationalId,
      'اسم الموظف بالشركة': r.employeeName,
      'اسم المؤمن عليه بالتأمينات': r.insuredNameInPrint,
      'الرقم التأميني': r.insuranceNumberInPrint,
      'الوظيفة الفعلية': r.actualJobTitle,
      'المهنة المسجلة بالتأمينات': r.insuranceJobTitle,
      'الأجر التأميني': r.insuranceSalaryInPrint,
      'تاريخ بداية الاشتراك': r.insuranceStartDate,
      'حالة المطابقة': r.finalForensicStatus,
      'الإجراء المطلوب': r.actionRequired,
    }));
  const ws1 = XLSX.utils.json_to_sheet(matchedRows.length > 0 ? matchedRows : [{ 'ملاحظة': 'لا توجد سجلات مطابقة تامة' }]);

  // ── Sheet 2: تقرير التعارض الوظيفي والمسميات (Job Titles) ──
  const jobConflictRows = records
    .filter((r) => r.jobConflictStatus === 'تعارض مسميات' || r.finalForensicStatus === 'تعارض مسميات وظيفية رسمي')
    .map((r, i) => ({
      'م': i + 1,
      'المعرف المركب': r.compositeKey,
      'الشركة': r.companyAccount,
      'كود الموظف': r.employeeCode,
      'الرقم القومي': r.nationalId,
      'اسم الموظف': r.employeeName,
      'الوظيفة الفعلية (بالمرتبات)': r.actualJobTitle,
      'المهنة المسجلة (بالتأمينات)': r.insuranceJobTitle,
      'طبيعة التعارض': r.jobConflictDetails,
      'الرقم التأميني': r.insuranceNumberInPrint,
      'الأجر التأميني': r.insuranceSalaryInPrint,
      'الإجراء القانوني المقترح': r.actionRequired,
    }));
  const ws2 = XLSX.utils.json_to_sheet(jobConflictRows.length > 0 ? jobConflictRows : [{ 'ملاحظة': 'لا توجد تعارضات وظيفية' }]);

  // ── Sheet 3: تقرير تناقض واختلاف البيانات (Discrepancies) ──
  const discrepancyRows = records
    .filter((r) => r.insNumberMatch === 'اختلاف أرقام تأمينية' || r.nameMatchConfidence.includes('تعارض'))
    .map((r, i) => ({
      'م': i + 1,
      'المعرف المركب': r.compositeKey,
      'الشركة': r.companyAccount,
      'كود الموظف': r.employeeCode,
      'الرقم القومي': r.nationalId,
      'الاسم بالشركة': r.employeeName,
      'الاسم ببرنت التأمينات': r.insuredNameInPrint,
      'تطابق الأسماء': r.nameMatchConfidence,
      'الرقم التأميني ببرنت التأمينات': r.insuranceNumberInPrint,
      'الرقم التأميني المسجل بالشركة': r.insuranceNumberInMaster,
      'حالة الرقم التأميني': r.insNumberMatch,
      'ملاحظات الرواتب': r.salaryNotes,
      'الإجراء المطلوب': r.actionRequired,
    }));
  const ws3 = XLSX.utils.json_to_sheet(discrepancyRows.length > 0 ? discrepancyRows : [{ 'ملاحظة': 'لا توجد تناقضات بيانات' }]);

  // ── Sheet 4: بالمرتبات وغير مسجل بالبرنت (مع بيان وارد التأمين وتاريخ 22/09/2026) ──
  const missingInPrintRows = records
    .filter((r) => !r.foundInPrint && r.foundInPayroll)
    .map((r, i) => ({
      'م': i + 1,
      'المعرف المركب': r.compositeKey,
      'الشركة': r.companyAccount,
      'كود الموظف': r.employeeCode,
      'الرقم القومي': r.nationalId,
      'اسم الموظف': r.employeeName,
      'الوظيفة الفعلية': r.actualJobTitle,
      'الراتب الفعلي بالمرتبات': r.actualPayrollSalary,
      'تاريخ استلام العمل': r.hireDate,
      'التصنيف الرقابي': r.finalForensicStatus,
      'هل تم توريد س1 بوارد التأمين؟': r.incomingDetails?.formType || (r.incomingDetails?.crmNumber ? 'نعم (س1)' : 'لا'),
      'رقم الـ CRM': r.incomingDetails?.crmNumber || '—',
      'مكتب التوريد': r.incomingDetails?.supplyMethod || '—',
      'تاريخ التوريد': r.incomingDetails?.recordDate || '—',
      'حالة التوريد بوارد التأمين': r.incomingDetails?.insuranceStatus || '—',
      'الإجراء التنفيذي المطلوب': r.actionRequired,
    }));
  const ws4 = XLSX.utils.json_to_sheet(missingInPrintRows.length > 0 ? missingInPrintRows : [{ 'ملاحظة': 'جميع الموظفين بالمرتبات مسجلون بالتأمينات' }]);

  // ── Sheet 5: بالبرنت وغير موجود بالمرتبات (Missing in Payroll) ──
  const missingInPayrollRows = records
    .filter((r) => r.foundInPrint && !r.foundInPayroll)
    .map((r, i) => ({
      'م': i + 1,
      'المعرف المركب': r.compositeKey,
      'الشركة': r.companyAccount,
      'رقم الأداء (الكود)': r.employeeCode,
      'الرقم القومي': r.nationalId,
      'اسم المؤمن عليه بالتأمينات': r.insuredNameInPrint,
      'الرقم التأميني': r.insuranceNumberInPrint,
      'المهنة المسجلة بالتأمينات': r.insuranceJobTitle,
      'الأجر التأميني': r.insuranceSalaryInPrint,
      'تاريخ بداية الاشتراك': r.insuranceStartDate,
      'هل مسجل بشيت الاستقالات (RES)؟': r.resignationDetails ? `مستقيل (${r.resignationDetails.resignationDate || '—'})` : 'لا توجد استقالة مسجلة',
      'نوع الاستقالة': r.resignationDetails?.resignationType || '—',
      'آخر يوم عمل': r.resignationDetails?.lastWorkingDay || '—',
      'التصنيف الرقابي': r.finalForensicStatus,
      'الإجراء المطلوب': r.actionRequired,
    }));
  const ws5 = XLSX.utils.json_to_sheet(missingInPayrollRows.length > 0 ? missingInPayrollRows : [{ 'ملاحظة': 'لا توجد سجلات تأمينية بلا مرتبات' }]);

  // ── Sheet 6: التكرار وتعارض الشركات والحسابات ──
  const duplicateMap = new Map<string, MatchedForensicRecord[]>();
  records.forEach((r) => {
    if (!duplicateMap.has(r.nationalId)) duplicateMap.set(r.nationalId, []);
    duplicateMap.get(r.nationalId)!.push(r);
  });
  const duplicateRows: Record<string, unknown>[] = [];
  let dupIndex = 1;
  duplicateMap.forEach((list, nid) => {
    if (list.length > 1) {
      list.forEach((r) => {
        duplicateRows.push({
          'م': dupIndex++,
          'الرقم القومي': nid,
          'المعرف المركب': r.compositeKey,
          'الشركة': r.companyAccount,
          'كود الموظف': r.employeeCode,
          'اسم الموظف': r.employeeName,
          'الرقم التأميني': r.insuranceNumberInPrint,
          'الموقف': 'رقم قومي مكرر في أكثر من سجل أو حساب',
          'الإجراء المقترح': 'التحقق من عدم تكرار قيد الموظف بين حسابات المجموعة دون نقل تأميني',
        });
      });
    }
  });
  const ws6 = XLSX.utils.json_to_sheet(duplicateRows.length > 0 ? duplicateRows : [{ 'ملاحظة': 'لا توجد أرقام قومية مكررة عبر الحسابات' }]);

  // ── Sheet 7: جدول التعديلات والإجراءات المقترحة (Action Plan) ──
  const actionPlanRows = records
    .filter((r) => r.finalForensicStatus !== 'مطابق ومعتمد')
    .map((r, i) => ({
      'م': i + 1,
      'المعرف المركب': r.compositeKey,
      'الشركة': r.companyAccount,
      'كود الموظف': r.employeeCode,
      'الرقم القومي': r.nationalId,
      'اسم الموظف': r.employeeName,
      'الوظيفة الفعلية': r.actualJobTitle,
      'المهنة بالتأمينات': r.insuranceJobTitle,
      'الرقم التأميني': r.insuranceNumberInPrint,
      'الحالة الحالية': r.finalForensicStatus,
      'الإجراء المطلوب للتصحيح': r.actionRequired,
      'النموذج التأميني المطلوب': 
        r.finalForensicStatus.includes('س1') ? 'استمارة 1'
        : r.finalForensicStatus.includes('س6') || r.finalForensicStatus.includes('مستقيل') ? 'استمارة 6'
        : r.finalForensicStatus.includes('مهنة') ? 'طلب تعديل مهنة (س2)'
        : 'مراجعة وتدقيق بطاقة',
      'حالة الاعتماد': 'في انتظار اعتماد مدير التأمينات',
    }));
  const ws7 = XLSX.utils.json_to_sheet(actionPlanRows.length > 0 ? actionPlanRows : [{ 'ملاحظة': 'جميع الحالات معتمدة ولا توجد إجراءات معلقة' }]);

  // إضافة الشيتات وفقاً للاختيار (subset)
  const allSheets = [
    { ws: ws1, name: '1-المطابقة التامة', id: 'matched' },
    { ws: ws2, name: '2-التعارض الوظيفي', id: 'job_conflicts' },
    { ws: ws3, name: '3-تناقض البيانات', id: 'discrepancies' },
    { ws: ws4, name: '4-بالمرتبات وغير بالبرنت', id: 'missing_in_print' },
    { ws: ws5, name: '5-بالبرنت وبلا مرتبات', id: 'missing_in_payroll' },
    { ws: ws6, name: '6-التكرار وتعارض الحسابات', id: 'data_quality' },
    { ws: ws7, name: '7-التعديلات المقترحة', id: 'actions' },
  ];

  if (subset === 'all') {
    allSheets.forEach(({ ws, name }) => {
      (ws as unknown as { '!views'?: Array<{ rightToLeft?: boolean }> })['!views'] = [{ rightToLeft: true }];
      XLSX.utils.book_append_sheet(wb, ws, name);
    });
  } else {
    const target = allSheets.find((s) => s.id === subset);
    if (target) {
      (target.ws as unknown as { '!views'?: Array<{ rightToLeft?: boolean }> })['!views'] = [{ rightToLeft: true }];
      XLSX.utils.book_append_sheet(wb, target.ws, target.name);
    } else {
      // Fallback: append all
      allSheets.forEach(({ ws, name }) => {
        (ws as unknown as { '!views'?: Array<{ rightToLeft?: boolean }> })['!views'] = [{ rightToLeft: true }];
        XLSX.utils.book_append_sheet(wb, ws, name);
      });
    }
  }

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}
