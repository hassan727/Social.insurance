import { NextResponse } from 'next/server';
import { searchEmployees } from '@/lib/lookupService';
import { supabaseServer } from '@/lib/supabaseServer';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type JsonValue = any;

/** Build a plain-object snapshot of one search result for JSONB storage */
function toJsonPayload(result: ReturnType<typeof Array.prototype.find>, purpose: string): JsonValue {
  return JSON.parse(JSON.stringify({ ...result, _search_purpose: purpose }));
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q') || '';
    const yearParam = searchParams.get('year');
    const monthParam = searchParams.get('month');
    const purpose = searchParams.get('purpose') || 'general';
    const targetYear = yearParam ? parseInt(yearParam, 10) : undefined;
    const targetMonth = monthParam ? parseInt(monthParam, 10) : undefined;

    // Validate that the query contains valid 14-digit national ID(s)
    const digitsOnly = query.replace(/\D/g, '');
    const tokens = query.split(/[\r\n,]+/).map(t => t.replace(/\D/g, '')).filter(t => t.length === 14);
    const isValidNatIdQuery = digitsOnly.length === 14 || tokens.length > 0;

    // Strict rule: Search is ONLY by 14-digit National ID
    if (!isValidNatIdQuery) {
      return NextResponse.json({
        success: true,
        results: [],
        message: 'البحث متاح بالرقم القومي فقط (14 رقماً)'
      });
    }

    // Perform the search
    const results = await searchEmployees(query, targetYear, targetMonth);

    // ── Log search to search_history with DEDUPLICATION ──────────────────
    // Rule: one record per 14-digit national_id per calendar day.
    // Only logged for valid National ID searches to prevent clutter and duplicate mass entries.
    if (results.length > 0) {
      try {
        const userIp = request.headers.get('x-forwarded-for') ||
          request.headers.get('x-real-ip') ||
          'unknown';
        const todayStr = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

        for (const result of results) {
          const natId = result.national_id?.trim() || null;
          // Must have a valid 14-digit national ID
          if (!natId || natId.length !== 14) continue;

          const empCode = result.employee_code?.trim() || null;

          // Build safe JSON payload (strips class instances like S1CalculationInfo)
          const searchResultJson: JsonValue = toJsonPayload(result, purpose);

          let currentInsStatus = result.insurance_status || null;
          if (purpose === 'discrepancy' && !currentInsStatus) {
            currentInsStatus = 'مناقضة';
          } else if (purpose === 'supplied' && !currentInsStatus) {
            currentInsStatus = 'تم التوريد';
          }

          const basePayload = {
            search_query: natId,
            national_id: natId,
            employee_code: empCode,
            employee_name: result.employee_name || null,
            result_found: true,
            results_count: results.length,
            user_ip: userIp,
            company_account: result.company_account || null,
            insurance_status: currentInsStatus,
            status: result.status || null,
            has_resignation: result.has_resignation || false,
            first_both_month: result.first_both_month || null,
            attendance_days: result.attendance_days || null,
            search_result: searchResultJson,
            search_timestamp: new Date().toISOString(),
          };

          // Check if a record for this national_id already exists today
          const { data: existing } = await supabaseServer
            .from('search_history')
            .select('id')
            .gte('search_timestamp', `${todayStr}T00:00:00.000Z`)
            .eq('result_found', true)
            .eq('national_id', natId)
            .limit(1)
            .maybeSingle();

          if (existing?.id) {
            // UPDATE — refresh data, do NOT create duplicate
            await supabaseServer
              .from('search_history')
              .update(basePayload)
              .eq('id', existing.id);
          } else {
            // INSERT — first search for this national ID today
            await supabaseServer.from('search_history').insert(basePayload);
          }
        }
      } catch (logError) {
        console.error('Failed to log search history:', logError);
      }
    } else if (digitsOnly.length === 14) {
      // Exactly 14 digits entered but not found in any database
      try {
        const userIp = request.headers.get('x-forwarded-for') ||
          request.headers.get('x-real-ip') ||
          'unknown';
        const todayStr = new Date().toISOString().split('T')[0];

        // Deduplicate not-found logs for the same national ID on the same day
        const { data: existingNotFound } = await supabaseServer
          .from('search_history')
          .select('id')
          .gte('search_timestamp', `${todayStr}T00:00:00.000Z`)
          .eq('result_found', false)
          .eq('national_id', digitsOnly)
          .limit(1)
          .maybeSingle();

        if (!existingNotFound) {
          await supabaseServer.from('search_history').insert({
            search_query: digitsOnly,
            national_id: digitsOnly,
            result_found: false,
            results_count: 0,
            user_ip: userIp,
            search_timestamp: new Date().toISOString(),
          });
        }
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
