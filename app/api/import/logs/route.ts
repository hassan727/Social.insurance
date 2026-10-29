import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';

/**
 * GET /api/import/logs
 * Returns all import log entries ordered by period year and month.
 * Used by the Reports page to display the available months status strip.
 */
export async function GET() {
  try {
    const { data, error } = await supabaseServer
      .from('import_logs')
      .select('source_type, period_month, period_year, file_name, rows_accepted, created_at')
      .order('period_year', { ascending: true })
      .order('period_month', { ascending: true });

    if (error) {
      throw new Error(error.message);
    }

    return NextResponse.json({ logs: data || [] });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('GET /api/import/logs error:', err);
    return NextResponse.json({ error: message, logs: [] }, { status: 500 });
  }
}
