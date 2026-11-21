import { NextResponse } from 'next/server';
import { executeQuery, type QueryRequest } from '@/lib/dynamicQueryBuilder';

export async function POST(request: Request) {
  try {
    const body = await request.json() as QueryRequest;

    const result = await executeQuery(body);

    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'حدث خطأ أثناء تنفيذ الاستعلام';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
