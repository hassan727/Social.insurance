import { NextRequest, NextResponse } from 'next/server';
import { supabaseService } from '@/lib/supabaseServer';

export async function GET() {
  try {
    const { data, error } = await supabaseService
      .from('saved_reports')
      .select('*')
      .order('is_pinned', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);

    return NextResponse.json({ success: true, reports: data || [] });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { report_name, report_description, report_config, created_by, is_pinned } = body;

    if (!report_name || !report_config) {
      return NextResponse.json({ error: 'report_name and report_config are required' }, { status: 400 });
    }

    const { data, error } = await supabaseService
      .from('saved_reports')
      .insert({
        report_name,
        report_description: report_description || null,
        report_config,
        created_by: created_by || 'User',
        is_pinned: !!is_pinned,
      })
      .select('*')
      .single();

    if (error) throw new Error(error.message);

    return NextResponse.json({ success: true, report: data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    const { error } = await supabaseService
      .from('saved_reports')
      .delete()
      .eq('id', id);

    if (error) throw new Error(error.message);

    return NextResponse.json({ success: true, deleted_id: id });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
