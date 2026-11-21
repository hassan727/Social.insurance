import { NextResponse } from 'next/server';
import { searchEmployees } from '@/lib/lookupService';
import { supabaseServer } from '@/lib/supabaseServer';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q') || '';
    const yearParam = searchParams.get('year');
    const monthParam = searchParams.get('month');
    const purpose = searchParams.get('purpose') || 'general';
    const targetYear = yearParam ? parseInt(yearParam, 10) : undefined;
    const targetMonth = monthParam ? parseInt(monthParam, 10) : undefined;

    // Perform the search
    const results = await searchEmployees(query, targetYear, targetMonth);

    // Log the search to search_history table (only if query is meaningful)
    if (query.trim().length >= 2 && results.length > 0) {
      try {
        // Get user IP from headers
        const userIp = request.headers.get('x-forwarded-for') || 
                       request.headers.get('x-real-ip') || 
                       'unknown';

        // For each result found, log it separately (to track all searched employees)
        const searchLogs = results.map((result) => ({
          search_query: query,
          national_id: result.national_id || null,
          employee_code: result.employee_code || null,
          employee_name: result.employee_name || null,
          result_found: true,
          results_count: results.length,
          user_ip: userIp,
          company_account: result.company_account || null,
          insurance_status: result.insurance_status || null,
          status: result.status || null,
          has_resignation: result.has_resignation || false,
          first_both_month: result.first_both_month || null,
          attendance_days: result.attendance_days || null,
          search_result: { ...result, _search_purpose: purpose } as never, // Store complete result + purpose as JSONB
        }));

        // Insert all search logs in batch
        await supabaseServer
          .from('search_history')
          .insert(searchLogs);
      } catch (logError) {
        // Don't fail the search if logging fails
        console.error('Failed to log search history:', logError);
      }
    } else if (query.trim().length >= 2 && results.length === 0) {
      // Log searches with no results too
      try {
        const userIp = request.headers.get('x-forwarded-for') || 
                       request.headers.get('x-real-ip') || 
                       'unknown';

        await supabaseServer
          .from('search_history')
          .insert({
            search_query: query,
            result_found: false,
            results_count: 0,
            user_ip: userIp,
          });
      } catch (logError) {
        console.error('Failed to log empty search:', logError);
      }
    }

    return NextResponse.json({ success: true, results });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'حدث خطأ أثناء البحث';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
