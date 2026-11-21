import { NextResponse } from 'next/server';
import { REPORT_TEMPLATES, getReportTemplate } from '@/lib/dynamicQueryBuilder';

/**
 * Get all report templates or specific template by ID
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const templateId = searchParams.get('id');

    if (templateId) {
      const template = getReportTemplate(templateId);
      if (!template) {
        return NextResponse.json({ error: 'القالب غير موجود' }, { status: 404 });
      }
      return NextResponse.json({ success: true, template });
    }

    return NextResponse.json({
      success: true,
      templates: REPORT_TEMPLATES,
      total: REPORT_TEMPLATES.length,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'حدث خطأ أثناء جلب القوالب';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
