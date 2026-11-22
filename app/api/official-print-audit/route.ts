import { NextResponse } from 'next/server';
import {
  runOfficialPrintForensicAudit,
  generateOfficialPrintForensicWorkbook,
  REGISTERED_ACCOUNTS,
} from '@/lib/officialPrintMatchingService';

/**
 * GET /api/official-print-audit
 * Query parameters:
 *  - action: 'summary' (default) | 'export'
 *  - account: 'E.G' | 'm.g' | 'ALL' (default: 'ALL')
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action') || 'summary';
    const account = (searchParams.get('account') as 'E.G' | 'm.g' | 'ALL') || 'ALL';
    const subset = searchParams.get('subset') || 'all';

    if (action === 'export') {
      const buffer = await generateOfficialPrintForensicWorkbook(account, subset);
      
      let filename = `تقرير_التدقيق_الجنائي_لبرنت_التامينات_2026_${account}.xlsx`;
      if (subset === 'job_conflicts') {
        filename = `تقرير_التعارض_الوظيفي_وتعديل_المهن_${account}.xlsx`;
      } else if (subset === 'matched') {
        filename = `تقرير_المطابقة_التامة_${account}.xlsx`;
      } else if (subset === 'discrepancies') {
        filename = `تقرير_تناقض_البيانات_${account}.xlsx`;
      } else if (subset === 'missing_in_print') {
        filename = `تقرير_غير_المسجلين_بالبرنت_والمخالفات_${account}.xlsx`;
      } else if (subset === 'missing_in_payroll') {
        filename = `تقرير_المسجلين_بلا_مرتبات_واستمارة_6_${account}.xlsx`;
      } else if (subset === 'data_quality') {
        filename = `تقرير_جودة_البيانات_والتكرار_${account}.xlsx`;
      } else if (subset === 'actions') {
        filename = `تقرير_التعديلات_المقترحة_الميدانية_${account}.xlsx`;
      }

      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
        },
      });
    }

    // Default: Return summary and records JSON
    const refresh = searchParams.get('refresh') === 'true';
    const { summary, records } = await runOfficialPrintForensicAudit(account, refresh);
    const filter = searchParams.get('filter') || 'all';

    let filteredRecords = records;
    if (filter === 'uninsured') {
      filteredRecords = records.filter((r) => r.finalForensicStatus.includes('مخالفة تأمينية'));
    } else if (filter === 'job_conflicts') {
      filteredRecords = records.filter((r) => r.finalForensicStatus.includes('تعارض مسميات') || r.jobConflictStatus === 'تعارض مسميات');
    } else if (filter === 'supplied_s1') {
      filteredRecords = records.filter((r) => r.finalForensicStatus.includes('س1'));
    } else if (filter === 'new_hires') {
      filteredRecords = records.filter((r) => r.finalForensicStatus.includes('تعيين جديد'));
    } else if (filter === 'missing_payroll') {
      filteredRecords = records.filter((r) => r.finalForensicStatus.includes('بلا مرتبات'));
    } else if (filter === 'discrepancy') {
      filteredRecords = records.filter((r) => r.finalForensicStatus.includes('تعارض أرقام') || r.nameMatchConfidence.includes('تعارض'));
    } else if (filter === 'matched') {
      filteredRecords = records.filter((r) => r.finalForensicStatus === 'مطابق ومعتمد');
    }

    return NextResponse.json({
      success: true,
      account,
      registeredAccounts: REGISTERED_ACCOUNTS,
      summary,
      recordsCount: records.length,
      filteredCount: filteredRecords.length,
      sampleRecords: filteredRecords.slice(0, 250),
    });
  } catch (error: unknown) {
    console.error('Error running official print forensic audit:', error);
    const message = error instanceof Error ? error.message : 'حدث خطأ أثناء إجراء التدقيق الجنائي لبرنت التأمينات';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
