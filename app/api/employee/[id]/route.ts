import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';
import { getDiscrepancies } from '@/lib/dataQualityEngine';

/**
 * GET /api/employee/[id]
 * Returns the complete unified profile for a single employee from employees_master.
 * Merges data from employees_master, sheet_data, employee_history, data_discrepancies.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!id) {
      return NextResponse.json({ error: 'Employee ID is required' }, { status: 400 });
    }

    // Fetch in parallel for speed
    const [masterResult, historyResult, sheetDataResult, discrepanciesResult] = await Promise.all([
      // 1. Core employee record
      supabaseServer
        .from('employees_master')
        .select('*')
        .eq('id', id)
        .maybeSingle(),

      // 2. Change history
      supabaseServer
        .from('employee_history')
        .select('*')
        .eq('employee_id', id)
        .order('created_at', { ascending: false })
        .limit(50),

      // 3. Sheet data — all latest rows for this employee
      supabaseServer
        .from('sheet_data')
        .select(`
          id, row_data, row_code, row_national_id, row_name,
          sheet_id, row_number, created_at, updated_at,
          dynamic_sheets ( sheet_name, display_name, description )
        `)
        .eq('employee_id', id)
        .eq('is_latest', true)
        .order('created_at', { ascending: false }),

      // 4. Open discrepancies for this employee
      getDiscrepancies({ status: 'open' })
        .then((all) => all.filter((d: any) => d.employee_id === id))
        .catch((err) => {
          console.warn('Failed to fetch discrepancies:', err);
          return [];
        }),
    ]);

    if (!masterResult.data) {
      return NextResponse.json({ error: 'Employee not found' }, { status: 404 });
    }

    const employee = masterResult.data;

    // Build per-sheet data map: sheet_name → row_data
    const sheetDataMap: Record<string, {
      display_name: string;
      description: string | null;
      row_data: Record<string, unknown>;
      last_updated: string;
    }> = {};

    for (const row of sheetDataResult.data || []) {
      const sheetName = (row.dynamic_sheets as { sheet_name: string; display_name: string; description: string | null } | null)?.sheet_name;
      if (!sheetName) continue;
      if (!sheetDataMap[sheetName]) {
        sheetDataMap[sheetName] = {
          display_name: (row.dynamic_sheets as { display_name: string })?.display_name ?? sheetName,
          description: (row.dynamic_sheets as { description: string | null })?.description ?? null,
          row_data: row.row_data as Record<string, unknown>,
          last_updated: row.updated_at,
        };
      }
    }

    // Compute data completeness score
    const coreFields = [
      employee.national_id,
      employee.employee_code,
      employee.current_job_title,
      employee.current_region,
      employee.current_department,
      employee.phone_number,
      employee.hire_date,
      employee.insurance_number,
    ];
    const filledFields = coreFields.filter(Boolean).length;
    const completenessScore = Math.round((filledFields / coreFields.length) * 100);

    // Compute sources found
    const sourcesFound = Object.keys(sheetDataMap);

    // Compile response
    const response = {
      employee: {
        ...employee,
        completeness_score: completenessScore,
      },
      sheet_data: sheetDataMap,
      sources_found: sourcesFound,
      history: historyResult.data || [],
      open_discrepancies: discrepanciesResult,
      meta: {
        total_sheets_with_data: sourcesFound.length,
        total_history_entries: (historyResult.data || []).length,
        total_open_discrepancies: discrepanciesResult.length,
      },
    };

    return NextResponse.json(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('GET /api/employee/[id] error:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * PATCH /api/employee/[id]
 * Update specific fields of an employee_master record.
 * Only updates provided fields — never overwrites with null unless explicit.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    // Allowed fields for manual update
    const allowedFields = [
      'current_status', 'current_job_title', 'current_region', 'current_department',
      'insurance_number', 'insurance_status', 'insurance_salary', 'insurance_job_title',
      'insurance_start_date', 'hire_date', 'resignation_date', 'last_working_day',
      'phone_number', 'address',
    ];

    const updates: Record<string, unknown> = {};
    for (const field of allowedFields) {
      if (field in body && body[field] !== undefined) {
        updates[field] = body[field];
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    const { error } = await supabaseServer
      .from('employees_master')
      .update(updates as any)
      .eq('id', id);

    if (error) throw new Error(error.message);

    return NextResponse.json({ success: true, updated_fields: Object.keys(updates) });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('PATCH /api/employee/[id] error:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
