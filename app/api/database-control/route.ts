import { NextRequest, NextResponse } from 'next/server';
import { supabaseService } from '@/lib/supabaseServer';

/**
 * GET /api/database-control
 * Returns live counts and stats across all database tables:
 * - incoming_insurance_records
 * - resignation_records
 * - sheet_data (broken down by sheet)
 * - employees_master
 * - import_logs
 */
export async function GET() {
  try {
    const [
      incTotal,
      incValidIns,
      resTotal,
      resWithDate,
      sheetDataTotal,
      sheetDataDups,
      masterTotal,
      masterNoIns,
      masterResigned,
      sheetsList,
      importLogs,
    ] = await Promise.all([
      supabaseService.from('incoming_insurance_records').select('id', { count: 'exact', head: true }),
      supabaseService.from('incoming_insurance_records').select('id', { count: 'exact', head: true }).not('insurance_number', 'is', null),
      supabaseService.from('resignation_records').select('id', { count: 'exact', head: true }),
      supabaseService.from('resignation_records').select('id', { count: 'exact', head: true }).not('resignation_date', 'is', null),
      supabaseService.from('sheet_data').select('id', { count: 'exact', head: true }),
      supabaseService.from('sheet_data').select('id', { count: 'exact', head: true }).eq('is_latest', false),
      supabaseService.from('employees_master').select('id', { count: 'exact', head: true }),
      supabaseService.from('employees_master').select('id', { count: 'exact', head: true }).is('insurance_number', null),
      supabaseService.from('employees_master').select('id', { count: 'exact', head: true }).or('current_status.ilike.%مستقيل%,current_status.ilike.%resign%'),
      supabaseService.from('dynamic_sheets').select('id, sheet_name, display_name, total_records_imported, last_import_date').order('sheet_name'),
      supabaseService.from('import_logs').select('*').order('created_at', { ascending: false }).limit(20),
    ]);

    return NextResponse.json({
      success: true,
      stats: {
        incoming_insurance: {
          total: incTotal.count ?? 0,
          valid_insurance_number: incValidIns.count ?? 0,
          null_insurance_number: (incTotal.count ?? 0) - (incValidIns.count ?? 0),
        },
        resignation: {
          total: resTotal.count ?? 0,
          with_date: resWithDate.count ?? 0,
        },
        sheet_data: {
          total: sheetDataTotal.count ?? 0,
          duplicates_inactive: sheetDataDups.count ?? 0,
          active_latest: (sheetDataTotal.count ?? 0) - (sheetDataDups.count ?? 0),
        },
        employees_master: {
          total: masterTotal.count ?? 0,
          with_insurance_number: (masterTotal.count ?? 0) - (masterNoIns.count ?? 0),
          null_insurance_number: masterNoIns.count ?? 0,
          resigned_count: masterResigned.count ?? 0,
        },
      },
      dynamic_sheets: sheetsList.data || [],
      import_logs: importLogs.data || [],
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/database-control
 * Direct CRUD operations triggered by the user in the UI:
 * - clear_table: { table: 'incoming_insurance' | 'resignation' | 'sheet_data' | 'field_conflicts' }
 * - delete_import: { import_id: string }
 * - sync_incoming_to_master: transfers insurance_number from incoming_insurance to employees_master
 * - sync_resignation_to_master: transfers resignation_date from resignation to employees_master
 * - deduplicate_sheets: runs deduplication on sheet_data
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action } = body;

    // ── 1. Clear Table (Delete All Rows) ───────────────────────────────────
    if (action === 'clear_table') {
      const { table } = body;
      if (!table) return NextResponse.json({ error: 'اسم الجدول مطلوب' }, { status: 400 });

      let deletedCount = 0;
      if (table === 'incoming_insurance') {
        const { count, error } = await supabaseService
          .from('incoming_insurance_records')
          .delete({ count: 'exact' })
          .neq('id', '00000000-0000-0000-0000-000000000000');
        if (error) throw error;
        deletedCount = count ?? 0;
      } else if (table === 'resignation') {
        const { count, error } = await supabaseService
          .from('resignation_records')
          .delete({ count: 'exact' })
          .neq('id', '00000000-0000-0000-0000-000000000000');
        if (error) throw error;
        deletedCount = count ?? 0;
      } else if (table === 'sheet_data') {
        const { count, error } = await supabaseService
          .from('sheet_data')
          .delete({ count: 'exact' })
          .neq('id', '00000000-0000-0000-0000-000000000000');
        if (error) throw error;
        deletedCount = count ?? 0;
      } else if (table === 'field_conflicts') {
        const { count, error } = await supabaseService
          .from('field_conflicts')
          .delete({ count: 'exact' })
          .neq('id', '00000000-0000-0000-0000-000000000000');
        if (error) throw error;
        deletedCount = count ?? 0;
      } else {
        return NextResponse.json({ error: `جدول غير مصرح بحذفه: ${table}` }, { status: 400 });
      }

      return NextResponse.json({
        success: true,
        message: `تم مسح ${deletedCount} سجل من جدول ${table} بنجاح`,
        deletedCount,
      });
    }

    // ── 2. Delete Specific Import Batch ───────────────────────────────────
    if (action === 'delete_import') {
      const { import_id } = body;
      if (!import_id) return NextResponse.json({ error: 'معرف العملية import_id مطلوب' }, { status: 400 });

      // Clean all child data associated with this import
      await Promise.allSettled([
        supabaseService.from('sheet_data').delete().eq('import_id', import_id),
        supabaseService.from('incoming_insurance_records').delete().eq('import_id', import_id),
        supabaseService.from('resignation_records').delete().eq('import_id', import_id),
        supabaseService.from('monthly_payroll_records').delete().eq('import_id', import_id),
        supabaseService.from('monthly_insurance_records').delete().eq('import_id', import_id),
        supabaseService.from('employee_history').delete().eq('import_id', import_id),
        supabaseService.from('field_conflicts').delete().eq('proposed_import_id', import_id),
      ]);

      const { error: logErr } = await supabaseService
        .from('import_logs')
        .delete()
        .eq('id', import_id);
      if (logErr) throw logErr;

      return NextResponse.json({
        success: true,
        message: 'تم حذف عملية الاستيراد وجميع سجلاتها المرتبطة بنجاح',
      });
    }

    // ── 3. Sync Incoming Insurance to Employees Master ─────────────────────
    if (action === 'sync_incoming_to_master') {
      // Fetch all incoming records that have a non-null insurance_number
      let offset = 0;
      const limit = 1000;
      let hasMore = true;
      let matchedAndUpdated = 0;

      while (hasMore) {
        const { data: chunk, error } = await supabaseService
          .from('incoming_insurance_records')
          .select('national_id, employee_code, company_account, insurance_number, insurance_status, insurance_job_title, subscription_start_date')
          .not('insurance_number', 'is', null)
          .range(offset, offset + limit - 1);

        if (error || !chunk || chunk.length === 0) {
          hasMore = false;
          break;
        }

        // Process this chunk against employees_master in parallel batches of 25
        for (let i = 0; i < chunk.length; i += 25) {
          const sub = chunk.slice(i, i + 25);
          await Promise.all(
            sub.map(async (r) => {
              const nid = r.national_id ? String(r.national_id).trim() : null;
              const code = r.employee_code ? String(r.employee_code).trim() : null;

              if (nid && nid.length >= 10) {
                const { count } = await supabaseService
                  .from('employees_master')
                  .update({
                    insurance_number: r.insurance_number,
                    ...(r.insurance_status ? { insurance_status: r.insurance_status } : {}),
                    ...(r.insurance_job_title ? { insurance_job_title: r.insurance_job_title } : {}),
                    ...(r.subscription_start_date ? { insurance_start_date: r.subscription_start_date } : {}),
                    last_updated_at: new Date().toISOString(),
                  })
                  .eq('national_id', nid)
                  .is('insurance_number', null);
                if (count && count > 0) matchedAndUpdated += count;
              } else if (code && r.company_account) {
                const { count } = await supabaseService
                  .from('employees_master')
                  .update({
                    insurance_number: r.insurance_number,
                    ...(r.insurance_status ? { insurance_status: r.insurance_status } : {}),
                    ...(r.insurance_job_title ? { insurance_job_title: r.insurance_job_title } : {}),
                    ...(r.subscription_start_date ? { insurance_start_date: r.subscription_start_date } : {}),
                    last_updated_at: new Date().toISOString(),
                  })
                  .eq('company_account', r.company_account)
                  .eq('employee_code', code)
                  .is('insurance_number', null);
                if (count && count > 0) matchedAndUpdated += count;
              }
            })
          );
        }

        if (chunk.length < limit) hasMore = false;
        else offset += limit;
      }

      return NextResponse.json({
        success: true,
        message: `تمت المزامنة بنجاح: تم تحديث الرقم التأميني لـ ${matchedAndUpdated} موظف في Master`,
        updatedCount: matchedAndUpdated,
      });
    }

    // ── 4. Sync Resignations to Employees Master ───────────────────────────
    if (action === 'sync_resignation_to_master') {
      const { data: resList, error } = await supabaseService
        .from('resignation_records')
        .select('national_id, employee_code, resignation_date, last_working_day, resignation_type')
        .not('resignation_date', 'is', null);

      if (error) throw error;

      let updatedCount = 0;
      for (const r of (resList || [])) {
        const nid = r.national_id ? String(r.national_id).trim() : null;
        const code = r.employee_code ? String(r.employee_code).trim() : null;

        if (nid && nid.length >= 10) {
          const { count } = await supabaseService
            .from('employees_master')
            .update({
              resignation_date: r.resignation_date,
              last_working_day: r.last_working_day || null,
              current_status: 'مستقيل (RES)',
              last_updated_at: new Date().toISOString(),
            })
            .eq('national_id', nid);
          if (count && count > 0) updatedCount += count;
        } else if (code) {
          const { count } = await supabaseService
            .from('employees_master')
            .update({
              resignation_date: r.resignation_date,
              last_working_day: r.last_working_day || null,
              current_status: 'مستقيل (RES)',
              last_updated_at: new Date().toISOString(),
            })
            .eq('employee_code', code);
          if (count && count > 0) updatedCount += count;
        }
      }

      return NextResponse.json({
        success: true,
        message: `تمت مزامنة الاستقالات بنجاح: تم تحديث حالة ${updatedCount} موظف إلى مستقيل في Master`,
        updatedCount,
      });
    }

    // ── 5. Deduplicate Sheet Data ─────────────────────────────────────────
    if (action === 'deduplicate_sheets') {
      const { sheet_name } = body;
      const { data, error } = await supabaseService.rpc('deduplicate_sheet_data', {
        target_sheet_name: sheet_name || null,
      });
      if (error) throw error;

      const totalCleaned = (data || []).reduce((sum, r) => sum + (r.duplicates_marked || 0), 0);
      return NextResponse.json({
        success: true,
        message: `تم تنظيف ${totalCleaned} صف مكرر في sheet_data وإبقاء أحدث نسخة فقط مفعلة`,
        results: data,
        totalCleaned,
      });
    }

    return NextResponse.json({ error: `إجراء غير معروف: ${action}` }, { status: 400 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'حدث خطأ أثناء تنفيذ العملية';
    console.error('POST /api/database-control error:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
