import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';

/**
 * GET /api/employee
 * Returns paginated list of employees from employees_master.
 *
 * Query params:
 *   - q             → search by name, code, or national_id
 *   - account       → filter by company_account (E.G | m.g | ALL)
 *   - status        → filter by current_status
 *   - department    → filter by current_department
 *   - region        → filter by current_region
 *   - has_insurance → 'yes' | 'no'  (filter by insurance_number presence)
 *   - completeness  → 'low' | 'medium' | 'high'
 *   - limit         → default 50
 *   - offset        → default 0
 *   - sort_by       → field name (default: employee_code)
 *   - sort_order    → asc | desc
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q')?.trim() ?? '';
    const account = searchParams.get('account') ?? 'ALL';
    const status = searchParams.get('status') ?? '';
    const department = searchParams.get('department') ?? '';
    const region = searchParams.get('region') ?? '';
    const hasInsurance = searchParams.get('has_insurance') ?? '';
    const completeness = searchParams.get('completeness') ?? '';
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10), 500);
    const offset = parseInt(searchParams.get('offset') ?? '0', 10);
    const sortBy = searchParams.get('sort_by') ?? 'employee_code';
    const sortOrder = searchParams.get('sort_order') === 'desc' ? false : true;

    let query = supabaseServer
      .from('employees_master')
      .select(
        `id, company_account, employee_code, national_id, employee_name,
         current_status, current_job_title, current_region, current_department,
         insurance_number, insurance_status, insurance_salary, insurance_job_title, insurance_start_date,
         hire_date, resignation_date, last_working_day,
         phone_number, data_completeness_score, has_duplicate_risk,
         last_updated_at`,
        { count: 'exact' }
      );

    // Search filter
    if (q) {
      query = query.or(
        `employee_name.ilike.%${q}%,employee_code.ilike.%${q}%,national_id.ilike.%${q}%`
      );
    }

    // Account filter
    if (account && account !== 'ALL') {
      query = query.eq('company_account', account);
    }

    // Status filter
    if (status) {
      query = query.eq('current_status', status);
    }

    // Department filter
    if (department) {
      query = query.ilike('current_department', `%${department}%`);
    }

    // Region filter
    if (region) {
      query = query.ilike('current_region', `%${region}%`);
    }

    // Insurance filter
    if (hasInsurance === 'yes') {
      query = query.not('insurance_number', 'is', null).neq('insurance_number', '');
    } else if (hasInsurance === 'no') {
      query = query.is('insurance_number', null);
    }

    // Completeness filter (using data_completeness_score)
    if (completeness === 'low') {
      query = query.lt('data_completeness_score', 40);
    } else if (completeness === 'medium') {
      query = query.gte('data_completeness_score', 40).lt('data_completeness_score', 75);
    } else if (completeness === 'high') {
      query = query.gte('data_completeness_score', 75);
    }

    // Sort & paginate
    query = query
      .order(sortBy, { ascending: sortOrder })
      .range(offset, offset + limit - 1);

    const { data, count, error } = await query;
    if (error) throw new Error(error.message);

    // Aggregate stats for filters
    const [statusCounts, accountCounts] = await Promise.all([
      supabaseServer
        .from('employees_master')
        .select('current_status')
        .then(({ data: d }) => {
          const map: Record<string, number> = {};
          for (const row of d || []) {
            const s = row.current_status ?? 'غير محدد';
            map[s] = (map[s] ?? 0) + 1;
          }
          return map;
        }),
      supabaseServer
        .from('employees_master')
        .select('company_account')
        .then(({ data: d }) => {
          const map: Record<string, number> = {};
          for (const row of d || []) {
            const a = row.company_account ?? 'غير محدد';
            map[a] = (map[a] ?? 0) + 1;
          }
          return map;
        }),
    ]);

    return NextResponse.json({
      employees: data ?? [],
      total: count ?? 0,
      limit,
      offset,
      aggregates: {
        by_status: statusCounts,
        by_account: accountCounts,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('GET /api/employee error:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
