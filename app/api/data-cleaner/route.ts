import { NextRequest, NextResponse } from 'next/server';
import {
  detectDataQualityIssues,
  getDataQualityStats,
  attemptAutoFix,
  flagCorruptedEmployees,
} from '@/lib/dataCleanerService';

/**
 * GET /api/data-cleaner?action=stats|detect|flag
 * Returns data quality issues and statistics
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action') ?? 'stats';

    if (action === 'stats') {
      const result = await getDataQualityStats();
      return NextResponse.json(result);
    }

    if (action === 'detect') {
      const issues = await detectDataQualityIssues();
      return NextResponse.json({ issues, total: issues.length });
    }

    if (action === 'flag') {
      const flagged = await flagCorruptedEmployees();
      return NextResponse.json({ success: true, flagged_count: flagged });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('GET /api/data-cleaner error:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/data-cleaner
 * Attempt to auto-fix a specific employee's data
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { employee_id, action } = body;

    if (!employee_id) {
      return NextResponse.json({ error: 'employee_id required' }, { status: 400 });
    }

    if (action === 'fix') {
      const success = await attemptAutoFix(employee_id);
      return NextResponse.json({ success, employee_id });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('POST /api/data-cleaner error:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
