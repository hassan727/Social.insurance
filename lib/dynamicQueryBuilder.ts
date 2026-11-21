/**
 * Dynamic Query Builder
 * Purpose: Flexible report generation from employees_master and sheet_data
 */

import { supabaseServer } from './supabaseServer';
import * as XLSX from 'xlsx';

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface QueryFilter {
  field: string;
  operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'like' | 'in' | 'is_null' | 'is_not_null';
  value?: unknown;
}

export interface QueryRequest {
  // Base filters
  company_account?: 'E.G' | 'm.g' | 'ALL';
  
  // Select specific sheets to include data from
  include_sheets?: string[];
  
  // Select specific columns from employees_master
  master_columns?: string[];
  
  // Additional filters
  filters?: QueryFilter[];
  
  // Sorting
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
  
  // Pagination
  limit?: number;
  offset?: number;
}

export interface QueryResult {
  success: boolean;
  data: Record<string, unknown>[];
  total_count: number;
  columns: string[];
  query_info: {
    company_account: string;
    sheets_included: string[];
    filters_applied: number;
  };
}

export interface ReportExportRequest extends QueryRequest {
  report_title: string;
  report_type: 'excel' | 'csv';
  include_summary?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// QUERY BUILDER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Build and execute dynamic query
 */
export async function executeQuery(request: QueryRequest): Promise<QueryResult> {
  try {
    const {
      company_account = 'ALL',
      include_sheets = [],
      master_columns = ['employee_code', 'employee_name', 'national_id', 'current_status'],
      filters = [],
      sort_by = 'employee_code',
      sort_order = 'asc',
      limit = 1000,
      offset = 0,
    } = request;

    // Start building query
    let query = supabaseServer
      .from('employees_master')
      .select('*', { count: 'exact' });

    // Apply company_account filter
    if (company_account !== 'ALL') {
      query = query.eq('company_account', company_account);
    }

    // Apply custom filters
    for (const filter of filters) {
      const val = filter.value as any;
      switch (filter.operator) {
        case 'eq':
          query = query.eq(filter.field, val);
          break;
        case 'neq':
          query = query.neq(filter.field, val);
          break;
        case 'gt':
          query = query.gt(filter.field, val);
          break;
        case 'gte':
          query = query.gte(filter.field, val);
          break;
        case 'lt':
          query = query.lt(filter.field, val);
          break;
        case 'lte':
          query = query.lte(filter.field, val);
          break;
        case 'like':
          query = query.ilike(filter.field, `%${val}%`);
          break;
        case 'in':
          query = query.in(filter.field, filter.value as unknown[]);
          break;
        case 'is_null':
          query = query.is(filter.field, null);
          break;
        case 'is_not_null':
          query = query.not(filter.field, 'is', null);
          break;
      }
    }

    // Apply sorting
    query = query.order(sort_by, { ascending: sort_order === 'asc' });

    // Apply pagination
    query = query.range(offset, offset + limit - 1);

    // Execute query
    const { data: employees, error, count } = await query;

    if (error) {
      throw new Error(`فشل تنفيذ الاستعلام: ${error.message}`);
    }

    if (!employees || employees.length === 0) {
      return {
        success: true,
        data: [],
        total_count: 0,
        columns: master_columns,
        query_info: {
          company_account,
          sheets_included: include_sheets,
          filters_applied: filters.length,
        },
      };
    }

    // If specific sheets requested, fetch and merge their data
    const enrichedData: Record<string, unknown>[] = [];

    for (const emp of employees) {
      const empData: Record<string, unknown> = {};

      // Add selected master columns
      for (const col of master_columns) {
        empData[col] = emp[col as keyof typeof emp];
      }

      // Merge consolidated_data
      if (emp.consolidated_data && typeof emp.consolidated_data === 'object') {
        Object.assign(empData, emp.consolidated_data as Record<string, unknown>);
      }
      enrichedData.push(empData);
    }

    // Fetch specific sheet data in batch if requested
    if (include_sheets.length > 0 && employees.length > 0) {
      const empIds = employees.map((e) => e.id).filter(Boolean);
      const { data: batchSheetData } = await supabaseServer
        .from('sheet_data')
        .select('employee_id, sheet_id, row_data, dynamic_sheets(sheet_name, display_name)')
        .in('employee_id', empIds)
        .eq('is_latest', true);

      if (batchSheetData && batchSheetData.length > 0) {
        // Group by employee_id
        const sheetMap = new Map<string, Array<{ sheet_name: string; row_data: Record<string, unknown> }>>();
        for (const sd of batchSheetData) {
          if (!sd.employee_id) continue;
          const sheetInfo = sd.dynamic_sheets as unknown as { sheet_name: string; display_name: string } | null;
          if (sheetInfo && include_sheets.includes(sheetInfo.sheet_name)) {
            if (!sheetMap.has(sd.employee_id)) {
              sheetMap.set(sd.employee_id, []);
            }
            sheetMap.get(sd.employee_id)!.push({
              sheet_name: sheetInfo.sheet_name,
              row_data: (sd.row_data as Record<string, unknown>) || {},
            });
          }
        }

        // Attach to enrichedData
        for (let idx = 0; idx < employees.length; idx++) {
          const emp = employees[idx];
          const sheets = sheetMap.get(emp.id);
          if (sheets) {
            for (const s of sheets) {
              const prefixedData: Record<string, unknown> = {};
              for (const [key, value] of Object.entries(s.row_data)) {
                prefixedData[`${s.sheet_name}_${key}`] = value;
              }
              Object.assign(enrichedData[idx], prefixedData);
            }
          }
        }
      }
    }

    // Collect all unique columns
    const allColumns = new Set<string>();
    for (const row of enrichedData) {
      Object.keys(row).forEach((k) => allColumns.add(k));
    }

    return {
      success: true,
      data: enrichedData,
      total_count: count || 0,
      columns: Array.from(allColumns),
      query_info: {
        company_account,
        sheets_included: include_sheets,
        filters_applied: filters.length,
      },
    };
  } catch (error) {
    throw new Error(`Query execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// REPORT GENERATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate Excel report from query
 */
export async function generateDynamicReport(
  request: ReportExportRequest
): Promise<{ buffer: Buffer; filename: string }> {
  const {
    report_title = 'تقرير مخصص',
    report_type = 'excel',
    include_summary = true,
  } = request;

  // Execute query
  const queryResult = await executeQuery(request);

  if (!queryResult.success || queryResult.data.length === 0) {
    throw new Error('لا توجد بيانات لتصديرها');
  }

  const workbook = XLSX.utils.book_new();

  // Create main data sheet
  const worksheet = XLSX.utils.json_to_sheet(queryResult.data);
  XLSX.utils.book_append_sheet(workbook, worksheet, 'البيانات');

  // Auto-size columns
  const columnWidths = queryResult.columns.map((col) => ({
    wch: Math.max(col.length, 15),
  }));
  worksheet['!cols'] = columnWidths;

  // Add summary sheet if requested
  if (include_summary) {
    const summaryData = [
      { 'البند': 'عنوان التقرير', 'القيمة': report_title },
      { 'البند': 'تاريخ الإنشاء', 'القيمة': new Date().toLocaleString('ar-EG') },
      { 'البند': 'الحساب', 'القيمة': queryResult.query_info.company_account },
      { 'البند': 'عدد السجلات', 'القيمة': queryResult.total_count },
      { 'البند': 'عدد الأعمدة', 'القيمة': queryResult.columns.length },
      { 'البند': 'الورقات المضمنة', 'القيمة': queryResult.query_info.sheets_included.join(', ') || 'لا يوجد' },
      { 'البند': 'عدد الفلاتر المطبقة', 'القيمة': queryResult.query_info.filters_applied },
    ];

    const summarySheet = XLSX.utils.json_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(workbook, summarySheet, 'ملخص التقرير');

    // Calculate statistics by status
    const statusCounts: Record<string, number> = {};
    for (const row of queryResult.data) {
      const status = (row.current_status as string) || 'غير محدد';
      statusCounts[status] = (statusCounts[status] || 0) + 1;
    }

    const statsData = Object.entries(statusCounts).map(([status, count]) => ({
      'الحالة': status,
      'العدد': count,
      'النسبة المئوية': `${((count / queryResult.total_count) * 100).toFixed(1)}%`,
    }));

    const statsSheet = XLSX.utils.json_to_sheet(statsData);
    XLSX.utils.book_append_sheet(workbook, statsSheet, 'إحصائيات');
  }

  // Generate buffer
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

  // Generate filename
  const dateStr = new Date().toISOString().split('T')[0];
  const sanitizedTitle = report_title.replace(/[^a-zA-Z0-9_\u0600-\u06FF]/g, '_');
  const filename = `${sanitizedTitle}_${dateStr}.xlsx`;

  return { buffer: Buffer.from(buffer), filename };
}

// ═══════════════════════════════════════════════════════════════════════════
// PREDEFINED REPORT TEMPLATES
// ═══════════════════════════════════════════════════════════════════════════

export interface ReportTemplate {
  id: string;
  name: string;
  description: string;
  query: QueryRequest;
}

export const REPORT_TEMPLATES: ReportTemplate[] = [
  {
    id: 'all_employees',
    name: 'كشف شامل بجميع الموظفين',
    description: 'تقرير يشمل جميع الموظفين مع كل البيانات الأساسية',
    query: {
      company_account: 'ALL',
      master_columns: [
        'employee_code',
        'employee_name',
        'national_id',
        'company_account',
        'current_status',
        'current_job_title',
        'current_region',
        'current_department',
        'insurance_number',
        'insurance_status',
        'hire_date',
      ],
      filters: [],
      sort_by: 'employee_code',
      sort_order: 'asc',
    },
  },
  {
    id: 'active_employees',
    name: 'الموظفين النشطين فقط',
    description: 'تقرير بالموظفين العاملين حالياً',
    query: {
      company_account: 'ALL',
      master_columns: [
        'employee_code',
        'employee_name',
        'national_id',
        'company_account',
        'current_job_title',
        'current_region',
        'phone_number',
      ],
      filters: [
        { field: 'current_status', operator: 'like', value: 'Active' },
      ],
      sort_by: 'employee_name',
      sort_order: 'asc',
    },
  },
  {
    id: 'resigned_employees',
    name: 'الموظفين المستقيلين',
    description: 'تقرير بالموظفين الذين تم تسجيل استقالتهم',
    query: {
      company_account: 'ALL',
      master_columns: [
        'employee_code',
        'employee_name',
        'national_id',
        'company_account',
        'resignation_date',
        'last_working_day',
      ],
      filters: [
        { field: 'resignation_date', operator: 'is_not_null' },
      ],
      sort_by: 'resignation_date',
      sort_order: 'desc',
    },
  },
  {
    id: 'insured_employees',
    name: 'الموظفين المؤمن عليهم',
    description: 'تقرير بالموظفين المسجلين في التأمينات',
    query: {
      company_account: 'ALL',
      master_columns: [
        'employee_code',
        'employee_name',
        'national_id',
        'insurance_number',
        'insurance_status',
        'insurance_salary',
        'insurance_start_date',
      ],
      filters: [
        { field: 'insurance_number', operator: 'is_not_null' },
      ],
      sort_by: 'employee_code',
      sort_order: 'asc',
    },
  },
  {
    id: 'new_employees',
    name: 'الموظفين الجدد (بدون كود أداء)',
    description: 'موظفين جدد تم تسجيلهم في ورقة New لم يصدر لهم كود أداء بعد',
    query: {
      company_account: 'ALL',
      master_columns: [
        'employee_name',
        'national_id',
        'company_account',
        'current_job_title',
        'phone_number',
        'hire_date',
      ],
      filters: [
        { field: 'employee_code', operator: 'is_null' },
      ],
      sort_by: 'created_at',
      sort_order: 'desc',
    },
  },
  {
    id: 'uninsured_active',
    name: 'رادار الموظفين غير المؤمن عليهم',
    description: 'الموظفون النشطون في العمل ولا يوجد لهم رقم تأميني أو جارٍ استكمال تأمينهم',
    query: {
      company_account: 'ALL',
      master_columns: [
        'employee_code',
        'employee_name',
        'national_id',
        'company_account',
        'current_status',
        'current_job_title',
        'current_region',
        'current_department',
        'hire_date',
        'insurance_status',
        'phone_number',
      ],
      filters: [
        { field: 'current_status', operator: 'like', value: 'Active' },
        { field: 'insurance_number', operator: 'is_null' },
      ],
      sort_by: 'employee_code',
      sort_order: 'asc',
    },
  },
  {
    id: 'archives_completeness',
    name: 'تقرير اكتمال ملفات ومسوغات التعيين',
    description: 'يربط بيانات الموظفين مع ورقة Archives لمتابعة العقود، الفيش، الجيش، والمؤهلات الناقصة',
    query: {
      company_account: 'ALL',
      include_sheets: ['Archives'],
      master_columns: [
        'employee_code',
        'employee_name',
        'national_id',
        'company_account',
        'current_job_title',
        'current_region',
        'current_department',
        'current_status',
      ],
      filters: [],
      sort_by: 'employee_code',
      sort_order: 'asc',
    },
  },
  {
    id: 'medical_and_111',
    name: 'موقف الكشف الطبي ونماذج 111 والبطاقات',
    description: 'يربط الموظفين مع ورقة Medical لمتابعة الفحص الطبي، تاريخ الإصدار، وتجديد البطاقات العلاجية',
    query: {
      company_account: 'ALL',
      include_sheets: ['Medical'],
      master_columns: [
        'employee_code',
        'employee_name',
        'national_id',
        'company_account',
        'current_job_title',
        'current_region',
        'current_status',
      ],
      filters: [],
      sort_by: 'employee_code',
      sort_order: 'asc',
    },
  },
  {
    id: 'discrepancy_and_alerts',
    name: 'رادار شيت المناقضات والملاحظات الحرجة',
    description: 'الملاحظات الرقابية الحساسة مثل انتهاء كارت النقابة، مؤمن عليه خارج المؤسسة ق5/ق3، رخص القيادة',
    query: {
      company_account: 'ALL',
      include_sheets: ['المنقاضات'],
      master_columns: [
        'employee_code',
        'employee_name',
        'national_id',
        'company_account',
        'current_job_title',
        'current_region',
        'current_status',
        'phone_number',
      ],
      filters: [],
      sort_by: 'employee_code',
      sort_order: 'asc',
    },
  },
  {
    id: 'bank_and_deductions',
    name: 'توزيع الحسابات البنكية واستقطاعات النفقات',
    description: 'يربط الموظفين مع Bank ACC. و Deductions لحصر البنوك المعتمدة وأحكام النفقات القانونية',
    query: {
      company_account: 'ALL',
      include_sheets: ['Bank ACC.', 'Deductions'],
      master_columns: [
        'employee_code',
        'employee_name',
        'national_id',
        'company_account',
        'current_department',
        'current_job_title',
      ],
      filters: [],
      sort_by: 'employee_code',
      sort_order: 'asc',
    },
  },
  {
    id: 'active_resigned_conflict',
    name: 'تقرير تعارض الاستقالة والعمل (مستقيل وما زال نشطاً)',
    description: 'يكشف الموظفين المسجل لهم تاريخ استقالة وما زالت حالتهم مستمرة أو لم تقفل تأميناتهم',
    query: {
      company_account: 'ALL',
      include_sheets: ['RES'],
      master_columns: [
        'employee_code',
        'employee_name',
        'national_id',
        'company_account',
        'current_status',
        'resignation_date',
        'last_working_day',
      ],
      filters: [
        { field: 'resignation_date', operator: 'is_not_null' },
        { field: 'current_status', operator: 'like', value: 'Active' },
      ],
      sort_by: 'resignation_date',
      sort_order: 'desc',
    },
  },
];

/**
 * Get predefined report template by ID
 */
export function getReportTemplate(templateId: string): ReportTemplate | null {
  return REPORT_TEMPLATES.find((t) => t.id === templateId) || null;
}
