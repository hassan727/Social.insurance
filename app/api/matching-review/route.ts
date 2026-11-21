import { NextRequest, NextResponse } from 'next/server';
import { getPendingCandidates, confirmCandidateMatch, rejectCandidateMatch } from '@/lib/matchingEngine';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || 'pending';
    const sheet_name = searchParams.get('sheet_name') || undefined;
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    const candidates = await getPendingCandidates({
      status,
      sheet_name,
      limit,
      offset,
    });

    return NextResponse.json({
      success: true,
      candidates,
      count: candidates.length,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { candidate_id, action, target_employee_id, reviewed_by } = body;

    if (!candidate_id || !action) {
      return NextResponse.json({ error: 'candidate_id and action are required' }, { status: 400 });
    }

    if (action === 'confirm') {
      if (!target_employee_id) {
        return NextResponse.json({ error: 'target_employee_id is required to confirm match' }, { status: 400 });
      }
      const result = await confirmCandidateMatch(candidate_id, target_employee_id, reviewed_by || 'User');
      return NextResponse.json(result);
    } else if (action === 'reject') {
      const result = await rejectCandidateMatch(candidate_id, reviewed_by || 'User');
      return NextResponse.json(result);
    } else {
      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
