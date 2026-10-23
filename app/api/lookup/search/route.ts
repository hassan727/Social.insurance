import { NextResponse } from 'next/server';
import { searchEmployees } from '@/lib/lookupService';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q') || '';
    const yearParam = searchParams.get('year');
    const monthParam = searchParams.get('month');
    const targetYear = yearParam ? parseInt(yearParam, 10) : undefined;
    const targetMonth = monthParam ? parseInt(monthParam, 10) : undefined;

    const results = await searchEmployees(query, targetYear, targetMonth);
    return NextResponse.json({ success: true, results });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'حدث خطأ أثناء البحث';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
