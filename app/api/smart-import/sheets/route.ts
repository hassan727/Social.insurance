import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';

/**
 * Get list of registered sheets
 */
export async function GET() {
  try {
    const { data: sheets, error } = await supabaseServer
      .from('dynamic_sheets')
      .select('*')
      .eq('is_active', true)
      .order('sheet_name', { ascending: true });

    if (error) {
      throw new Error(`فشل جلب قائمة الورقات: ${error.message}`);
    }

    return NextResponse.json({
      success: true,
      sheets: sheets || [],
      total: sheets?.length || 0,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'حدث خطأ أثناء جلب قائمة الورقات';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
