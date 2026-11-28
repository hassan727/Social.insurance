import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServiceClient } from '@/lib/supabaseServer';

/** GET /api/employee/[id]/timeline - current data, latest data per source, and every change (old vs new). */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (getSupabaseServiceClient() as any).rpc('get_person_timeline', { p_employee_id: id, p_limit: 300 });
    if (error) throw new Error(error.message);
    const result = data as unknown as { success?: boolean; error?: string } | null;
    if (!result || result.success !== true) {
      return NextResponse.json(result ?? { success: false, error: 'unknown' }, { status: result?.error === 'employee_not_found' ? 404 : 500 });
    }
    return NextResponse.json(result);
  } catch (err: unknown) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 });
  }
}
