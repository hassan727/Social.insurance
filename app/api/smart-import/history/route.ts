import { NextResponse } from 'next/server';
import { supabaseService } from '@/lib/supabaseServer';

/**
 * Get import history
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!, 10) : 50;

    const { data: imports, error } = await supabaseService
      .from('import_logs')
      .select('*')
      .eq('source_type', 'multi_sheet_import')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      throw new Error(`فشل جلب سجل الاستيراد: ${error.message}`);
    }

    // Get employee history for transfers
    const { data: transfers, error: transfersError } = await supabaseService
      .from('employee_history')
      .select('*')
      .eq('change_type', 'account_transfer')
      .order('created_at', { ascending: false })
      .limit(20);

    if (transfersError) {
      console.error('Failed to fetch transfers:', transfersError);
    }

    return NextResponse.json({
      success: true,
      imports: imports || [],
      transfers: transfers || [],
      total: imports?.length || 0,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'حدث خطأ أثناء جلب سجل الاستيراد';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
