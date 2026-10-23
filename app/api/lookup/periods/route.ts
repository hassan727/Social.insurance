import { NextResponse } from 'next/server';
import { getAvailableImportedPeriods } from '@/lib/lookupService';

export async function GET() {
  try {
    const periods = await getAvailableImportedPeriods();
    return NextResponse.json({ success: true, periods });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'حدث خطأ أثناء جلب الفترات المتاحة';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
