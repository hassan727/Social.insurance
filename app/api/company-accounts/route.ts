import { NextResponse } from 'next/server';
import { supabaseService } from '@/lib/supabaseServer';

// Lists active company accounts for the import page's explicit account selector.
export async function GET() {
  try {
    const { data, error } = await supabaseService
      .from('company_accounts')
      .select('id, account_code, account_name, aliases')
      .eq('is_active', true)
      .order('id', { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, accounts: data || [] });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'حدث خطأ أثناء جلب الحسابات';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
