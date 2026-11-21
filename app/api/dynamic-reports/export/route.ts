import { NextResponse } from 'next/server';
import { generateDynamicReport, type ReportExportRequest } from '@/lib/dynamicQueryBuilder';

export const maxDuration = 300; // 5 minutes for large reports

export async function POST(request: Request) {
  try {
    const body = await request.json() as ReportExportRequest;

    const { buffer, filename } = await generateDynamicReport(body);

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
        'Content-Length': buffer.length.toString(),
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'حدث خطأ أثناء تصدير التقرير';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
