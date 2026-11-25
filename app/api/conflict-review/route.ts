import { NextRequest, NextResponse } from 'next/server';
import { supabaseService } from '@/lib/supabaseServer';

/**
 * GET /api/conflict-review
 * Fetch pending field conflicts (optionally filtered by field_name or employee_id)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || 'pending';
    const field_name = searchParams.get('field_name') || null;
    const employee_id = searchParams.get('employee_id') || null;
    const limit = Math.min(parseInt(searchParams.get('limit') || '100', 10), 500);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    // ── Stats action ──────────────────────────────────────────────────────
    if (searchParams.get('action') === 'stats') {
      const [pending, approved, rejected] = await Promise.all([
        supabaseService.from('field_conflicts').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
        supabaseService.from('field_conflicts').select('id', { count: 'exact', head: true }).eq('status', 'approved'),
        supabaseService.from('field_conflicts').select('id', { count: 'exact', head: true }).eq('status', 'rejected'),
      ]);
      return NextResponse.json({
        pending: pending.count ?? 0,
        approved: approved.count ?? 0,
        rejected: rejected.count ?? 0,
      });
    }

    // ── Deduplication action ──────────────────────────────────────────────
    if (searchParams.get('action') === 'deduplicate') {
      const sheetName = searchParams.get('sheet_name') || null;
      const { data, error } = await supabaseService
        .rpc('deduplicate_sheet_data', { target_sheet_name: sheetName });
      if (error) throw new Error(error.message);
      return NextResponse.json({ success: true, results: data });
    }

    // ── Detect conflicts action ───────────────────────────────────────────
    if (searchParams.get('action') === 'detect') {
      const { data, error } = await supabaseService
        .rpc('detect_all_field_conflicts');
      if (error) throw new Error(error.message);
      return NextResponse.json({ success: true, result: data?.[0] ?? null });
    }

    // ── Fetch conflicts list ──────────────────────────────────────────────
    let query = supabaseService
      .from('field_conflicts')
      .select(`
        id, employee_id, field_name,
        current_value, current_source,
        proposed_value, proposed_source, proposed_import_id,
        status, review_notes, reviewed_by, reviewed_at,
        created_at, updated_at,
        employees_master (
          id, employee_name, employee_code, national_id,
          company_account, current_job_title, current_status
        )
      `)
      .eq('status', status)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (field_name) query = query.eq('field_name', field_name);
    if (employee_id) query = query.eq('employee_id', employee_id);

    const { data, error, count } = await query;
    if (error) throw new Error(error.message);

    return NextResponse.json({
      success: true,
      conflicts: ((data || []) as unknown as Record<string, unknown>[]).map((row: Record<string, unknown>) => ({
        ...row,
        employee: row.employees_master,
      })),
      total: count ?? (data?.length ?? 0),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/conflict-review
 * Actions:
 *   { action: 'decide', conflict_id, decision: 'approved'|'rejected'|'merged', merged_value? }
 *   { action: 'decide_bulk', conflict_ids: string[], decision: 'approved'|'rejected' }
 *   { action: 'detect_for_employee', employee_id }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action } = body;

    // ── Single decision ───────────────────────────────────────────────────
    if (action === 'decide') {
      const { conflict_id, decision, merged_value, reviewed_by } = body;
      if (!conflict_id || !decision) {
        return NextResponse.json({ error: 'conflict_id and decision are required' }, { status: 400 });
      }
      if (!['approved', 'rejected', 'merged'].includes(decision)) {
        return NextResponse.json({ error: 'decision must be approved, rejected, or merged' }, { status: 400 });
      }

      const { data, error } = await supabaseService.rpc('apply_conflict_decision', {
        conflict_id_param: conflict_id,
        decision,
        merged_val: merged_value || null,
        reviewed_by_param: reviewed_by || 'User',
      });
      if (error) throw new Error(error.message);

      return NextResponse.json({ success: true, applied: data });
    }

    // ── Bulk decision ─────────────────────────────────────────────────────
    if (action === 'decide_bulk') {
      const { conflict_ids, decision, reviewed_by } = body;
      if (!Array.isArray(conflict_ids) || conflict_ids.length === 0) {
        return NextResponse.json({ error: 'conflict_ids array required' }, { status: 400 });
      }
      if (!['approved', 'rejected'].includes(decision)) {
        return NextResponse.json({ error: 'bulk decision must be approved or rejected' }, { status: 400 });
      }

      const results = await Promise.allSettled(
        conflict_ids.map((cid: string) =>
          supabaseService.rpc('apply_conflict_decision', {
            conflict_id_param: cid,
            decision,
            merged_val: null,
            reviewed_by_param: reviewed_by || 'User',
          })
        )
      );

      const succeeded = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;

      return NextResponse.json({ success: true, succeeded, failed, total: conflict_ids.length });
    }

    // ── Detect conflicts for one employee ─────────────────────────────────
    if (action === 'detect_for_employee') {
      const { employee_id } = body;
      if (!employee_id) return NextResponse.json({ error: 'employee_id required' }, { status: 400 });

      const { data, error } = await supabaseService.rpc('detect_employee_field_conflicts', {
        employee_id_param: employee_id,
        import_id_param: null,
      });
      if (error) throw new Error(error.message);

      return NextResponse.json({ success: true, conflicts_found: data });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
