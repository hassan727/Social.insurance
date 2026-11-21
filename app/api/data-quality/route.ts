import { NextRequest, NextResponse } from 'next/server';
import { runDataQualityCheck, getDiscrepancyStats, getDiscrepancies, resolveDiscrepancy } from '@/lib/dataQualityEngine';
import type { DiscrepancyType, DiscrepancySeverity } from '@/lib/dataQualityEngine';

/**
 * GET /api/data-quality
 * Returns current discrepancy stats and optionally a list of discrepancies.
 *
 * Query params:
 *   - mode=stats         → summary stats only (default)
 *   - mode=list          → paginated list of discrepancies
 *   - type=...           → filter by discrepancy type
 *   - severity=...       → filter by severity (critical|warning|info)
 *   - status=open|resolved|ignored (default: open)
 *   - limit=50           → page size
 *   - offset=0           → pagination offset
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const mode = searchParams.get('mode') ?? 'stats';

    if (mode === 'stats') {
      const stats = await getDiscrepancyStats();
      return NextResponse.json({ stats });
    }

    if (mode === 'list') {
      const type = searchParams.get('type') as DiscrepancyType | null;
      const severity = searchParams.get('severity') as DiscrepancySeverity | null;
      const status = searchParams.get('status') ?? 'open';
      const limit = parseInt(searchParams.get('limit') ?? '50', 10);
      const offset = parseInt(searchParams.get('offset') ?? '0', 10);

      const data = await getDiscrepancies({
        type: type ?? undefined,
        severity: severity ?? undefined,
        status,
        limit,
        offset,
      });

      return NextResponse.json({ discrepancies: data });
    }

    return NextResponse.json({ error: 'Invalid mode. Use ?mode=stats or ?mode=list' }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('GET /api/data-quality error:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/data-quality
 * Triggers a data quality check run.
 *
 * Body (optional):
 *   { checks: DiscrepancyType[] }   → run only specific checks (omit for full run)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const checks = body?.checks ?? undefined;
    const triggered_by = body?.triggered_by ?? 'manual';

    const summary = await runDataQualityCheck({ checks, triggered_by });
    return NextResponse.json({ summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('POST /api/data-quality error:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * PATCH /api/data-quality
 * Resolve or ignore a specific discrepancy.
 *
 * Body: { id: string; action: 'resolved' | 'ignored' | 'false_positive'; notes?: string }
 */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, action, notes } = body;

    if (!id || !action) {
      return NextResponse.json({ error: 'id and action are required' }, { status: 400 });
    }

    if (!['resolved', 'ignored', 'false_positive'].includes(action)) {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }

    await resolveDiscrepancy(id, action, notes);
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('PATCH /api/data-quality error:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
