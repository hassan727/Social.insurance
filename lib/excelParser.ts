import * as XLSX from 'xlsx';

export type SourceType = 'incoming_insurance' | 'res' | 'monthly_payroll' | 'monthly_insurance';

export interface ExpectedColumn {
  key: string;
  label: string;
  required: boolean;
  aliases: string[];
}

export const SOURCE_COLUMNS: Record<SourceType, ExpectedColumn[]> = {
  incoming_insurance: [
    { key: 'employee_code', label: 'الكود', required: false, aliases: ['الكود', 'كود', 'code', 'emp_code'] },
    { key: 'employee_name', label: 'الاسم', required: true, aliases: ['الاسم', 'اسم الموظف', 'name'] },
    { key: 'national_id', label: 'الرقم القومي', required: false, aliases: ['الرقم القومي', 'القومي', 'national_id'] },
    { key: 'company_account', label: 'الشركة (Account)', required: false, aliases: ['الشركه', 'الشركة', 'company', 'account'] },
    { key: 'job_title', label: 'الوظيفة', required: false, aliases: ['الوظيفه', 'الوظيفة', 'job'] },
    { key: 'status', label: 'الحالة', required: false, aliases: ['الحاله', 'الحالة', 'status'] },
    { key: 'insurance_number', label: 'الرقم التأميني', required: false, aliases: ['الرقم التاميني', 'الرقم التأميني', 'insurance_no'] },
    { key: 'insurance_status', label: 'الحالة التأمينية', required: false, aliases: ['الحاله التامينية', 'الحالة التأمينية', 'insurance_status'] },
    { key: 'termination_reason', label: 'سبب الانتهاء', required: false, aliases: ['سبب الانتهاء', 'سبب انتهاء الاشتراك'] },
    { key: 'form_type', label: 'نوع الاستمارة', required: false, aliases: ['نوع الاستماره', 'نوع الاستمارة'] },
    { key: 'insurance_job_title', label: 'الوظيفة في التأمينات', required: false, aliases: ['الوظيفه في التامينات', 'الوظيفة في التأمينات'] },
    { key: 'subscription_start_date', label: 'تاريخ بداية الاشتراك', required: false, aliases: ['تاريخ بدايه الاشتراك', 'تاريخ بداية الاشتراك'] },
    { key: 'subscription_end_date', label: 'تاريخ نهاية الاشتراك', required: false, aliases: ['تاريخ نهاية الاشتراك', 'تاريخ نهايه الاشتراك'] },
    { key: 'supply_method', label: 'طريقة التوريد', required: false, aliases: ['طريقه التوريد', 'طريقة التوريد'] },
    { key: 'crm_number', label: 'رقم ال CRM', required: false, aliases: ['رقم ال CRM', 'crm'] },
    { key: 'record_date', label: 'التاريخ', required: false, aliases: ['التاريخ', 'date'] },
    { key: 'note', label: 'ملاحظة', required: false, aliases: ['note', 'ملاحظات', 'ملاحظة'] },
  ],
  res: [
    { key: 'employee_code', label: 'الكود', required: false, aliases: ['الكود', 'كود', 'code'] },
    { key: 'employee_name', label: 'الاسم', required: true, aliases: ['الاسم', 'اسم الموظف', 'name'] },
    { key: 'national_id', label: 'الرقم القومي', required: false, aliases: ['الرقم القومي', 'القومي', 'national_id'] },
    { key: 'resignation_date', label: 'تاريخ الاستقالة', required: false, aliases: ['تاريخ الاستقاله', 'تاريخ الاستقالة'] },
    { key: 'last_working_day', label: 'آخر يوم عمل', required: false, aliases: ['اخر يوم عمل', 'آخر يوم عمل'] },
    { key: 'resignation_type', label: 'نوع الاستقالة', required: false, aliases: ['نوع الاستقاله', 'نوع الاستقالة'] },
    { key: 'insurance_supply_type', label: 'نوع توريد تأمينات', required: false, aliases: ['نوع توريد تامينات', 'نوع توريد تأمينات'] },
    { key: 'supply_date', label: 'تاريخ التوريد', required: false, aliases: ['تاريخ التوريد'] },
  ],
  monthly_payroll: [
    { key: 'employee_code', label: 'الكود', required: false, aliases: ['الكود', 'كود', 'code'] },
    { key: 'national_id', label: 'الرقم القومي', required: false, aliases: ['الرقم القومي', 'القومي', 'national_id'] },
    { key: 'employee_name', label: 'الاسم', required: true, aliases: ['الاسم', 'اسم الموظف', 'name'] },
    { key: 'attendance_days', label: 'عدد أيام الحضور', required: false, aliases: ['عدد ايام الحضور', 'عدد أيام الحضور', 'ايام الحضور'] },
    { key: 'job_title', label: 'الوظيفة نهائي', required: false, aliases: ['الوظيفة نهائي', 'الوظيفه نهائي', 'الوظيفة'] },
    { key: 'region', label: 'المنطقة نهائي', required: false, aliases: ['المنطقة نهائي', 'المنطقه نهائي', 'المنطقة'] },
    { key: 'department', label: 'الإدارة نهائي', required: false, aliases: ['الادارة نهائي', 'الإدارة نهائي', 'الادارة'] },
    { key: 'sap_code', label: 'كود الساب', required: false, aliases: ['كود الساب', 'ساب'] },
    { key: 'review_status', label: 'مراجعة', required: false, aliases: ['مراجعة', 'مراجعه'] },
    { key: 'note', label: 'ملاحظة', required: false, aliases: ['NOTE', 'note', 'ملاحظات'] },
  ],
  monthly_insurance: [
    { key: 'employee_code', label: 'الكود', required: false, aliases: ['الكود', 'كود', 'code'] },
    { key: 'employee_name', label: 'الاسم', required: true, aliases: ['الاسم', 'اسم الموظف', 'name'] },
    { key: 'national_id', label: 'الرقم القومي', required: false, aliases: ['الرقم القومي', 'القومي', 'national_id'] },
    { key: 'insurance_number', label: 'الرقم التأميني', required: false, aliases: ['الرقم التأميني', 'الرقم التاميني', 'insurance_no'] },
    { key: 'job_title', label: 'الوظيفة نهائي', required: false, aliases: ['الوظيفة نهائي', 'الوظيفه نهائي', 'الوظيفة'] },
    { key: 'region', label: 'المنطقة نهائي', required: false, aliases: ['المنطقة نهائي', 'المنطقه نهائي', 'المنطقة'] },
    { key: 'department', label: 'الإدارة نهائي', required: false, aliases: ['الادارة نهائي', 'الإدارة نهائي', 'الادارة'] },
    { key: 'sap_code', label: 'كود الساب', required: false, aliases: ['كود الساب', 'ساب'] },
  ],
};

function normalizeHeader(str: string): string {
  return str
    .trim()
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

export function autoMapColumns(
  actualHeaders: string[],
  sourceType: SourceType
): Record<string, string> {
  const expected = SOURCE_COLUMNS[sourceType];
  const mapping: Record<string, string> = {};

  const normalizedActual = actualHeaders.map((h) => ({
    original: h,
    normalized: normalizeHeader(h),
  }));

  for (const exp of expected) {
    const normAliases = exp.aliases.map((a) => normalizeHeader(a));
    const match = normalizedActual.find((act) => normAliases.includes(act.normalized));
    if (match) {
      mapping[exp.key] = match.original;
    }
  }

  return mapping;
}

export function formatCellValue(val: unknown): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'number') {
    // Check if it's an integer
    return Number.isInteger(val) ? val.toString() : val.toString();
  }
  if (val instanceof Date) {
    return val.toISOString().split('T')[0];
  }
  return String(val).trim();
}

export function parseExcelBuffer(buffer: Buffer) {
  // Read workbook without evaluating formulas or executing scripts
  const workbook = XLSX.read(buffer, {
    type: 'buffer',
    cellDates: true,
    cellText: true,
    raw: false, // Ensures leading zeros are preserved when text formatting is present
  });

  return workbook;
}
