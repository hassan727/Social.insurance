import { NextResponse } from 'next/server';
import {
  generateReportData,
  CompanyAccount,
  ReportType,
  QuarterSelection,
  CalculationMethod,
} from '@/lib/reportsEngine';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const account = (body.account || 'E.G') as CompanyAccount;
    const reportType = (body.reportType || 'hr_letter') as ReportType;
    const quarter = (body.quarter || 'Q3') as QuarterSelection;
    const method = (body.method || 'actual') as CalculationMethod;
    const month = body.month ? Number(body.month) : 9;

    const result = await generateReportData(account, reportType, quarter, method, month);

    return NextResponse.json(result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error generating report:', error);
    return NextResponse.json({ error: 'فشل استدعاء التقرير: ' + message }, { status: 500 });
  }
}
